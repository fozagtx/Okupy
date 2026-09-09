import assert from "node:assert/strict";
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
  await sql`
    DROP TABLE IF EXISTS reminder_history CASCADE;
    DROP TABLE IF EXISTS reminders CASCADE;
    DROP TABLE IF EXISTS onboarding_drafts CASCADE;
    DROP TABLE IF EXISTS profiles CASCADE;
    CREATE TABLE profiles (
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
    CREATE TABLE onboarding_drafts (
      user_id TEXT PRIMARY KEY,
      step TEXT NOT NULL,
      project TEXT,
      location TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE reminders (
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
    CREATE INDEX reminders_user_status_fire_idx ON reminders (user_id, status, fire_at);
    CREATE TABLE reminder_history (
      id UUID PRIMARY KEY,
      reminder_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reply_text TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'imessage'
    );
  `;
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