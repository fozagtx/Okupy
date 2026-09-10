import { randomUUID } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { z } from "zod";
import { getDb } from "./db.js";

export const reminderInputSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  fireAt: z.iso.datetime({ offset: true }),
  message: z.string().trim().min(1).max(1_000),
  eventTitle: z.string().trim().max(240).optional(),
  eventUrl: z.url().optional(),
});

export type ReminderInput = z.input<typeof reminderInputSchema>;
export type Reminder = z.output<typeof reminderInputSchema> & {
  id: string;
  status: "pending" | "fired" | "cancelled";
  createdAt: string;
  firedAt: string | null;
};

export type ReminderHistoryEntry = {
  id: string;
  reminderId: string;
  userId: string;
  deliveredAt: string;
  replyText: string;
  channel: string;
};

export class ReminderStore {
  constructor(private readonly sql: NeonQueryFunction<false, false> = getDb()) {}

  async create(input: ReminderInput): Promise<Reminder> {
    const parsed = reminderInputSchema.parse(input);
    const id = randomUUID();
    const rows = await this.sql`
      INSERT INTO reminders (id, user_id, fire_at, message, event_title, event_url, status)
      VALUES (${id}::uuid, ${parsed.userId}, ${parsed.fireAt}::timestamptz, ${parsed.message},
              ${parsed.eventTitle ?? null}, ${parsed.eventUrl ?? null}, 'pending')
      RETURNING id, user_id, fire_at, message, event_title, event_url, status, created_at, fired_at
    `;
    return rowToReminder((rows as Record<string, unknown>[])[0]);
  }

  async listForUser(userId: string): Promise<Reminder[]> {
    const rows = await this.sql`
      SELECT id, user_id, fire_at, message, event_title, event_url, status, created_at, fired_at
      FROM reminders
      WHERE user_id = ${userId}
      ORDER BY fire_at ASC
    `;
    return (rows as Record<string, unknown>[]).map(rowToReminder);
  }

  async listActiveForUser(userId: string): Promise<Reminder[]> {
    const rows = await this.sql`
      SELECT id, user_id, fire_at, message, event_title, event_url, status, created_at, fired_at
      FROM reminders
      WHERE user_id = ${userId} AND status = 'pending'
      ORDER BY fire_at ASC
    `;
    return (rows as Record<string, unknown>[]).map(rowToReminder);
  }

  async listDue(now: Date): Promise<Reminder[]> {
    const rows = await this.sql`
      SELECT id, user_id, fire_at, message, event_title, event_url, status, created_at, fired_at
      FROM reminders
      WHERE status = 'pending' AND fire_at <= ${now.toISOString()}::timestamptz
      ORDER BY fire_at ASC
    `;
    return (rows as Record<string, unknown>[]).map(rowToReminder);
  }

  async get(id: string): Promise<Reminder | null> {
    const rows = await this.sql`
      SELECT id, user_id, fire_at, message, event_title, event_url, status, created_at, fired_at
      FROM reminders
      WHERE id = ${id}::uuid
      LIMIT 1
    `;
    const row = (rows as Record<string, unknown>[])[0];
    return row ? rowToReminder(row) : null;
  }

  async cancel(id: string, userId: string): Promise<Reminder | null> {
    const existing = await this.get(id);
    if (!existing || existing.userId !== userId) return null;
    if (existing.status !== "pending") return existing;
    await this.sql`
      UPDATE reminders SET status = 'cancelled' WHERE id = ${id}::uuid AND user_id = ${userId}
    `;
    const updated = await this.get(id);
    return updated;
  }

  async markFired(id: string, firedAt: Date): Promise<Reminder | null> {
    await this.sql`
      UPDATE reminders
      SET status = 'fired', fired_at = ${firedAt.toISOString()}::timestamptz
      WHERE id = ${id}::uuid AND status = 'pending'
    `;
    return this.get(id);
  }

  async recordDelivery(reminderId: string, userId: string, replyText: string, channel: string): Promise<void> {
    const id = randomUUID();
    await this.sql`
      INSERT INTO reminder_history (id, reminder_id, user_id, reply_text, channel)
      VALUES (${id}::uuid, ${reminderId}::uuid, ${userId}, ${replyText}, ${channel})
    `;
  }

  async listHistory(userId: string, limit = 20): Promise<ReminderHistoryEntry[]> {
    const rows = await this.sql`
      SELECT id, reminder_id, user_id, delivered_at, reply_text, channel
      FROM reminder_history
      WHERE user_id = ${userId}
      ORDER BY delivered_at DESC
      LIMIT ${limit}
    `;
    return (rows as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      reminderId: row.reminder_id as string,
      userId: row.user_id as string,
      deliveredAt: new Date(row.delivered_at as string).toISOString(),
      replyText: row.reply_text as string,
      channel: row.channel as string,
    }));
  }
}

function rowToReminder(row: Record<string, unknown>): Reminder {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    fireAt: new Date(row.fire_at as string).toISOString(),
    message: row.message as string,
    eventTitle: (row.event_title as string | null) ?? undefined,
    eventUrl: (row.event_url as string | null) ?? undefined,
    status: row.status as Reminder["status"],
    createdAt: new Date(row.created_at as string).toISOString(),
    firedAt: row.fired_at ? new Date(row.fired_at as string).toISOString() : null,
  };
}

export const reminderStore = new Proxy({} as ReminderStore, {
  get(_target, prop, receiver) {
    const instance = defaultInstance();
    return Reflect.get(instance, prop, receiver);
  },
});

function defaultInstance(): ReminderStore {
  const globalScope = globalThis as { __okupyReminderStore?: ReminderStore };
  if (!globalScope.__okupyReminderStore) {
    globalScope.__okupyReminderStore = new ReminderStore(getDb());
  }
  return globalScope.__okupyReminderStore;
}