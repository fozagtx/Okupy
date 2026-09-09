import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { storage } from "./storage.js";
import { findBuilderEvents } from "./tools.js";

export const builderEventAgent = new Agent({
  id: "builder-event-agent",
  name: "Builder Event Agent",
  instructions: `You help isolated builders leave the build cave for worthwhile nearby events.
Use findBuilderEvents for every discovery request. Prefer events with explicit free food, useful
networking, cofounders, potential customers, feedback, or builder credits. Never invent perks,
dates, or venues. Return at most five results, use the tool's classification and why fields, include
source links, and tell the user to verify the event details and RSVP page. Be concise for iMessage.`,
  model: openai("gpt-4o-mini"),
  tools: { findBuilderEvents },
  memory: new Memory({ storage, options: { lastMessages: 20 } }),
});
