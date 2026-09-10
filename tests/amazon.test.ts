import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalAmazonUrl,
  canonicalJumiaUrl,
  canonicalProductUrl,
  comparePrices,
  detectStore,
  detectStoreFromUrl,
  extractAsinFromUrl,
  extractJumiaSkuFromUrl,
  extractProductIdFromUrl,
  isAmazonHost,
  isJumiaGhanaHost,
  isJumiaHost,
  isStoreEnabled,
  storePolicy,
  unsupportedStoreMessage,
} from "../src/mastra/amazon.js";
import { looksLikeAmazonRequest } from "../src/mastra/respond.js";
import { formatMoney, nextCheckAt, WATCH_CHECK_INTERVAL_MS } from "../src/mastra/watch-scheduler.js";

test("extractAsinFromUrl pulls ASIN from common Amazon URL shapes", () => {
  assert.equal(extractAsinFromUrl("https://www.amazon.com/dp/B09V3KXJPB"), "B09V3KXJPB");
  assert.equal(extractAsinFromUrl("https://amazon.com/gp/product/B09V3KXJPB/ref=foo"), "B09V3KXJPB");
  assert.equal(extractAsinFromUrl("https://www.amazon.com/Something/dp/B09V3KXJPB/?tag=abc"), "B09V3KXJPB");
  assert.equal(extractAsinFromUrl("https://www.amazon.com/dp/b09v3kxjpb"), "B09V3KXJPB");
  assert.equal(extractAsinFromUrl("https://www.amazon.co.uk/dp/B09V3KXJPB"), "B09V3KXJPB");
  assert.equal(extractAsinFromUrl("https://www.amazon.com/stores/SomeBrand/page/12345"), null);
  assert.equal(extractAsinFromUrl("not a url"), null);
  assert.equal(extractAsinFromUrl("https://example.com/dp/B09V3KXJPB"), null);
});

test("isAmazonHost accepts regional Amazon domains and rejects lookalikes", () => {
  assert.equal(isAmazonHost("www.amazon.com"), true);
  assert.equal(isAmazonHost("amazon.co.uk"), true);
  assert.equal(isAmazonHost("smile.amazon.com"), true);
  assert.equal(isAmazonHost("www.amzn.to"), true);
  assert.equal(isAmazonHost("notamazon.com"), false);
  assert.equal(isAmazonHost("www.amazon.com.evil.example"), false);
  assert.equal(isAmazonHost("example.com"), false);
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

test("looksLikeAmazonRequest routes watch intent without stealing event queries", () => {
  assert.equal(looksLikeAmazonRequest("https://www.amazon.com/dp/B09V3KXJPB"), true);
  assert.equal(looksLikeAmazonRequest("track https://amazon.co.uk/dp/B09V3KXJPB for me"), true);
  assert.equal(looksLikeAmazonRequest("https://www.amazon.com.evil.example/dp/B09V3KXJPB"), false);
  assert.equal(looksLikeAmazonRequest("alert me when this drops under $150"), true);
  assert.equal(looksLikeAmazonRequest("add this to my watchlist please"), true);
  assert.equal(
    looksLikeAmazonRequest("https://www.jumia.com.gh/tecno-spark-50-128gb-300723006.html"),
    true,
  );
  assert.equal(looksLikeAmazonRequest("https://www.jumia.com.ng/x-12345678.html"), false);
  assert.equal(looksLikeAmazonRequest("track this jumia.com.gh link for me, price drop alerts"), true);
  assert.equal(looksLikeAmazonRequest("drop me events with free food tonight"), false);
  assert.equal(looksLikeAmazonRequest("watch for meetups near me"), false);
  assert.equal(looksLikeAmazonRequest("link up with founders this week"), false);
  assert.equal(looksLikeAmazonRequest("what's the price of pizza at the venue?"), false);
});

test("jumia sku extraction pulls the trailing id from product urls", () => {
  assert.equal(
    extractJumiaSkuFromUrl("https://www.jumia.com.gh/tecno-spark-50-128gb-300723006.html"),
    "300723006",
  );
  assert.equal(
    extractJumiaSkuFromUrl("https://www.jumia.com.gh/spark-50-pro-ink-black-tecno-mpg13390732.html"),
    "MPG13390732",
  );
  assert.equal(extractJumiaSkuFromUrl("https://www.jumia.com.gh/catalog/?q=tecno"), null);
  assert.equal(extractJumiaSkuFromUrl("https://www.amazon.com/dp/B09V3KXJPB"), null);
  assert.equal(canonicalJumiaUrl("https://www.jumia.com.ng/x-12345678.html?foo=bar"), null);
  assert.equal(
    canonicalJumiaUrl("http://www.jumia.com.gh/phones/x-12345678.html?foo=bar#details"),
    "https://www.jumia.com.gh/phones/x-12345678.html",
  );
});

test("store detection separates amazon, jumia ghana, and unknown hosts", () => {
  assert.equal(detectStore("www.amazon.com"), "amazon");
  assert.equal(detectStore("www.jumia.com.gh"), "jumia");
  assert.equal(detectStore("www.jumia.com.ng"), null);
  assert.equal(detectStore("www.jumia.co.ke"), null);
  assert.equal(detectStore("example.com"), null);
  assert.equal(isJumiaHost("www.jumia.com.gh"), true);
  assert.equal(isJumiaHost("www.jumia.com.ng"), false);
  assert.equal(isJumiaGhanaHost("www.jumia.com.gh"), true);
  assert.equal(isJumiaGhanaHost("www.jumia.com.ng"), false);
  assert.equal(isAmazonHost("www.jumia.com.gh"), false);
  assert.equal(detectStoreFromUrl("https://www.jumia.com.gh/a-300723006.html"), "jumia");
  assert.equal(detectStoreFromUrl("https://www.jumia.com.ng/a-300723006.html"), null);
  assert.equal(extractProductIdFromUrl("https://www.jumia.com.gh/a-300723006.html")?.store, "jumia");
  assert.equal(extractProductIdFromUrl("https://www.jumia.com.ng/a-300723006.html"), null);
  assert.equal(extractProductIdFromUrl("https://www.amazon.com/dp/B09V3KXJPB")?.store, "amazon");
  const resolved = canonicalProductUrl("https://www.jumia.com.gh/a-300723006.html?utm=x");
  assert.ok(resolved && resolved.store === "jumia" && resolved.url.endsWith(".html"));
});

test("unsupportedStoreMessage rejects non-ghana jumia and unknown stores", () => {
  assert.match(
    unsupportedStoreMessage("https://www.jumia.com.ng/a-300723006.html") ?? "",
    /only track Jumia Ghana/,
  );
  assert.match(
    unsupportedStoreMessage("https://www.jumia.co.ke/a-300723006.html") ?? "",
    /only track Jumia Ghana/,
  );
  assert.match(unsupportedStoreMessage("https://example.com/x.html") ?? "", /Jumia Ghana/);
  assert.equal(unsupportedStoreMessage("https://www.jumia.com.gh/a-300723006.html"), null);
  assert.equal(typeof storePolicy().jumiaGhanaOnly, "boolean");
  assert.equal(storePolicy().jumiaGhanaOnly, true);
  assert.equal(isStoreEnabled("jumia"), true);
});

test("formatMoney renders jumia ghana currency", () => {
  assert.match(formatMoney("1875", "GHS"), /GH₵/);
  assert.match(formatMoney("149.99", "USD"), /\$/);
});

test("nextCheckAt staggers items by creation offset", () => {
  const item = { createdAt: new Date(1_000).toISOString() } as Parameters<typeof nextCheckAt>[0];
  const first = nextCheckAt(item, new Date(0));
  assert.ok(first.getTime() > 0);
  const second = nextCheckAt(item, first);
  assert.equal(second.getTime() - first.getTime(), WATCH_CHECK_INTERVAL_MS);
});
