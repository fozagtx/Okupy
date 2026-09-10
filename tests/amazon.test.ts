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
  searchProducts,
  storePolicy,
  unsupportedStoreMessage,
} from "../src/agent/amazon.js";
import { looksLikeAmazonRequest, looksLikeEventRequest, respond } from "../src/agent/respond.js";
import { formatMoney, nextCheckAt, WATCH_CHECK_INTERVAL_MS } from "../src/agent/watch-scheduler.js";
import { createWatchToolsForUser } from "../src/agent/watch-tools.js";

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
  assert.equal(looksLikeAmazonRequest("Find an iPhone 16 on Jumia and track it"), true);
  assert.equal(looksLikeAmazonRequest("Search Amazon for an MX Master 3S"), true);
  assert.equal(looksLikeAmazonRequest("Monitor the price of a Tecno Spark 50"), true);
  assert.equal(looksLikeAmazonRequest("drop me events with free food tonight"), false);
  assert.equal(looksLikeAmazonRequest("watch for meetups near me"), false);
  assert.equal(looksLikeAmazonRequest("what's the price of pizza at the venue?"), false);
});

test("looksLikeEventRequest detects explicit event queries", () => {
  assert.equal(looksLikeEventRequest("drop me events with free food tonight"), true);
  assert.equal(looksLikeEventRequest("find meetups near me"), true);
  assert.equal(looksLikeEventRequest("any hackathons this weekend?"), true);
  assert.equal(looksLikeEventRequest("hello"), false);
  assert.equal(looksLikeEventRequest("https://www.amazon.com/dp/B09V3KXJPB"), false);
  assert.equal(looksLikeEventRequest("check my Gmail for deals"), false);
});

test("respond routes general greetings to watch agent without onboarding", async () => {
  const originalAimlKey = process.env.AIML_API_KEY;
  try {
    delete process.env.AIML_API_KEY;
    const greeting = await respond("test-user-greeting", "hello");
    assert.equal(greeting.agent, "watch");
    assert.equal(greeting.needsOnboarding, false);
    assert.match(greeting.reply, /Add AIML_API_KEY/);
    assert.doesNotMatch(greeting.reply, /What are you building/i);

    const checkGmail = await respond("test-user-gmail", "check my Gmail for Amazon deals");
    assert.equal(checkGmail.agent, "gmail");
    assert.equal(checkGmail.needsOnboarding, false);

    const checkEvent = await respond("test-user-event", "free food events this week");
    assert.equal(checkEvent.agent, "event");
    assert.equal(checkEvent.needsOnboarding, false);
  } finally {
    if (originalAimlKey !== undefined) process.env.AIML_API_KEY = originalAimlKey;
  }
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

test("searchProducts returns canonical supported product listings", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.FIRECRAWL_API_KEY;
  let requestBody: Record<string, unknown> | null = null;
  process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          web: [
            {
              title: "Logitech MX Master 3S",
              description: "Wireless performance mouse",
              url: "https://www.amazon.com/Logitech-MX-Master-3S/dp/B09V3KXJPB?tag=search",
            },
            {
              title: "Logitech MX Master 3S duplicate",
              url: "https://www.amazon.com/dp/B09V3KXJPB?ref=duplicate",
            },
            {
              title: "TECNO Spark 50",
              description: "128 GB phone",
              url: "https://www.jumia.com.gh/phones/tecno-spark-50-300723006.html?utm_source=search",
            },
            { title: "Amazon search page", url: "https://www.amazon.com/s?k=mx+master" },
            { title: "Unsupported Jumia country", url: "https://www.jumia.com.ng/x-12345678.html" },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const results = await searchProducts("Logitech MX Master 3S", "both", 5);
    assert.deepEqual(
      results.map(result => ({ store: result.store, productId: result.productId, url: result.url })),
      [
        { store: "amazon", productId: "B09V3KXJPB", url: "https://www.amazon.com/dp/B09V3KXJPB" },
        {
          store: "jumia",
          productId: "300723006",
          url: "https://www.jumia.com.gh/phones/tecno-spark-50-300723006.html",
        },
      ],
    );
    assert.deepEqual(requestBody?.includeDomains, ["amazon.com", "jumia.com.gh"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalApiKey;
  }
});

test("iMessage watch tools bind the sender identity server-side", () => {
  const tools = createWatchToolsForUser("imessage-sender-123");
  assert.equal("userId" in tools.addWatchItem.inputSchema.shape, false);
  assert.equal("userId" in tools.listWatchCart.inputSchema.shape, false);
  assert.equal(typeof tools.searchProducts.execute, "function");
  assert.equal(
    tools.addWatchItem.inputSchema.safeParse({
      url: "https://www.amazon.com/dp/B09V3KXJPB",
      fetchNow: false,
    }).success,
    true,
  );
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
