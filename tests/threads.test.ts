import assert from "node:assert/strict";
import test from "node:test";
import { ThreadStore } from "../src/agent/threads.js";
import { needsDatabase, withDb } from "./_db.js";

withDb("thread store persists and retrieves message history", async sql => {
  const store = new ThreadStore(sql);
  const now = new Date().toISOString();
  await store.append("user-1", { role: "user", content: "Track this product", at: now });
  await store.append("user-1", { role: "assistant", content: "Added to your watch cart!", at: now });

  const history = await store.list("user-1");
  assert.equal(history.length, 2);
  assert.equal(history[0].role, "user");
  assert.equal(history[0].content, "Track this product");
  assert.equal(history[1].role, "assistant");
  assert.equal(history[1].content, "Added to your watch cart!");
});

withDb("thread store clears history cleanly", async sql => {
  const store = new ThreadStore(sql);
  const now = new Date().toISOString();
  await store.append("user-2", { role: "user", content: "hello", at: now });
  assert.equal((await store.list("user-2")).length, 1);

  await store.clear("user-2");
  assert.equal((await store.list("user-2")).length, 0);
});

void needsDatabase;
void test;
