import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ProfileStore } from "../src/mastra/profiles.js";
import { classifyEvent } from "../src/mastra/tools.js";
import { needsDatabase, resetSchema, testDb, withDb } from "./_db.js";

test("event results preserve PR #3 classification signals", () => {
  const event = classifyEvent({
    title: "Founder dinner and demo day",
    url: "https://example.com/event",
    text: "Network over free food and receive cloud credits.",
  }, "Accra", "developer tool");

  assert.ok(event);
  assert.equal(event.freeFood, true);
  assert.equal(event.networking, true);
  assert.equal(event.builderCredits, true);
  assert.match(event.why, /developer tool/);
  assert.equal(classifyEvent({ title: "Old meetup", url: "not a URL", text: "free food" }, "Accra", "tool"), null);
  assert.equal(classifyEvent({ title: "Unrelated page", url: "https://example.com/other", text: "No verified perk" }, "Accra", "tool"), null);
});

withDb("iMessage onboarding persists a complete profile", async (sql) => {
  const store = new ProfileStore(sql);
  assert.match(await store.beginOnboarding("builder-1"), /what are you building/i);
  assert.match((await store.advanceOnboarding("builder-1", "a climate accounting API")).reply, /city|area/i);
  assert.match((await store.advanceOnboarding("builder-1", "Accra, Ghana")).reply, /who or what/i);
  const result = await store.advanceOnboarding("builder-1", "customers, feedback and cloud credits");
  assert.equal(result.complete, true);
  assert.deepEqual(result.profile?.goals, ["customers", "feedback", "cloud credits"]);
  assert.equal((await store.getProfile("builder-1"))?.location, "Accra, Ghana");
});

withDb("overlapping profile saves do not lose either user", async (sql) => {
  const store = new ProfileStore(sql);
  await Promise.all([
    store.saveProfile({ userId: "one", project: "an API", location: "Accra" }),
    store.saveProfile({ userId: "two", project: "a compiler", location: "Lagos" }),
  ]);
  const rows = await sql`SELECT user_id FROM profiles ORDER BY user_id ASC`;
  assert.deepEqual((rows as { user_id: string }[]).map(r => r.user_id), ["one", "two"]);
});

withDb("prototype-like user IDs are stored as ordinary keys", async (sql) => {
  const store = new ProfileStore(sql);
  assert.equal(await store.getProfile("__proto__"), null);
  await store.saveProfile({ userId: "__proto__", project: "a safe store", location: "Kumasi" });
  assert.equal((await store.getProfile("__proto__"))?.project, "a safe store");
});

// Suppress unused-import warning when DATABASE_URL_TEST is absent
void needsDatabase;
void mkdtemp;
void rm;
void join;
void tmpdir;
void testDb;
void resetSchema;