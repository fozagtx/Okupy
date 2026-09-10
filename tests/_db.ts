import test from "node:test";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const TEST_DATABASE_URL_ENV = "DATABASE_URL_TEST";

export function needsDatabase(): string | null {
  const url = process.env[TEST_DATABASE_URL_ENV];
  if (!url || !url.startsWith("postgres")) {
    return `Set ${TEST_DATABASE_URL_ENV} to a throwaway Neon Postgres URL to run database tests.`;
  }
  return null;
}

let cached: NeonQueryFunction<false, false> | null = null;
export function testDb(): NeonQueryFunction<false, false> {
  if (cached) return cached;
  const url = process.env[TEST_DATABASE_URL_ENV];
  if (!url) throw new Error("testDb called without DATABASE_URL_TEST");
  cached = neon(url);
  return cached;
}

export async function resetSchema(sql: NeonQueryFunction<false, false>): Promise<void> {
  const statements = [
    `DROP TABLE IF EXISTS watch_alerts CASCADE`,
    `DROP TABLE IF EXISTS price_history CASCADE`,
    `DROP TABLE IF EXISTS watched_items CASCADE`,
    `DROP TABLE IF EXISTS reminder_history CASCADE`,
    `DROP TABLE IF EXISTS reminders CASCADE`,
    `DROP TABLE IF EXISTS onboarding_drafts CASCADE`,
    `DROP TABLE IF EXISTS profiles CASCADE`,
    `DROP TABLE IF EXISTS agent_threads CASCADE`,
    `CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL,
      project_stage TEXT NOT NULL DEFAULT 'building',
      goals JSONB NOT NULL DEFAULT '[]'::jsonb,
      interests JSONB NOT NULL DEFAULT '[]'::jsonb,
      location TEXT NOT NULL,
      radius_miles INTEGER NOT NULL DEFAULT 25,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS onboarding_drafts (
      user_id TEXT PRIMARY KEY,
      step TEXT NOT NULL,
      project TEXT,
      location TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS reminders (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      fire_at TIMESTAMPTZ NOT NULL,
      message TEXT NOT NULL,
      event_title TEXT,
      event_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      fired_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS reminders_user_status_fire_idx ON reminders (user_id, status, fire_at)`,
    `CREATE TABLE IF NOT EXISTS reminder_history (
      id UUID PRIMARY KEY,
      reminder_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reply_text TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'imessage'
    )`,
    `CREATE TABLE IF NOT EXISTS watched_items (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      store TEXT NOT NULL DEFAULT 'amazon',
      asin TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      image_url TEXT,
      target_price TEXT,
      initial_price TEXT,
      last_price TEXT,
      last_currency TEXT DEFAULT 'USD',
      last_checked_at TIMESTAMPTZ,
      last_alerted_price TEXT,
      last_alerted_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, store, asin)
    )`,
    `CREATE TABLE IF NOT EXISTS price_history (
      id UUID PRIMARY KEY,
      item_id UUID NOT NULL REFERENCES watched_items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      price TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS watch_alerts (
      id UUID PRIMARY KEY,
      item_id UUID NOT NULL REFERENCES watched_items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      alert_kind TEXT NOT NULL,
      old_price TEXT,
      new_price TEXT,
      target_price TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      channel TEXT NOT NULL DEFAULT 'imessage',
      reply_text TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS agent_threads (
      user_id TEXT PRIMARY KEY,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  ];
  for (const statement of statements) {
    await sql.query(statement, []);
  }
}

export function withDb(testName: string, fn: (sql: NeonQueryFunction<false, false>) => Promise<void>): void {
  test(testName, async (t) => {
    const skip = needsDatabase();
    if (skip) {
      t.skip(skip);
      return;
    }
    const sql = testDb();
    await resetSchema(sql);
    await fn(sql);
  });
}
