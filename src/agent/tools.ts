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

const searchResultSchema = z.object({
  title: z.string().optional(),
  url: z.url(),
  text: z.string().optional(),
  description: z.string().optional(),
  markdown: z.string().optional(),
  highlights: z.array(z.string()).optional(),
});

export type BuilderEvent = z.output<typeof eventSchema>;

export function classifyEvent(item: unknown, location: string, project: string): BuilderEvent | null {
  const parsed = searchResultSchema.safeParse(item);
  if (!parsed.success) return null;
  const value = parsed.data;
  const evidence = [value.title, value.description, value.text, value.markdown, ...(value.highlights ?? [])]
    .filter(Boolean)
    .join(" ");
  const normalized = evidence.toLowerCase();
  const freeFood = ["free food", "pizza", "lunch", "dinner", "refreshments", "catering"].some(signal => normalized.includes(signal));
  const networking = ["network", "founder", "demo day", "meetup", "pitch", "cofounder"].some(signal => normalized.includes(signal));
  const builderCredits = ["credits", "startup perk", "grant", "compute"].some(signal => normalized.includes(signal));
  const signals = [freeFood && "free food", networking && "people to meet", builderCredits && "builder credits"].filter(Boolean);
  if (!freeFood && !networking && !builderCredits) return null;

  return {
    title: value.title?.trim() || "Untitled event",
    url: value.url,
    summary: (value.description ?? value.text ?? value.markdown ?? "").slice(0, 500),
    date: null,
    location,
    freeFood,
    networking,
    builderCredits,
    why: `Matches ${project}: ${signals.join(", ") || "potential local builder event"}`,
  };
}

const findBuilderEventsParameters = z.object({
  location: z.string().trim().min(2),
  project: z.string().trim().min(2),
  interests: z.array(z.string()).default([]),
  radiusMiles: z.number().int().min(1).max(250).default(25),
  request: z.string().default("Find me something worthwhile this week"),
});

export async function executeFindBuilderEvents(input: z.input<typeof findBuilderEventsParameters>): Promise<{ results: BuilderEvent[] }> {
  const apiKey = secret("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is required for event discovery.");

  const parsed = findBuilderEventsParameters.parse(input);
  const now = new Date();
  const until = new Date(now.getTime() + config.searchWindowDays * 86_400_000);
  const query = [
    `Upcoming in-person founder, startup, developer, demo day, hackathon, tech events in ${parsed.location}`,
    `between ${now.toISOString().slice(0, 10)} and ${until.toISOString().slice(0, 10)}`,
    "free food pizza networking cloud credits grants",
    parsed.project,
    parsed.interests.join(" "),
    parsed.request,
  ].filter(Boolean).join(" ");

  const response = await fetch(config.firecrawlSearchUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit: Math.min(20, Math.max(config.maxResults, 5)),
      sources: ["web"],
      ignoreInvalidURLs: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Firecrawl search failed (${response.status}).`);

  const body = z
    .object({
      success: z.boolean().optional(),
      data: z
        .object({
          web: z.array(z.unknown()).optional(),
        })
        .optional(),
      results: z.array(z.unknown()).optional(),
      error: z.string().optional(),
    })
    .parse(await response.json());

  if (body.error) throw new Error(`Firecrawl search error: ${body.error}`);

  const candidates = body.data?.web ?? body.results ?? [];
  return {
    results: candidates
      .map(item => classifyEvent(item, parsed.location, parsed.project))
      .filter((event): event is BuilderEvent => event !== null),
  };
}

const scheduleReminderParameters = z.object({
  userId: z.string().trim().min(1).max(256),
  fireAt: z.string().describe("ISO-8601 datetime when the reminder should fire"),
  message: z.string().trim().min(1).max(1_000).describe("Short iMessage-friendly reminder text"),
  eventTitle: z.string().trim().max(240).optional(),
  eventUrl: z.url().optional(),
});

export async function executeScheduleReminder(input: z.input<typeof scheduleReminderParameters>) {
  const parsed = scheduleReminderParameters.parse(input);
  const fireAt = new Date(parsed.fireAt);
  if (Number.isNaN(fireAt.getTime())) throw new Error("fireAt must be a valid ISO datetime.");
  if (fireAt.getTime() <= Date.now()) throw new Error("fireAt must be in the future.");
  const reminder = await reminderStore.create({ ...parsed, fireAt: fireAt.toISOString() });
  return {
    id: reminder.id,
    fireAt: reminder.fireAt,
    message: reminder.message,
    eventTitle: reminder.eventTitle ?? null,
    eventUrl: reminder.eventUrl ?? null,
    status: reminder.status,
  };
}

const listRemindersParameters = z.object({
  userId: z.string().trim().min(1).max(256),
  includeFired: z.boolean().default(false),
});

export async function executeListReminders(input: z.input<typeof listRemindersParameters>) {
  const parsed = listRemindersParameters.parse(input);
  const all = parsed.includeFired
    ? await reminderStore.listForUser(parsed.userId)
    : await reminderStore.listActiveForUser(parsed.userId);
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
}

const cancelReminderParameters = z.object({
  userId: z.string().trim().min(1).max(256),
  reminderId: z.string().trim().min(1).max(256),
});

export async function executeCancelReminder(input: z.input<typeof cancelReminderParameters>) {
  const parsed = cancelReminderParameters.parse(input);
  const reminder = await reminderStore.cancel(parsed.reminderId, parsed.userId);
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
}

export const eventTools = {
  findBuilderEvents: {
    description: "Find current local events offering food, networking, startup perks, or builder credits.",
    inputSchema: findBuilderEventsParameters,
    execute: executeFindBuilderEvents,
  },
  scheduleReminder: {
    description:
      'Schedule a reminder for a future time. Use after findBuilderEvents when the user says "remind me", "set a timer", "ping me in 4 hours". Times must be in the future.',
    inputSchema: scheduleReminderParameters,
    execute: executeScheduleReminder,
  },
  listReminders: {
    description: "List reminders for a user, newest pending first.",
    inputSchema: listRemindersParameters,
    execute: executeListReminders,
  },
  cancelReminder: {
    description: 'Cancel a pending reminder. Use when the user says "cancel that reminder".',
    inputSchema: cancelReminderParameters,
    execute: executeCancelReminder,
  },
} as const;