import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { config, secret } from "./config.js";
import { reminderStore } from "./reminders.js";

const eventSchema = z.object({
  title: z.string(),
  url: z.url(),
  summary: z.string(),
  date: z.string().nullable(),
  location: z.string(),
  freeFood: z.boolean(),
  networking: z.boolean(),
  builderCredits: z.boolean(),
  why: z.string(),
});

const exaResultSchema = z.object({
  title: z.string().optional(),
  url: z.url(),
  text: z.string().optional(),
  highlights: z.array(z.string()).optional(),
});

export type BuilderEvent = z.output<typeof eventSchema>;

export function classifyEvent(item: unknown, location: string, project: string): BuilderEvent | null {
  const parsed = exaResultSchema.safeParse(item);
  if (!parsed.success) return null;
  const value = parsed.data;
  const evidence = [value.title, value.text, ...(value.highlights ?? [])].filter(Boolean).join(" ");
  const normalized = evidence.toLowerCase();
  const freeFood = ["free food", "pizza", "lunch", "dinner", "refreshments", "catering"].some(signal => normalized.includes(signal));
  const networking = ["network", "founder", "demo day", "meetup", "pitch", "cofounder"].some(signal => normalized.includes(signal));
  const builderCredits = ["credits", "startup perk", "grant", "compute"].some(signal => normalized.includes(signal));
  const signals = [freeFood && "free food", networking && "people to meet", builderCredits && "builder credits"].filter(Boolean);
  if (!freeFood && !networking && !builderCredits) return null;

  return {
    title: value.title?.trim() || "Untitled event",
    url: value.url,
    summary: (value.text ?? "").slice(0, 500),
    date: null,
    location,
    freeFood,
    networking,
    builderCredits,
    why: `Matches ${project}: ${signals.join(", ") || "potential local builder event"}`,
  };
}

export const findBuilderEvents = createTool({
  id: "find-builder-events",
  description: "Find current local events offering food, networking, startup perks, or builder credits.",
  inputSchema: z.object({
    location: z.string().trim().min(2),
    project: z.string().trim().min(2),
    interests: z.array(z.string()).default([]),
    radiusMiles: z.number().int().min(1).max(250).default(25),
    request: z.string().default("Find me something worthwhile this week"),
  }),
  outputSchema: z.object({ results: z.array(eventSchema) }),
  execute: async input => {
    const apiKey = secret("EXA_API_KEY");
    if (!apiKey) throw new Error("EXA_API_KEY is required for event discovery.");

    const now = new Date();
    const until = new Date(now.getTime() + config.searchWindowDays * 86_400_000);
    const query = [
      `Upcoming free in-person founder, startup, developer, demo day, hackathon, or community events within ${input.radiusMiles} miles of "${input.location}"`,
      `between ${now.toISOString().slice(0, 10)} and ${until.toISOString().slice(0, 10)}.`,
      "Prioritize explicit free food, pizza, meals, refreshments, networking, cloud credits, grants, or startup perks.",
      `Relevant to: ${input.project}; ${input.interests.join(", ")}. Request: ${input.request}`,
    ].join(" ");
    const response = await fetch(config.exaSearchUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: config.maxResults,
        startPublishedDate: `${now.toISOString().slice(0, 10)}T00:00:00.000Z`,
        contents: { text: { maxCharacters: 1_800 } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Exa search failed (${response.status}).`);

    const body = z.object({ results: z.array(z.unknown()).optional() }).parse(await response.json());
    return {
      results: (body.results ?? [])
        .map(item => classifyEvent(item, input.location, input.project))
        .filter((event): event is BuilderEvent => event !== null),
    };
  },
});

const reminderSummarySchema = z.object({
  id: z.string(),
  fireAt: z.string(),
  message: z.string(),
  eventTitle: z.string().nullable(),
  eventUrl: z.url().nullable(),
  status: z.enum(["pending", "fired", "cancelled"]),
});

export const scheduleReminder = createTool({
  id: "schedule-reminder",
  description: "Schedule a reminder message for a future time. Use after findBuilderEvents when the user says \"remind me\", \"set a timer\", \"ping me in 4 hours\", or \"remind me 12 hours before\". Times must be in the future. Returns the persisted reminder so the agent can confirm.",
  inputSchema: z.object({
    userId: z.string().trim().min(1).max(256),
    fireAt: z.iso.datetime({ offset: true }).describe("ISO-8601 datetime when the reminder should fire"),
    message: z.string().trim().min(1).max(1_000).describe("Short iMessage-friendly reminder text"),
    eventTitle: z.string().trim().max(240).optional(),
    eventUrl: z.url().optional(),
  }),
  outputSchema: reminderSummarySchema,
  execute: async input => {
    const fireAt = new Date(input.fireAt);
    if (Number.isNaN(fireAt.getTime())) throw new Error("fireAt must be a valid ISO datetime.");
    if (fireAt.getTime() <= Date.now()) throw new Error("fireAt must be in the future.");
    const reminder = await reminderStore.create({ ...input, fireAt: fireAt.toISOString() });
    return {
      id: reminder.id,
      fireAt: reminder.fireAt,
      message: reminder.message,
      eventTitle: reminder.eventTitle ?? null,
      eventUrl: reminder.eventUrl ?? null,
      status: reminder.status,
    };
  },
});

export const listReminders = createTool({
  id: "list-reminders",
  description: "List reminders for a user, newest pending first. Use when the user asks what is on their schedule or wants to confirm a reminder was set.",
  inputSchema: z.object({
    userId: z.string().trim().min(1).max(256),
    includeFired: z.boolean().default(false),
  }),
  outputSchema: z.object({ reminders: z.array(reminderSummarySchema) }),
  execute: async input => {
    const all = input.includeFired
      ? await reminderStore.listForUser(input.userId)
      : await reminderStore.listActiveForUser(input.userId);
    return {
      reminders: all.map(reminder => ({
        id: reminder.id,
        fireAt: reminder.fireAt,
        message: reminder.message,
        eventTitle: reminder.eventTitle ?? null,
        eventUrl: reminder.eventUrl ?? null,
        status: reminder.status,
      })),
    };
  },
});

export const cancelReminder = createTool({
  id: "cancel-reminder",
  description: "Cancel a pending reminder. Use when the user says \"cancel that reminder\", \"forget the reminder\", or no longer wants to be notified.",
  inputSchema: z.object({
    userId: z.string().trim().min(1).max(256),
    reminderId: z.string().trim().min(1).max(256),
  }),
  outputSchema: z.object({ cancelled: z.boolean(), reminder: reminderSummarySchema.nullable() }),
  execute: async input => {
    const reminder = await reminderStore.cancel(input.reminderId, input.userId);
    return {
      cancelled: reminder?.status === "cancelled",
      reminder: reminder
        ? {
            id: reminder.id,
            fireAt: reminder.fireAt,
            message: reminder.message,
            eventTitle: reminder.eventTitle ?? null,
            eventUrl: reminder.eventUrl ?? null,
            status: reminder.status,
          }
        : null,
    };
  },
});
