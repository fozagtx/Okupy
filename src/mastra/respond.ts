import { builderEventAgent } from "./agent.js";
import { secret } from "./config.js";
import { profileStore } from "./profiles.js";

export type AgentReply = {
  userId: string;
  reply: string;
  needsOnboarding: boolean;
};

export async function respond(userId: string, message: string): Promise<AgentReply> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("A user ID is required.");

  const profile = await profileStore.getProfile(normalizedUserId);
  if (!profile) {
    if (await profileStore.hasOnboarding(normalizedUserId)) {
      const onboarding = await profileStore.advanceOnboarding(normalizedUserId, message);
      return { userId: normalizedUserId, reply: onboarding.reply, needsOnboarding: !onboarding.complete };
    }

    return {
      userId: normalizedUserId,
      reply: await profileStore.beginOnboarding(normalizedUserId),
      needsOnboarding: true,
    };
  }

  if (!secret("EXA_API_KEY")) {
    return {
      userId: normalizedUserId,
      reply: "I remember what you're building. Add EXA_API_KEY so I can search live events for you.",
      needsOnboarding: false,
    };
  }
  if (!secret("AIML_API_KEY")) {
    return {
      userId: normalizedUserId,
      reply: "I remember what you're building. Add AIML_API_KEY so I can coordinate live event discovery.",
      needsOnboarding: false,
    };
  }

  const prompt = `Builder profile: ${JSON.stringify(profile)}\nCurrent request: ${message.trim() || "Find me something worthwhile this week"}`;
  const result = await builderEventAgent.generate(prompt, {
    memory: { thread: normalizedUserId, resource: normalizedUserId },
  });
  return { userId: normalizedUserId, reply: result.text, needsOnboarding: false };
}
