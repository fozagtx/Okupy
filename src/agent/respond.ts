import { runWatchAgent } from "./watch-agent.js";
import { runGmailAgent, looksLikeGmailRequest } from "./gmail-agent.js";
import { isAmazonHost, isJumiaGhanaHost } from "./amazon.js";
import { secret } from "./config.js";

export type AgentReply = {
  userId: string;
  reply: string;
  needsOnboarding: boolean;
  agent: "watch" | "gmail";
};

const HOST_TOKEN_PATTERN = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}/gi;
const AMAZON_PATH_PATTERN = /\/(?:dp|gp\/product)\b/i;
const AMAZON_EXPLICIT_PATTERN =
  /\b(amazon|amzn|asin|buy box|target price|price track|price alert|price drop|under \$|below \$|less than \$|notify me|alert me|add .*to .*watch|watchlist|wish ?list)\b/i;

export function looksLikeAmazonRequest(message: string): boolean {
  return looksLikeWatchRequest(message);
}

/** Store-aware router: Amazon or Jumia product links, SKUs/ASINs, or price-tracking intent. */
export function looksLikeWatchRequest(message: string): boolean {
  const value = (message ?? "").trim();
  if (!value) return false;
  let hasStoreLookalike = false;
  for (const token of value.match(HOST_TOKEN_PATTERN) ?? []) {
    try {
      const hostname = new URL(token.startsWith("http") ? token : `https://${token}`).hostname;
      if (isAmazonHost(hostname) || isJumiaGhanaHost(hostname)) return true;
      if (hostname.includes("amazon") || hostname.includes("amzn") || hostname.includes("jumia")) {
        hasStoreLookalike = true;
      }
    } catch {
      // Ignore malformed host-like tokens and continue with intent classification.
    }
  }
  if (hasStoreLookalike) return false;
  if (AMAZON_PATH_PATTERN.test(value)) return true;
  // Jumia Ghana product links always end in -<ID>.html
  if (/-[A-Za-z0-9]{6,}\.html?\b/i.test(value) && /jumia\.com\.gh/i.test(value)) return true;
  if (/\bASIN\b/.test(value)) return true;
  if (/\bSKU\b/.test(value) && /jumia\.com\.gh/i.test(value)) return true;
  if (/\b(amazon|jumia)\b/i.test(value) && /\b(find|search|track|watch|monitor|buy|price|product|deal)\b/i.test(value)) {
    return true;
  }
  if (/\b(track|watch|monitor)\b/i.test(value) && /\b(price|product|item)\b/i.test(value)) return true;
  // Standalone watch-list vocabulary is unambiguous even without the word "Amazon".
  if (/\b(watchlist|wish ?list|target price|price drop|price alert|price track)\b/i.test(value)) return true;
  // Explicit price-tracking intent always counts, even without the word "Amazon".
  if (/(alert|notify|ping|text)\s+me\s+(when|if|at|under|below)/i.test(value) && /\$\s?\d|under|below|target|price/i.test(value)) return true;
  if (/amazon|amzn/i.test(value) && AMAZON_EXPLICIT_PATTERN.test(value)) return true;
  if (/amazon|amzn/i.test(value) && /(price|deal|discount|sale|cart|link|url)/i.test(value)) return true;
  if (/jumia\.com\.gh/i.test(value) && /(price|deal|discount|sale|cart|link|url|track|watch|alert|notify|target|drop)/i.test(value)) return true;
  return false;
}

export async function respond(userId: string, message: string): Promise<AgentReply> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("A user ID is required.");

  // Gmail offer scan: checked first so "check my Gmail for Amazon offers" isn't
  // hijacked by general product tracking.
  if (looksLikeGmailRequest(message)) {
    if (!secret("AIML_API_KEY")) {
      return {
        userId: normalizedUserId,
        reply: "Add AIML_API_KEY so I can scan your Gmail for offers.",
        needsOnboarding: false,
        agent: "gmail",
      };
    }
    const result = await runGmailAgent(normalizedUserId, message);
    return { userId: normalizedUserId, reply: result.reply, needsOnboarding: false, agent: "gmail" };
  }

  // DEFAULT AGENT: Watch / price tracking concierge (Amazon & Jumia Ghana)
  if (!secret("AIML_API_KEY")) {
    return {
      userId: normalizedUserId,
      reply: "Add AIML_API_KEY so I can track prices for you.",
      needsOnboarding: false,
      agent: "watch",
    };
  }
  const result = await runWatchAgent(normalizedUserId, message);
  return { userId: normalizedUserId, reply: result.reply, needsOnboarding: false, agent: "watch" };
}
