import { builderEventAgent } from "./agent.js";
import { getProfile } from "./profiles.js";

export async function respond(userId: string, message: string) {
  const profile = await getProfile(userId);
  if (!profile) return "Tell me what you're building, your city, and whether you need cofounders, customers, or feedback.";
  const prompt = `Builder profile: ${JSON.stringify(profile)}\nCurrent request: ${message}`;
  const result = await builderEventAgent.generate(prompt, { memory: { thread: userId, resource: userId } });
  return result.text;
}
