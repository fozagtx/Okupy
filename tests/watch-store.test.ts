import assert from "node:assert/strict";
import { WatchStore } from "../src/agent/watch-store.js";
import { withDb } from "./_db.js";

const SAMPLE = {
  userId: "watcher-1",
  store: "amazon" as const,
  url: "https://www.amazon.com/dp/B09V3KXJPB",
  asin: "B09V3KXJPB",
  title: "Logitech MX Master 3S",
  imageUrl: "https://images.amazon.com/mx.jpg",
  targetPrice: "120.00",
  initialPrice: "199.99",
  currency: "USD",
};

const JUMIA_SAMPLE = {
  userId: "watcher-1",
  store: "jumia" as const,
  url: "https://www.jumia.com.gh/tecno-spark-50-128gb-300723006.html",
  asin: "300723006",
  title: "TECNO Spark 50",
  imageUrl: null,
  targetPrice: "2000.00",
  initialPrice: "2300.00",
  currency: "GHS",
};

withDb("watch store adds items, records price history, and removes them", async sql => {
  const store = new WatchStore(sql);
  const item = await store.add(SAMPLE);
  assert.equal(item.status, "active");
  assert.equal(item.asin, SAMPLE.asin);
  assert.equal(item.targetPrice, "120.00");

  await store.recordPrice(item.id, item.userId, "189.99", "USD", new Date());
  const after = await store.get(item.id, item.userId);
  assert.equal(after?.lastPrice, "189.99");
  const history = await store.listHistory(item.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].price, "189.99");

  const removed = await store.remove(item.id, item.userId);
  assert.equal(removed?.status, "removed");
  assert.equal(await store.remove(item.id, item.userId), null);
  assert.equal(await store.pause(item.id, item.userId), null);
  assert.equal(await store.updateTarget(item.id, item.userId, "100.00"), null);
  const active = await store.listForUser(item.userId);
  assert.equal(active.length, 0);
  const withRemoved = await store.listForUser(item.userId, true);
  assert.equal(withRemoved.length, 1);
});

withDb("watch store deduplicates by ASIN per user", async sql => {
  const store = new WatchStore(sql);
  const first = await store.add(SAMPLE);
  const second = await store.add({ ...SAMPLE, title: "Updated title" });
  assert.equal(first.id, second.id);
  assert.equal(second.title, "Updated title");
  const items = await store.listForUser(SAMPLE.userId);
  assert.equal(items.length, 1);
});

withDb("watch store isolates users", async sql => {
  const store = new WatchStore(sql);
  await store.add(SAMPLE);
  const item = (await store.getByAsin(SAMPLE.userId, SAMPLE.asin, "amazon"))!;
  const stolen = await store.remove(item.id, "intruder");
  assert.equal(stolen, null);
  const remaining = await store.listForUser(SAMPLE.userId);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].status, "active");
});

withDb("watch store tracks amazon and jumia with the same product id independently", async sql => {
  const store = new WatchStore(sql);
  const amazon = await store.add(SAMPLE);
  const jumia = await store.add(JUMIA_SAMPLE);
  assert.notEqual(amazon.id, jumia.id);
  assert.equal(jumia.store, "jumia");
  assert.equal(jumia.lastCurrency, "GHS");
  assert.equal((await store.listForUser(SAMPLE.userId)).length, 2);
  const again = await store.add({ ...JUMIA_SAMPLE, title: "TECNO Spark 50 updated" });
  assert.equal(again.id, jumia.id);
  assert.equal(again.title, "TECNO Spark 50 updated");
});

withDb("watch store lists active due items oldest first", async sql => {
  const store = new WatchStore(sql);
  const items = await Promise.all([
    store.add({ ...SAMPLE, asin: "AAAAAAAAAA", url: "https://www.amazon.com/dp/AAAAAAAAAA", title: "First" }),
    store.add({ ...SAMPLE, asin: "BBBBBBBBBB", url: "https://www.amazon.com/dp/BBBBBBBBBB", title: "Second" }),
    store.add({ ...SAMPLE, asin: "CCCCCCCCCC", url: "https://www.amazon.com/dp/CCCCCCCCCC", title: "Third" }),
  ]);
  await store.recordPrice(items[1].id, SAMPLE.userId, "99.99", "USD", new Date(Date.now() - 60_000));
  const due = await store.listActiveForCheck(10);
  assert.equal(due.length, 3);
  assert.equal(due[0].id, items[0].id);
});

withDb("watch store records alerts and lists them per user", async sql => {
  const store = new WatchStore(sql);
  const item = await store.add(SAMPLE);
  await store.recordAlert({
    itemId: item.id,
    userId: SAMPLE.userId,
    alertKind: "price_drop",
    oldPrice: "199.99",
    newPrice: "149.99",
    targetPrice: null,
    currency: "USD",
    channel: "imessage",
    replyText: "Price drop: $199.99 → $149.99",
  });
  const alerts = await store.listAlerts(SAMPLE.userId);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alertKind, "price_drop");
  assert.equal(alerts[0].newPrice, "149.99");
  assert.equal(alerts[0].currency, "USD");
});
