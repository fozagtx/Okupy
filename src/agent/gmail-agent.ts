/**
 * gmail-agent.ts
 *
 * User-triggered Gmail offer scanning agent.
 *
 * Flow:
 *   1. User says "check my Gmail for Amazon / Jumia offers" via iMessage.
 *   2. respond.ts detects the intent and calls runGmailAgent().
 *   3. The agent calls scanGmailOffers → gets structured offer list.
 *   4. Agent presents offers concisely (iMessage-friendly).
 *   5. User replies "track 1 and 3" → agent calls addWatchItem for each
 *      selected offer's product links and confirms with baseline prices.
 *
 * Identity binding:
 *   The userId is always the iMessage sender phone/handle, so Composio
 *   sessions are always scoped to the right person — no cross-user leakage.
 */

import { generateText, tool, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { config } from "./config.js";
import { scanGmailOffers, type GmailOffer } from "./composio.js";
import { createWatchToolsForUser } from "./watch-tools.js";
import { threadStore } from "./threads.js";

const aiml = createOpenAI({
  baseURL: config.aimlApiBaseUrl,
  apiKey: process.env.AIML_API_KEY,
});

// ---- Tool: scanGmailForOffers -----------------------------------------------

const scanGmailParameters = z.object({
  maxMessages: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe("How many promotional emails to scan. Default 10."),
});

function makeGmailScanTool(userId: string) {
  return {
    description:
      "Scan the user's Gmail inbox for Amazon and Jumia promotional emails. Returns structured offers with product links. Only call when the user explicitly asks to check their Gmail or email for deals/offers.",
    inputSchema: scanGmailParameters,
    execute: async (input: z.input<typeof scanGmailParameters>) => {
      const parsed = scanGmailParameters.parse(input);
      const result = await scanGmailOffers(userId, parsed.maxMessages);
      if (result.status === "not_configured") {
        return {
          ok: false,
          reason: "not_configured",
          note: result.note,
          offers: [],
        };
      }
      if (result.status === "not_connected") {
        return {
          ok: false,
          reason: "not_connected",
          note: result.note,
          redirectUrl: result.redirectUrl,
          offers: [],
        };
      }
      if (result.status === "error") {
        return { ok: false, reason: "error", note: result.note, offers: [] };
      }
      return { ok: true, offers: result.offers, total: result.total };
    },
  };
}

// ---- System prompt -----------------------------------------------------------

const GMAIL_SYSTEM_PROMPT = `You are an iMessage-first deal-scanner for a builder's Amazon and Jumia Ghana inbox.
When the user says "check my Gmail for offers", "check my email for deals", or similar, call scanGmailForOffers.

Presenting offers:
- List offers numbered 1 to N (cap at 10 visible at once).
- Each line: number, store name, subject line snippet, and the first product link.
- If an offer has more than one product link, say "(+N more links)".
- Keep each line short — iMessage doesn't wrap nicely.
- End with: "Reply with the numbers you want tracked, e.g. '1 3 5', or 'none' to skip."

Tracking selected offers:
- When the user replies with numbers (e.g. "1 3"), recover the product links for those offers from
  the conversation and call addWatchItem for each distinct link.
- Pass no targetPrice unless the user specifies one.
- Confirm each tracked item with its title and current baseline price in one compact line.
- If an offer has multiple product links and the user didn't specify which one, track only the first.

Not connected:
- If scanGmailForOffers returns reason "not_connected", surface the redirectUrl (if any) and tell
  the user to open it to connect Gmail, then say "check my Gmail for offers" again.
- If reason is "not_configured", tell the user to ask the builder to set COMPOSIO_API_KEY.

Voice: concise, plain, conversational. No markdown headers or tables — iMessage doesn't render them.`;

// ---- Agent runner -----------------------------------------------------------

export async function runGmailAgent(
  userId: string,
  prompt: string,
): Promise<{ reply: string }> {
  const threadKey = `gmail:${userId}`;
  const history = await threadStore.list(threadKey);
  const watchTools = createWatchToolsForUser(userId);

  const aiTools = {
    scanGmailForOffers: tool(makeGmailScanTool(userId)),
    addWatchItem: tool(watchTools.addWatchItem),
    listWatchCart: tool(watchTools.listWatchCart),
  };

  const result = await generateText({
    model: aiml("gpt-4o-mini"),
    system: GMAIL_SYSTEM_PROMPT,
    tools: aiTools,
    stopWhen: stepCountIs(8),
    messages: [
      ...history.map(entry => ({ role: entry.role, content: entry.content })),
      { role: "user" as const, content: prompt },
    ],
  });

  const now = new Date().toISOString();
  await threadStore.append(threadKey, { role: "user", content: prompt, at: now });
  await threadStore.append(threadKey, { role: "assistant", content: result.text, at: now });
  return { reply: result.text };
}

// ---- Intent detection (used by respond.ts) ----------------------------------

const GMAIL_INTENT_RE =
  /\b(check|scan|look|search|find|show)\b.*?\b(gmail|email|inbox|mail)\b.*?\b(offers?|deals?|promos?|promotions?|discounts?|sales?|amazon|jumia)\b|\b(offers?|deals?|promos?|promotions?|discounts?)\b.*?\b(in|from)\s+(my\s+)?(gmail|email|inbox|mail)\b|\b(gmail|email|inbox)\b.*?\b(check|scan|offers?|deals?|promos?|promotions?|discounts?|sales?|amazon|jumia)\b/i;

const GMAIL_SHORT_RE =
  /\bcheck\s+(in\s+|through\s+)?(my\s+)?(gmail|email|inbox)\b|\b(my\s+)?(gmail|inbox)\s+(for\s+)?(offers?|deals?|promos?)\b/i;

export function looksLikeGmailRequest(message: string): boolean {
  const v = (message ?? "").trim();
  return GMAIL_INTENT_RE.test(v) || GMAIL_SHORT_RE.test(v);
}

// ---- Offer formatting (utility for direct HTTP route) -----------------------

export function formatOffersForImessage(offers: GmailOffer[]): string {
  if (offers.length === 0) return "No Amazon or Jumia offers found in your Gmail in the last 14 days.";
  const lines = offers.slice(0, 10).map((offer, i) => {
    const store = offer.store === "amazon" ? "Amazon" : offer.store === "jumia" ? "Jumia" : "Store";
    const firstLink = offer.productLinks[0] ?? "(no direct link)";
    const extra = offer.productLinks.length > 1 ? ` (+${offer.productLinks.length - 1} more)` : "";
    return `${i + 1}. [${store}] ${offer.subject.slice(0, 50)}${extra}\n   ${firstLink}`;
  });
  return lines.join("\n\n");
}
