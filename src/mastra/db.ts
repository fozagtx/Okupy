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

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL,
  project_stage TEXT NOT NULL DEFAULT 'building',
  goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  interests JSONB NOT NULL DEFAULT '[]'::jsonb,
  location TEXT NOT NULL,
  radius_miles INTEGER NOT NULL DEFAULT 25,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_drafts (
  user_id TEXT PRIMARY KEY,
  step TEXT NOT NULL,
  project TEXT,
  location TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL,
  event_title TEXT,
  event_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fired_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS reminders_user_status_fire_idx
  ON reminders (user_id, status, fire_at);

CREATE TABLE IF NOT EXISTS reminder_history (
  id UUID PRIMARY KEY,
  reminder_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reply_text TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'imessage'
);
CREATE INDEX IF NOT EXISTS reminder_history_user_idx
  ON reminder_history (user_id, delivered_at DESC);
`;

let migrated = false;

export async function runMigrations(): Promise<void> {
  if (migrated) return;
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }
  const sql = getDb();
  await sql.query(SCHEMA_SQL, []);
  migrated = true;
}