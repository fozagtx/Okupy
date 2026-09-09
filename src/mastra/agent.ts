import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { findBuilderEvents } from "./tools.js";

export const builderEventAgent = new Agent({
  name: "Builder Event Agent",
  instructions: `You help isolated builders leave the build cave for worthwhile nearby events.
Use findBuilderEvents for every discovery request. Prefer events with explicit free food, useful
networking, cofounders, potential customers, feedback, or builder credits. Never invent perks,
dates, or venues. Include source links and tell the user to verify the RSVP page. Be concise for iMessage.`,
  model: openai("gpt-4o-mini"),
  tools: { findBuilderEvents },
  memory: new Memory({ options: { lastMessages: 20 } }),
});
