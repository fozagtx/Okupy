import { neon, neonConfig, type NeonQueryFunction } from "@neondatabase/serverless";
import { secret } from "./config.js";

let client: NeonQueryFunction<false, false> | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(secret("DATABASE_URL"));
}

export function getDb(): NeonQueryFunction<false, false> {
  if (client) return client;
  const url = secret("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured.");
  neonConfig.fetchConnectionCache = true;
  client = neon(url);
  return client;
}

const SCHEMA_STATEMENTS: string[] = [
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
  `ALTER TABLE watched_items ADD COLUMN IF NOT EXISTS store TEXT NOT NULL DEFAULT 'amazon'`,
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watched_items_user_id_asin_key') THEN
      ALTER TABLE watched_items DROP CONSTRAINT watched_items_user_id_asin_key;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watched_items_user_store_asin_key') THEN
      ALTER TABLE watched_items ADD CONSTRAINT watched_items_user_store_asin_key UNIQUE (user_id, store, asin);
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS watched_items_user_status_idx
    ON watched_items (user_id, status)`,
  `CREATE INDEX IF NOT EXISTS watched_items_status_next_check_idx
    ON watched_items (status, last_checked_at)`,
  `CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY,
    item_id UUID NOT NULL REFERENCES watched_items(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    price TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS price_history_item_observed_idx
    ON price_history (item_id, observed_at DESC)`,
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
  `ALTER TABLE watch_alerts ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'`,
  `CREATE INDEX IF NOT EXISTS watch_alerts_user_delivered_idx
    ON watch_alerts (user_id, delivered_at DESC)`,
  `CREATE TABLE IF NOT EXISTS agent_threads (
    user_id TEXT PRIMARY KEY,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

let migrated = false;

export async function runMigrations(): Promise<void> {
  if (migrated) return;
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }
  const sql = getDb();
  for (const statement of SCHEMA_STATEMENTS) {
    await sql.query(statement, []);
  }
  migrated = true;
}
