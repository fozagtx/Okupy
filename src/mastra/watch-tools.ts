import { z } from "zod";
import {
  fetchProductPage,
  canonicalProductUrl,
  comparePrices,
  isStoreEnabled,
  unsupportedStoreMessage,
} from "./amazon.js";
import { watchStore } from "./watch-store.js";

const watchItemSchema = z.object({
  id: z.string(),
  store: z.enum(["amazon", "jumia"]),
  asin: z.string(),
  url: z.url(),
  title: z.string(),
  imageUrl: z.string().nullable(),
  targetPrice: z.string().nullable(),
  initialPrice: z.string().nullable(),
  lastPrice: z.string().nullable(),
  lastCurrency: z.string(),
  lastCheckedAt: z.string().nullable(),
  status: z.enum(["active", "paused", "removed"]),
});

function serializeItem(item: {
  id: string;
  store: "amazon" | "jumia";
  asin: string;
  url: string;
  title: string;
  imageUrl: string | null;
  targetPrice: string | null;
  initialPrice: string | null;
  lastPrice: string | null;
  lastCurrency: string;
  lastCheckedAt: string | null;
  status: "active" | "paused" | "removed";
}) {
  return {
    id: item.id,
    store: item.store,
    asin: item.asin,
    url: item.url,
    title: item.title,
    imageUrl: item.imageUrl,
    targetPrice: item.targetPrice,
    initialPrice: item.initialPrice,
    lastPrice: item.lastPrice,
    lastCurrency: item.lastCurrency,
    lastCheckedAt: item.lastCheckedAt,
    status: item.status,
  };
}

const addItemParameters = z.object({
  userId: z.string().trim().min(1).max(256),
  url: z
    .string()
    .trim()
    .url()
    .describe(
      "Full Amazon (amazon.com/dp/<ASIN>) or Jumia (jumia.*/<slug>-<ID>.html) product URL",
    ),
  targetPrice: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d+)?$/)
    .nullable()
    .optional()
    .describe("Optional price in major units (e.g. 199.99). Agent will alert when price drops at or below this."),
  fetchNow: z.boolean().default(true).describe("If true, scrape the current price immediately and store it as the baseline."),
});

export async function executeAddWatchItem(input: z.input<typeof addItemParameters>) {
  const blocked = unsupportedStoreMessage(input.url);
  if (blocked) throw new Error(blocked);
  const resolved = canonicalProductUrl(input.url);
  if (!resolved) {
    throw new Error(
      "That doesn't look like a monitored product URL. I track Jumia Ghana (jumia.com.gh/...-<ID>.html) and Amazon.",
    );
  }
  const { store, productId: asin, url: canonical } = resolved;
  if (!isStoreEnabled(store)) {
    throw new Error(
      store === "amazon"
        ? "Amazon tracking is paused — I only track Jumia Ghana right now."
        : "Jumia Ghana tracking is paused right now.",
    );
  }
  const storeLabel = store === "amazon" ? "Amazon" : "Jumia Ghana";

  const existing = await watchStore.getByAsin(input.userId, asin, store);
  if (existing) {
    const updatedTarget =
      input.targetPrice !== undefined && input.targetPrice !== null
        ? await watchStore.updateTarget(existing.id, input.userId, input.targetPrice)
        : existing;
    return {
      item: serializeItem(updatedTarget ?? existing),
      baselinePrice: existing.lastPrice,
      message: `Already on your watch list: ${existing.title}. ${input.targetPrice ? `Target ${input.targetPrice} ${existing.lastCurrency} saved.` : "Same item, no target change."}`,
    };
  }

  let title = `${storeLabel} item`;
  let imageUrl: string | null = null;
  let baselinePrice: string | null = null;
  let currency = store === "jumia" ? "GHS" : "USD";

  if (input.fetchNow) {
    try {
      const fetched = await fetchProductPage(canonical, store);
      title = fetched.title || title;
      imageUrl = fetched.imageUrl;
      baselinePrice = fetched.price;
      currency = fetched.currency || currency;
    } catch (error) {
      console.warn(
        `[watch] initial fetch failed for ${canonical}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const saved = await watchStore.add({
    userId: input.userId,
    url: canonical,
    store,
    asin,
    title,
    imageUrl,
    targetPrice: input.targetPrice ?? null,
    initialPrice: baselinePrice,
    currency,
  });

  if (baselinePrice) {
    await watchStore.recordPrice(saved.id, input.userId, baselinePrice, currency, new Date());
  }

  const note = baselinePrice
    ? `Added and priced at ${baselinePrice} ${currency}.`
    : "Added. I'll try to fetch its current price at the next poll.";
  const targetNote = input.targetPrice ? ` Target: ${input.targetPrice} ${currency}.` : "";
  return {
    item: serializeItem(saved),
    baselinePrice,
    message: `${note}${targetNote} I'll text you when it drops.`,
  };
}

const itemUserParameters = z.object({
  userId: z.string().trim().min(1).max(256),
  itemId: z.string().trim().min(1).max(256),
});

export async function executeRemoveWatchItem(input: z.input<typeof itemUserParameters>) {
  const removed = await watchStore.remove(input.itemId, input.userId);
  return {
    removed: removed?.status === "removed",
    item: removed ? serializeItem(removed) : null,
    message: removed ? `Stopped watching ${removed.title}.` : "Couldn't find that item.",
  };
}

export async function executePauseWatchItem(input: z.input<typeof itemUserParameters>) {
  const item = await watchStore.pause(input.itemId, input.userId);
  return {
    item: item ? serializeItem(item) : null,
    message: item?.status === "paused" ? `Paused ${item.title}.` : "Couldn't pause that item.",
  };
}

export async function executeResumeWatchItem(input: z.input<typeof itemUserParameters>) {
  const item = await watchStore.resume(input.itemId, input.userId);
  return {
    item: item ? serializeItem(item) : null,
    message: item?.status === "active" ? `Resumed ${item.title}.` : "Couldn't resume that item.",
  };
}

const updateTargetParameters = z.object({
  userId: z.string().trim().min(1).max(256),
  itemId: z.string().trim().min(1).max(256),
  targetPrice: z.string().trim().regex(/^\d+(?:\.\d+)?$/).nullable(),
});

export async function executeUpdateWatchTarget(input: z.input<typeof updateTargetParameters>) {
  const item = await watchStore.updateTarget(input.itemId, input.userId, input.targetPrice);
  return {
    item: item ? serializeItem(item) : null,
    message: item
      ? input.targetPrice
        ? `Target set to ${input.targetPrice} ${item.lastCurrency} for ${item.title}.`
        : `Target cleared for ${item.title}.`
      : "Couldn't update that item.",
  };
}

const listCartParameters = z.object({
  userId: z.string().trim().min(1).max(256),
  includeRemoved: z.boolean().default(false),
});

export async function executeListWatchCart(input: z.input<typeof listCartParameters>) {
  const items = await watchStore.listForUser(input.userId, input.includeRemoved);
  const summary = items.reduce(
    (acc, item) => {
      if (item.status === "active") acc.active += 1;
      if (item.status === "paused") acc.paused += 1;
      if (item.status === "removed") acc.removed += 1;
      return acc;
    },
    { active: 0, paused: 0, removed: 0, droppedCount: 0, reachedTargetCount: 0 },
  );
  const enriched = items.map(item => {
    const change =
      item.lastPrice && item.initialPrice && item.initialPrice !== item.lastPrice
        ? comparePrices(item.initialPrice, item.lastPrice, item.lastCurrency, item.targetPrice)
        : null;
    if (change?.droppedByAmount !== null && change?.droppedByAmount !== undefined && change.droppedByAmount > 0) {
      summary.droppedCount += 1;
    }
    if (change?.reachedTarget) summary.reachedTargetCount += 1;
    return { ...serializeItem(item), priceChange: change };
  });
  return { items: enriched, summary };
}

const checkPricesParameters = z.object({
  userId: z.string().trim().min(1).max(256),
  itemId: z.string().trim().min(1).max(256).optional(),
});

export async function executeCheckWatchPrices(input: z.input<typeof checkPricesParameters>) {
  const items = input.itemId
    ? [await watchStore.get(input.itemId, input.userId)].filter(
        (item): item is NonNullable<typeof item> => item !== null,
      )
    : await watchStore.listForUser(input.userId);
  const checked: typeof items = [];
  const drops: Array<{
    id: string;
    title: string;
    url: string;
    oldPrice: string | null;
    newPrice: string | null;
    currency: string;
    droppedByAmount: number | null;
    droppedByPercent: number | null;
    reachedTarget: boolean;
  }> = [];
  const failures: Array<{ id: string; title: string; reason: string }> = [];
  for (const item of items) {
    if (item.status !== "active") continue;
    try {
      const fetched = await fetchProductPage(item.url, item.store);
      const previous = item.lastPrice;
      if (fetched.price) {
        await watchStore.recordPrice(item.id, input.userId, fetched.price, fetched.currency, new Date());
      } else {
        await watchStore.recordCheck(item.id, input.userId, new Date());
        failures.push({ id: item.id, title: item.title, reason: "Price unavailable on this check." });
      }
      checked.push(item);
      if (fetched.price && previous && Number(fetched.price) < Number(previous)) {
        const comparison = comparePrices(previous, fetched.price, fetched.currency, item.targetPrice);
        drops.push({
          id: item.id,
          title: item.title,
          url: item.url,
          oldPrice: previous,
          newPrice: fetched.price,
          currency: fetched.currency,
          droppedByAmount: comparison.droppedByAmount,
          droppedByPercent: comparison.droppedByPercent,
          reachedTarget: comparison.reachedTarget,
        });
      }
    } catch (error) {
      failures.push({
        id: item.id,
        title: item.title,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return { checked: checked.length, drops, failures };
}

export const watchTools = {
  addWatchItem: {
    description:
      "Add an Amazon or Jumia product URL to the user's monitored cart. Optionally takes a target threshold; alerts fire when the price drops at or below it.",
    inputSchema: addItemParameters,
    execute: executeAddWatchItem,
  },
  removeWatchItem: {
    description: "Remove an item from the watch list. Use the item id from listCart.",
    inputSchema: itemUserParameters,
    execute: executeRemoveWatchItem,
  },
  pauseWatchItem: {
    description: "Pause alerts for an item without removing it.",
    inputSchema: itemUserParameters,
    execute: executePauseWatchItem,
  },
  resumeWatchItem: {
    description: "Resume alerts for a previously paused item.",
    inputSchema: itemUserParameters,
    execute: executeResumeWatchItem,
  },
  updateWatchTarget: {
    description: "Set or clear the alert target price for a watched item. Pass null to remove the target.",
    inputSchema: updateTargetParameters,
    execute: executeUpdateWatchTarget,
  },
  listWatchCart: {
    description:
      "List every Amazon and Jumia item the user is currently watching, with current and target prices. Use when the user asks 'what's on my watch list', 'show my cart', 'what am I watching', or 'show prices'.",
    inputSchema: listCartParameters,
    execute: executeListWatchCart,
  },
  checkWatchPrices: {
    description:
      "Force an immediate price check on the user's watched cart (or a single item). Use when the user says 'check prices now', 'refresh my cart', or 'what's the price right now'.",
    inputSchema: checkPricesParameters,
    execute: executeCheckWatchPrices,
  },
} as const;

void watchItemSchema;