import assert from "node:assert/strict";
import test from "node:test";
import { ReminderStore } from "../src/mastra/reminders.js";
import { needsDatabase, withDb } from "./_db.js";

withDb("reminder store creates, lists, and cancels pending reminders", async (sql) => {
  const store = new ReminderStore(sql);
  const fireAt = new Date(Date.now() + 4 * 3_600_000).toISOString();
  const reminder = await store.create({
    userId: "builder-1",
    fireAt,
    message: "Apply for the AI meetup before seats fill.",
    eventTitle: "AI meetup",
    eventUrl: "https://example.com/event",
  });
  assert.equal(reminder.status, "pending");
  assert.match(reminder.id, /[0-9a-f-]{36}/);
  const active = await store.listActiveForUser("builder-1");
  assert.equal(active.length, 1);
  assert.equal(active[0].id, reminder.id);
  const cancelled = await store.cancel(reminder.id, "builder-1");
  assert.equal(cancelled?.status, "cancelled");
  assert.equal((await store.listActiveForUser("builder-1")).length, 0);
  assert.equal((await store.listForUser("builder-1")).length, 1);
});

withDb("reminder store isolates users and rejects cross-user cancellations", async (sql) => {
  const store = new ReminderStore(sql);
  const fireAt = new Date(Date.now() + 60_000).toISOString();
  const reminder = await store.create({ userId: "owner", fireAt, message: "Private nudge" });
  const cancelledByOther = await store.cancel(reminder.id, "intruder");
  assert.equal(cancelledByOther, null);
  assert.equal((await store.listActiveForUser("owner")).length, 1);
  assert.equal((await store.listActiveForUser("intruder")).length, 0);
});

withDb("reminder store reports only due reminders as ready to fire", async (sql) => {
  const store = new ReminderStore(sql);
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  const overdue = await store.create({ userId: "u", fireAt: past, message: "now" });
  await store.create({ userId: "u", fireAt: future, message: "later" });
  const due = await store.listDue(new Date());
  assert.deepEqual(due.map(r => r.id).sort(), [overdue.id].sort());
  const updated = await store.markFired(overdue.id, new Date());
  assert.equal(updated?.status, "fired");
  assert.ok(updated?.firedAt);
  assert.equal((await store.listDue(new Date())).length, 0);
});

withDb("reminder store persists state across instances", async (sql) => {
  const store = new ReminderStore(sql);
  const fireAt = new Date(Date.now() + 60_000).toISOString();
  const reminder = await store.create({ userId: "u", fireAt, message: "carry over" });
  const rows = await sql`SELECT message FROM reminders WHERE id = ${reminder.id}::uuid`;
  assert.equal((rows as { message: string }[])[0]?.message, "carry over");
  const reader = new ReminderStore(sql);
  assert.equal((await reader.listActiveForUser("u")).length, 1);
});

withDb("reminder history records delivered reminders for audit", async (sql) => {
  const store = new ReminderStore(sql);
  const reminder = await store.create({
    userId: "u",
    fireAt: new Date(Date.now() + 60_000).toISOString(),
    message: "ping",
  });
  await store.recordDelivery(reminder.id, "u", "Hey! Don't forget to apply.", "imessage");
  const history = await store.listHistory("u");
  assert.equal(history.length, 1);
  assert.equal(history[0].reminderId, reminder.id);
  assert.equal(history[0].channel, "imessage");
});

void needsDatabase;
void test;