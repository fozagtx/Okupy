import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeGmailRequest, formatOffersForImessage } from "../src/agent/gmail-agent.js";
import { scanGmailOffers, type GmailOffer } from "../src/agent/composio.js";

test("looksLikeGmailRequest routes explicit Gmail/email offer requests", () => {
  assert.equal(looksLikeGmailRequest("check my Gmail for Amazon and Jumia offers"), true);
  assert.equal(looksLikeGmailRequest("check my gmail for deals"), true);
  assert.equal(looksLikeGmailRequest("scan my inbox for promos"), true);
  assert.equal(looksLikeGmailRequest("check my email for discounts"), true);
  assert.equal(looksLikeGmailRequest("check my gmail"), true);
  assert.equal(looksLikeGmailRequest("look in my mail for amazon sales"), true);
  assert.equal(looksLikeGmailRequest("show my email offers"), true);

  // Negative cases that should route to other agents or onboarding
  assert.equal(looksLikeGmailRequest("Find an event with free pizza tonight"), false);
  assert.equal(looksLikeGmailRequest("https://www.amazon.com/dp/B09V3KXJPB"), false);
  assert.equal(looksLikeGmailRequest("track this jumia link https://www.jumia.com.gh/phone-123456.html"), false);
  assert.equal(looksLikeGmailRequest("remind me in 2 hours to sleep"), false);
});

test("formatOffersForImessage returns concise iMessage-friendly listings", () => {
  const empty = formatOffersForImessage([]);
  assert.match(empty, /No Amazon or Jumia offers found/);

  const sampleOffers: GmailOffer[] = [
    {
      messageId: "msg_1",
      subject: "Lightning Deals: Up to 40% off Logitech mice",
      from: "deals@amazon.com",
      date: "2026-09-10T12:00:00Z",
      store: "amazon",
      productLinks: ["https://www.amazon.com/dp/B09V3KXJPB"],
      snippet: "Check out today's top deals on computer accessories",
    },
    {
      messageId: "msg_2",
      subject: "Flash Sale: Tecno and Infinix Smartphones",
      from: "promo@jumia.com.gh",
      date: "2026-09-10T11:00:00Z",
      store: "jumia",
      productLinks: [
        "https://www.jumia.com.gh/tecno-spark-50-300723006.html",
        "https://www.jumia.com.gh/infinix-hot-40-300723007.html",
      ],
      snippet: "Massive price cuts today only",
    },
  ];

  const formatted = formatOffersForImessage(sampleOffers);
  assert.match(formatted, /1\. \[Amazon\]/);
  assert.match(formatted, /https:\/\/www\.amazon\.com\/dp\/B09V3KXJPB/);
  assert.match(formatted, /2\. \[Jumia\]/);
  assert.match(formatted, /\(\+1 more\)/);
  assert.match(formatted, /https:\/\/www\.jumia\.com\.gh\/tecno-spark-50-300723006\.html/);
});

test("scanGmailOffers returns not_configured when COMPOSIO_API_KEY is missing", async () => {
  const originalKey = process.env.COMPOSIO_API_KEY;
  try {
    delete process.env.COMPOSIO_API_KEY;
    const result = await scanGmailOffers("test-user-123");
    assert.equal(result.status, "not_configured");
    assert.match(result.note, /COMPOSIO_API_KEY is not set/);
  } finally {
    if (originalKey !== undefined) {
      process.env.COMPOSIO_API_KEY = originalKey;
    }
  }
});
