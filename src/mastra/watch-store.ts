import { randomUUID } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { z } from "zod";
import { getDb } from "./db.js";

export const watchItemInputSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  url: z.url(),
  asin: z.string().trim().regex(/^[A-Z0-9]{10}$/i),
  title: z.string().trim().min(1).max(500),
  imageUrl: z.url().nullable().optional(),
  targetPrice: z.string().trim().regex(/^\d+(?:\.\d+)?$/).nullable().optional(),
  initialPrice: z.string().trim().regex(/^\d+(?:\.\d+)?$/).nullable().optional(),
  currency: z.string().trim().min(1).max(8).default("USD"),
});
export type WatchItemInput = z.input<typeof watchItemInputSchema>;

export type WatchItemStatus = "active" | "paused" | "removed";

export type WatchItem = {
  id: string;
  userId: string;
  asin: string;
  url: string;
  title: string;
  imageUrl: string | null;
  targetPrice: string | null;
  initialPrice: string | null;
  lastPrice: string | null;
  lastCurrency: string;
  lastCheckedAt: string | null;
  lastAlertedPrice: string | null;
  lastAlertedAt: string | null;
  status: WatchItemStatus;
  createdAt: string;
  updatedAt: string;
};

export type PriceHistoryEntry = {
  id: string;
  itemId: string;
  userId: string;
  price: string;
  currency: string;
  observedAt: string;
};

export type WatchAlert = {
  id: string;
  itemId: string;
  userId: string;
  alertKind: "price_drop" | "target_hit" | "removed";
  oldPrice: string | null;
  newPrice: string | null;
  targetPrice: string | null;
  deliveredAt: string;
  channel: string;
  replyText: string;
};

function rowToItem(row: Record<string, unknown>): WatchItem {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    asin: row.asin as string,
    url: row.url as string,
    title: row.title as string,
    imageUrl: (row.image_url as string | null) ?? null,
    targetPrice: (row.target_price as string | null) ?? null,
    initialPrice: (row.initial_price as string | null) ?? null,
    lastPrice: (row.last_price as string | null) ?? null,
    lastCurrency: (row.last_currency as string | null) ?? "USD",
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at as string).toISOString() : null,
    lastAlertedPrice: (row.last_alerted_price as string | null) ?? null,
    lastAlertedAt: row.last_alerted_at ? new Date(row.last_alerted_at as string).toISOString() : null,
    status: (row.status as WatchItemStatus) ?? "active",
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export class WatchStore {
  constructor(private readonly sql: NeonQueryFunction<false, false> = getDb()) {}

  async add(input: WatchItemInput): Promise<WatchItem> {
    const parsed = watchItemInputSchema.parse(input);
    const id = randomUUID();
    const rows = await this.sql`
      INSERT INTO watched_items (id, user_id, asin, url, title, image_url, target_price, initial_price, last_currency, status)
      VALUES (${id}::uuid, ${parsed.userId}, ${parsed.asin}, ${parsed.url}, ${parsed.title},
              ${parsed.imageUrl ?? null}, ${parsed.targetPrice ?? null}, ${parsed.initialPrice ?? null},
              ${parsed.currency}, 'active')
      ON CONFLICT (user_id, asin) DO UPDATE SET
        url = EXCLUDED.url,
        title = EXCLUDED.title,
        image_url = EXCLUDED.image_url,
        target_price = COALESCE(EXCLUDED.target_price, watched_items.target_price),
        initial_price = COALESCE(watched_items.initial_price, EXCLUDED.initial_price),
        last_currency = EXCLUDED.last_currency,
        status = 'active',
        updated_at = now()
      RETURNING id, user_id, asin, url, title, image_url, target_price, initial_price,
                last_price, last_currency, last_checked_at, last_alerted_price, last_alerted_at,
                status, created_at, updated_at
    `;
    return rowToItem((rows as Record<string, unknown>[])[0]);
  }

  async remove(id: string, userId: string): Promise<WatchItem | null> {
    await this.sql`
      UPDATE watched_items SET status = 'removed', updated_at = now()
      WHERE id = ${id}::uuid AND user_id = ${userId} AND status <> 'removed'
    `;
    return this.get(id, userId);
  }

  async pause(id: string, userId: string): Promise<WatchItem | null> {
    await this.sql`
      UPDATE watched_items SET status = 'paused', updated_at = now()
      WHERE id = ${id}::uuid AND user_id = ${userId}
    `;
    return this.get(id, userId);
  }

  async resume(id: string, userId: string): Promise<WatchItem | null> {
    await this.sql`
      UPDATE watched_items SET status = 'active', updated_at = now()
      WHERE id = ${id}::uuid AND user_id = ${userId}
    `;
    return this.get(id, userId);
  }

  async updateTarget(id: string, userId: string, targetPrice: string | null): Promise<WatchItem | null> {
    await this.sql`
      UPDATE watched_items SET target_price = ${targetPrice}, updated_at = now()
      WHERE id = ${id}::uuid AND user_id = ${userId}
    `;
    return this.get(id, userId);
  }

  async get(id: string, userId: string): Promise<WatchItem | null> {
    const rows = await this.sql`
      SELECT id, user_id, asin, url, title, image_url, target_price, initial_price,
             last_price, last_currency, last_checked_at, last_alerted_price, last_alerted_at,
             status, created_at, updated_at
      FROM watched_items
      WHERE id = ${id}::uuid AND user_id = ${userId}
      LIMIT 1
    `;
    const row = (rows as Record<string, unknown>[])[0];
    return row ? rowToItem(row) : null;
  }

  async getByAsin(userId: string, asin: string): Promise<WatchItem | null> {
    const rows = await this.sql`
      SELECT id, user_id, asin, url, title, image_url, target_price, initial_price,
             last_price, last_currency, last_checked_at, last_alerted_price, last_alerted_at,
             status, created_at, updated_at
      FROM watched_items
      WHERE user_id = ${userId} AND asin = ${asin} AND status <> 'removed'
      LIMIT 1
    `;
    const row = (rows as Record<string, unknown>[])[0];
    return row ? rowToItem(row) : null;
  }

  async listForUser(userId: string, includeRemoved = false): Promise<WatchItem[]> {
    const rows = includeRemoved
      ? await this.sql`
          SELECT id, user_id, asin, url, title, image_url, target_price, initial_price,
                 last_price, last_currency, last_checked_at, last_alerted_price, last_alerted_at,
                 status, created_at, updated_at
          FROM watched_items
          WHERE user_id = ${userId}
          ORDER BY status = 'removed' ASC, updated_at DESC
        `
      : await this.sql`
          SELECT id, user_id, asin, url, title, image_url, target_price, initial_price,
                 last_price, last_currency, last_checked_at, last_alerted_price, last_alerted_at,
                 status, created_at, updated_at
          FROM watched_items
          WHERE user_id = ${userId} AND status <> 'removed'
          ORDER BY updated_at DESC
        `;
    return (rows as Record<string, unknown>[]).map(rowToItem);
  }

  async listActiveForCheck(limit = 25): Promise<WatchItem[]> {
    const rows = await this.sql`
      SELECT id, user_id, asin, url, title, image_url, target_price, initial_price,
             last_price, last_currency, last_checked_at, last_alerted_price, last_alerted_at,
             status, created_at, updated_at
      FROM watched_items
      WHERE status = 'active'
      ORDER BY last_checked_at ASC NULLS FIRST, created_at ASC
      LIMIT ${limit}
    `;
    return (rows as Record<string, unknown>[]).map(rowToItem);
  }

  async recordPrice(itemId: string, userId: string, price: string, currency: string, checkedAt: Date): Promise<void> {
    const historyId = randomUUID();
    await this.sql`
      INSERT INTO price_history (id, item_id, user_id, price, currency, observed_at)
      VALUES (${historyId}::uuid, ${itemId}::uuid, ${userId}, ${price}, ${currency}, ${checkedAt.toISOString()}::timestamptz)
    `;
    await this.sql`
      UPDATE watched_items
      SET last_price = ${price},
          last_currency = ${currency},
          last_checked_at = ${checkedAt.toISOString()}::timestamptz,
          initial_price = COALESCE(initial_price, ${price}),
          updated_at = now()
      WHERE id = ${itemId}::uuid AND user_id = ${userId}
    `;
  }

  async markAlerted(itemId: string, price: string, alertedAt: Date): Promise<void> {
    await this.sql`
      UPDATE watched_items
      SET last_alerted_price = ${price},
          last_alerted_at = ${alertedAt.toISOString()}::timestamptz,
          updated_at = now()
      WHERE id = ${itemId}::uuid
    `;
  }

  async recordAlert(alert: Omit<WatchAlert, "id" | "deliveredAt"> & { deliveredAt?: Date }): Promise<WatchAlert> {
    const id = randomUUID();
    const deliveredAt = alert.deliveredAt ?? new Date();
    const rows = await this.sql`
      INSERT INTO watch_alerts (id, item_id, user_id, alert_kind, old_price, new_price, target_price, delivered_at, channel, reply_text)
      VALUES (${id}::uuid, ${alert.itemId}::uuid, ${alert.userId}, ${alert.alertKind},
              ${alert.oldPrice ?? null}, ${alert.newPrice ?? null}, ${alert.targetPrice ?? null},
              ${deliveredAt.toISOString()}::timestamptz, ${alert.channel}, ${alert.replyText})
      RETURNING id, item_id, user_id, alert_kind, old_price, new_price, target_price, delivered_at, channel, reply_text
    `;
    const row = (rows as Record<string, unknown>[])[0];
    return {
      id: row.id as string,
      itemId: row.item_id as string,
      userId: row.user_id as string,
      alertKind: row.alert_kind as WatchAlert["alertKind"],
      oldPrice: (row.old_price as string | null) ?? null,
      newPrice: (row.new_price as string | null) ?? null,
      targetPrice: (row.target_price as string | null) ?? null,
      deliveredAt: new Date(row.delivered_at as string).toISOString(),
      channel: row.channel as string,
      replyText: row.reply_text as string,
    };
  }

  async listAlerts(userId: string, limit = 25): Promise<WatchAlert[]> {
    const rows = await this.sql`
      SELECT id, item_id, user_id, alert_kind, old_price, new_price, target_price, delivered_at, channel, reply_text
      FROM watch_alerts
      WHERE user_id = ${userId}
      ORDER BY delivered_at DESC
      LIMIT ${limit}
    `;
    return (rows as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      itemId: row.item_id as string,
      userId: row.user_id as string,
      alertKind: row.alert_kind as WatchAlert["alertKind"],
      oldPrice: (row.old_price as string | null) ?? null,
      newPrice: (row.new_price as string | null) ?? null,
      targetPrice: (row.target_price as string | null) ?? null,
      deliveredAt: new Date(row.delivered_at as string).toISOString(),
      channel: row.channel as string,
      replyText: row.reply_text as string,
    }));
  }

  async listHistory(itemId: string, limit = 50): Promise<PriceHistoryEntry[]> {
    const rows = await this.sql`
      SELECT id, item_id, user_id, price, currency, observed_at
      FROM price_history
      WHERE item_id = ${itemId}::uuid
      ORDER BY observed_at DESC
      LIMIT ${limit}
    `;
    return (rows as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      itemId: row.item_id as string,
      userId: row.user_id as string,
      price: row.price as string,
      currency: row.currency as string,
      observedAt: new Date(row.observed_at as string).toISOString(),
    }));
  }
}

export const watchStore = new Proxy({} as WatchStore, {
  get(_target, prop, receiver) {
    const instance = defaultInstance();
    return Reflect.get(instance, prop, receiver);
  },
});

function defaultInstance(): WatchStore {
  const globalScope = globalThis as { __okupyWatchStore?: WatchStore };
  if (!globalScope.__okupyWatchStore) {
    globalScope.__okupyWatchStore = new WatchStore(getDb());
  }
  return globalScope.__okupyWatchStore;
}