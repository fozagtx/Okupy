import { runEventAgent } from "./event-agent.js";
import { runWatchAgent } from "./watch-agent.js";
import { secret } from "./config.js";
import { profileStore } from "./profiles.js";

export type AgentReply = {
  userId: string;
  reply: string;
  needsOnboarding: boolean;
  agent: "event" | "watch";
};

const AMAZON_KEYWORDS =
  /\b(amazon|amzn|prime|\bprice\b|\bcart\b|\bdrop\b|\bdrops\b|\bdiscount\b|\bwatch(ing)?\b|\bdeal\b|\bsale\b|\bbargain\b|\bASIN\b|\bdp\/|\bgp\/product\b|notify me|alert me|under \$|below \$|less than \$|target price|wishlist|under \d|\bbuy box\b|\blink\b)/i;

export function looksLikeAmazonRequest(message: string): boolean {
  const value = message.toLowerCase();
  if (!value) return false;
  if (/(?:https?:\/\/)?(?:www\.)?(?:amazon\.|amzn\.)/.test(value)) return true;
  if (value.includes("dp/") || value.includes("/gp/product")) return true;
  if (AMAZON_KEYWORDS.test(value)) return true;
  return false;
}

export async function respond(userId: string, message: string): Promise<AgentReply> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("A user ID is required.");

  if (looksLikeAmazonRequest(message)) {
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

  const profile = await profileStore.getProfile(normalizedUserId);
  if (!profile) {
    if (await profileStore.hasOnboarding(normalizedUserId)) {
      const onboarding = await profileStore.advanceOnboarding(normalizedUserId, message);
      return {
        userId: normalizedUserId,
        reply: onboarding.reply,
        needsOnboarding: !onboarding.complete,
        agent: "event",
      };
    }
    return {
      userId: normalizedUserId,
      reply: await profileStore.beginOnboarding(normalizedUserId),
      needsOnboarding: true,
      agent: "event",
    };
  }

  if (!secret("EXA_API_KEY")) {
    return {
      userId: normalizedUserId,
      reply: "I remember what you're building. Add EXA_API_KEY so I can search live events for you.",
      needsOnboarding: false,
      agent: "event",
    };
  }
  if (!secret("AIML_API_KEY")) {
    return {
      userId: normalizedUserId,
      reply: "I remember what you're building. Add AIML_API_KEY so I can coordinate live event discovery.",
      needsOnboarding: false,
      agent: "event",
    };
  }

  const result = await runEventAgent(
    normalizedUserId,
    `Builder profile: ${JSON.stringify(profile)}\nCurrent request: ${message.trim() || "Find me something worthwhile this week"}`,
  );
  return { userId: normalizedUserId, reply: result.reply, needsOnboarding: false, agent: "event" };
}