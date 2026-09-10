import assert from "node:assert/strict";
import test from "node:test";
import { formatDropAlert } from "../src/mastra/watch-scheduler.js";

test("formatDropAlert includes old/new price, percent change, and target hit banner", () => {
  const message = formatDropAlert({
    title: "Logitech MX Master 3S",
    url: "https://www.amazon.com/dp/B09V3KXJPB",
    oldPrice: "199.99",
    newPrice: "149.99",
    currency: "USD",
    target: "150.00",
    droppedByAmount: 50,
    droppedByPercent: 25,
    targetHit: true,
  });
  assert.match(message, /TARGET HIT/);
  assert.match(message, /\$199\.99/);
  assert.match(message, /\$149\.99/);
  assert.match(message, /-25%/);
  assert.match(message, /amazon\.com\/dp\/B09V3KXJPB/);
});

test("formatDropAlert falls back gracefully with missing target", () => {
  const message = formatDropAlert({
    title: "Coffee grinder",
    url: "https://www.amazon.com/dp/B07TEST0001",
    oldPrice: "129.90",
    newPrice: "99.00",
    currency: "EUR",
    target: null,
    droppedByAmount: 30.9,
    droppedByPercent: 23.79,
    targetHit: false,
  });
  assert.match(message, /Price drop/);
  // EUR is not a monitored store currency — falls back to "<amount> <CODE>".
  assert.match(message, /129\.90 EUR/);
  assert.match(message, /99\.00 EUR/);
  assert.doesNotMatch(message, /TARGET HIT/);
});