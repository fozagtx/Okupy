import assert from "node:assert/strict";
import test from "node:test";
import { canonicalAmazonUrl, comparePrices, extractAsinFromUrl } from "../src/mastra/amazon.js";

test("extractAsinFromUrl pulls ASIN from common Amazon URL shapes", () => {
  assert.equal(extractAsinFromUrl("https://www.amazon.com/dp/B09V3KXJPB"), "B09V3KXJPB");
  assert.equal(extractAsinFromUrl("https://amazon.com/gp/product/B09V3KXJPB/ref=foo"), "B09V3KXJPB");
  assert.equal(extractAsinFromUrl("https://www.amazon.com/Something/dp/B09V3KXJPB/?tag=abc"), "B09V3KXJPB");
  assert.equal(extractAsinFromUrl("https://www.amazon.com/dp/b09v3kxjpb"), "B09V3KXJPB");
  assert.equal(extractAsinFromUrl("https://www.amazon.com/stores/SomeBrand/page/12345"), null);
  assert.equal(extractAsinFromUrl("not a url"), null);
  assert.equal(extractAsinFromUrl("https://example.com/dp/B09V3KXJPB"), null);
});

test("canonicalAmazonUrl rewrites arbitrary Amazon URLs to /dp/<ASIN>", () => {
  const url = canonicalAmazonUrl("https://www.amazon.com/SomethingElse/dp/B09V3KXJPB/?ref=something&tag=abc");
  assert.ok(url);
  const parsed = new URL(url as string);
  assert.equal(parsed.hostname, "www.amazon.com");
  assert.equal(parsed.pathname, "/dp/B09V3KXJPB");
  assert.equal(parsed.search, "");
});

test("comparePrices detects drops, target hits, and unchanged prices", () => {
  const drop = comparePrices("199.99", "149.99", "USD");
  assert.equal(drop.droppedByAmount, 50);
  assert.ok(drop.droppedByPercent !== null && drop.droppedByPercent > 24 && drop.droppedByPercent < 26);
  assert.equal(drop.reachedTarget, false);

  const target = comparePrices("199.99", "149.99", "USD", "150");
  assert.equal(target.reachedTarget, true);

  const flat = comparePrices("99.00", "99.00", "USD", "120");
  assert.equal(flat.droppedByAmount, null);
  assert.equal(flat.reachedTarget, true);

  const noPrev = comparePrices(null, "149.99", "USD", "200");
  assert.equal(noPrev.droppedByAmount, null);
  assert.equal(noPrev.changed, false);
});

test("comparePrices treats malformed strings as no-change", () => {
  const result = comparePrices("not-a-number", "149.99", "USD");
  assert.equal(result.droppedByAmount, null);
  assert.equal(result.changed, false);
});