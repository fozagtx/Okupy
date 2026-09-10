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
    `DROP TABLE IF EXISTS agent_threads CASCADE`,
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
