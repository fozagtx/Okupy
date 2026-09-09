import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { config, secret } from "./config.js";

export const findBuilderEvents = createTool({
  id: "find-builder-events",
  description: "Find current local events offering food, networking, startup perks, or builder credits.",
  inputSchema: z.object({ location: z.string(), project: z.string(), request: z.string() }),
  outputSchema: z.object({ results: z.array(z.object({ title: z.string(), url: z.string(), summary: z.string() })) }),
  execute: async ({ context }) => {
    const apiKey = secret("EXA_API_KEY");
    if (!apiKey) throw new Error("EXA_API_KEY is required for event discovery.");
    const now = new Date();
    const until = new Date(now.getTime() + config.searchWindowDays * 86_400_000);
    const query = [
      `Upcoming free founder, startup, developer, demo day, hackathon, or community events near ${context.location}`,
      `between ${now.toISOString().slice(0, 10)} and ${until.toISOString().slice(0, 10)}.`,
      "Prioritize explicit free food, pizza, meals, refreshments, networking, cloud credits, grants, or startup perks.",
      `The builder is making: ${context.project}. Request: ${context.request}`,
    ].join(" ");
    const response = await fetch(config.exaSearchUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query, type: "auto", numResults: config.maxResults, contents: { text: { maxCharacters: 1800 }, highlights: { numSentences: 4 } } }),
    });
    if (!response.ok) throw new Error(`Exa search failed (${response.status}).`);
    const body = await response.json() as { results?: Array<{ title?: string; url?: string; text?: string }> };
    return { results: (body.results ?? []).filter(item => item.url).map(item => ({ title: item.title || "Untitled event", url: item.url!, summary: (item.text ?? "").slice(0, 500) })) };
  },
});
