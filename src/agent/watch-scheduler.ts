import { comparePrices, fetchProductPage } from "./amazon.js";
import { watchStore, type WatchItem } from "./watch-store.js";
import { photonStatus } from "./photon.js";
import { spectrumSend } from "./spectrum-state.js";

export const WATCH_POLL_INTERVAL_MS = Number(process.env.WATCH_POLL_INTERVAL_MS) || 60 * 60_000;
export const WATCH_BATCH_SIZE = Number(process.env.WATCH_BATCH_SIZE) || 5;
export const WATCH_CHECK_INTERVAL_MS = 24 * 60 * 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

type PriceTickResult = {
  checked: number;
  drops: number;
  failures: number;
};

export function nextCheckAt(item: WatchItem, now: Date): Date {
  const created = new Date(item.createdAt);
  const createdMs = created.getTime();
  const offsetMs = createdMs % WATCH_CHECK_INTERVAL_MS;
  const baseDay = Math.floor(now.getTime() / WATCH_CHECK_INTERVAL_MS);
  const candidate = baseDay * WATCH_CHECK_INTERVAL_MS + offsetMs;
  if (candidate <= now.getTime()) {
    return new Date(candidate + WATCH_CHECK_INTERVAL_MS);
  }
  return new Date(candidate);
}

function isDue(item: WatchItem, now: Date): boolean {
  if (!item.lastCheckedAt) return true;
  return new Date(item.lastCheckedAt).getTime() + WATCH_CHECK_INTERVAL_MS <= now.getTime();
}

export async function runPriceTick(): Promise<PriceTickResult> {
  if (running) return { checked: 0, drops: 0, failures: 0 };
  running = true;
  const start = Date.now();
  try {
    const all = await watchStore.listActiveForCheck();
    const now = new Date(start);
    const due = all.filter(item => isDue(item, now)).slice(0, WATCH_BATCH_SIZE);
    let drops = 0;
    let failures = 0;
    for (const item of due) {
      try {
        const result = await checkOne(item);
        if (result.dropDetected) drops += 1;
      } catch (error) {
        failures += 1;
        console.warn(
          `[watch] price check failed for ${item.title} (${item.asin}):`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    const elapsed = Date.now() - start;
    if (due.length > 0) {
      console.log(`[watch] tick: checked ${due.length} item(s), ${drops} drop(s), ${failures} failure(s) in ${elapsed}ms`);
    }
    return { checked: due.length, drops, failures };
  } finally {
    running = false;
  }
}

async function checkOne(item: WatchItem): Promise<{ dropDetected: boolean }> {
  const fetched = await fetchProductPage(item.url, item.store);
  const checkedAt = new Date();
  if (!fetched.price) {
    await watchStore.recordCheck(item.id, item.userId, checkedAt);
    return { dropDetected: false };
  }
  await watchStore.recordPrice(item.id, item.userId, fetched.price, fetched.currency, checkedAt);

  const previous = item.lastPrice;
  if (!previous) return { dropDetected: false };
  const comparison = comparePrices(previous, fetched.price, fetched.currency, item.targetPrice);
  if (!comparison.droppedByAmount) return { dropDetected: false };

  const targetHit = comparison.reachedTarget;
  const alertedPrice = item.lastAlertedPrice;
  const alreadyAlerted = alertedPrice !== null && Number(alertedPrice) <= Number(fetched.price);
  if (alreadyAlerted) return { dropDetected: true };

  const replyText = formatDropAlert({
    title: fetched.title || item.title,
    url: item.url,
    oldPrice: previous,
    newPrice: fetched.price,
    currency: fetched.currency,
    target: item.targetPrice,
    droppedByAmount: comparison.droppedByAmount,
    droppedByPercent: comparison.droppedByPercent,
    targetHit,
  });

  let channel = "log";
  if (photonStatus() === "ready") {
    const sent = await spectrumSend(item.userId, replyText);
    channel = sent ? "imessage" : "log";
  } else {
    console.log(`[watch] drop for ${item.userId}: ${replyText}`);
  }

  await watchStore.markAlerted(item.id, fetched.price, checkedAt);
  await watchStore.recordAlert({
    itemId: item.id,
    userId: item.userId,
    alertKind: targetHit ? "target_hit" : "price_drop",
    oldPrice: previous,
    newPrice: fetched.price,
    targetPrice: item.targetPrice,
    currency: fetched.currency,
    channel,
    replyText,
  });
  return { dropDetected: true };
}

export type DropAlert = {
  title: string;
  url: string;
  oldPrice: string;
  newPrice: string;
  currency: string;
  target: string | null;
  droppedByAmount: number;
  droppedByPercent: number | null;
  targetHit: boolean;
};

export function formatDropAlert(alert: DropAlert): string {
  const lines: string[] = [];
  lines.push(alert.targetHit ? "TARGET HIT: " : "Price drop: ");
  lines.push(`${alert.title}`);
  const previous = formatMoney(alert.oldPrice, alert.currency);
  const next = formatMoney(alert.newPrice, alert.currency);
  const pct = alert.droppedByPercent !== null ? ` (-${alert.droppedByPercent.toFixed(0)}%)` : "";
  lines.push(`${previous} → ${next}${pct}`);
  if (alert.targetHit && alert.target) {
    lines.push(`Under your target of ${formatMoney(alert.target, alert.currency)}`);
  }
  lines.push(alert.url);
  return lines.join("\n");
}

export function formatMoney(value: string, currency: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return `${value} ${currency}`;
  const formatted = number.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Only monitored stores get symbols: USD (Amazon) and GHS (Jumia Ghana).
  const symbol = currency === "USD" ? "$" : currency === "GHS" ? "GH₵ " : "";
  return symbol ? `${symbol}${formatted}` : `${formatted} ${currency}`;
}

export function startWatchScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runPriceTick().catch(error => console.error("[watch] tick failed", error));
  }, WATCH_POLL_INTERVAL_MS);
  void runPriceTick().catch(error => console.error("[watch] initial tick failed", error));
}

export function stopWatchScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
