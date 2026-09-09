import { mkdir } from 'node:fs/promises';
import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { z } from 'zod';
import { createOpenAI } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { randomUUID } from 'node:crypto';
import { neonConfig, neon } from '@neondatabase/serverless';
import { Composio } from '@composio/core';
import { text, Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';

const dataDirectory = existsSync("/var/data") ? "/var/data" : join(process.cwd(), "data");
const config = {
  exaSearchUrl: "https://api.exa.ai/search",
  composioApiUrl: "https://backend.composio.dev",
  dataDirectory,
  profileFile: join(dataDirectory, "profiles.json"),
  memoryDatabaseUrl: `file:${join(dataDirectory, "mastra.db")}`,
  searchWindowDays: 45,
  maxResults: 8
};
function secret(name) {
  return process.env[name]?.trim() ?? "";
}

const storage = new LibSQLStore({
  id: "okupy-storage",
  url: config.memoryDatabaseUrl
});

let client = null;
function isDatabaseConfigured() {
  return Boolean(secret("DATABASE_URL"));
}
function getDb() {
  if (client) return client;
  const url = secret("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured.");
  neonConfig.fetchConnectionCache = true;
  client = neon(url);
  return client;
}
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL,
  project_stage TEXT NOT NULL DEFAULT 'building',
  goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  interests JSONB NOT NULL DEFAULT '[]'::jsonb,
  location TEXT NOT NULL,
  radius_miles INTEGER NOT NULL DEFAULT 25,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_drafts (
  user_id TEXT PRIMARY KEY,
  step TEXT NOT NULL,
  project TEXT,
  location TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL,
  event_title TEXT,
  event_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fired_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS reminders_user_status_fire_idx
  ON reminders (user_id, status, fire_at);

CREATE TABLE IF NOT EXISTS reminder_history (
  id UUID PRIMARY KEY,
  reminder_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reply_text TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'imessage'
);
CREATE INDEX IF NOT EXISTS reminder_history_user_idx
  ON reminder_history (user_id, delivered_at DESC);
`;
let migrated = false;
async function runMigrations() {
  if (migrated) return;
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }
  const sql = getDb();
  await sql.query(SCHEMA_SQL, []);
  migrated = true;
}

const reminderInputSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  fireAt: z.iso.datetime({ offset: true }),
  message: z.string().trim().min(1).max(1e3),
  eventTitle: z.string().trim().max(240).optional(),
  eventUrl: z.url().optional()
});
class ReminderStore {
  constructor(sql = getDb()) {
    this.sql = sql;
  }
  sql;
  async create(input) {
    const parsed = reminderInputSchema.parse(input);
    const id = randomUUID();
    const rows = await this.sql`
      INSERT INTO reminders (id, user_id, fire_at, message, event_title, event_url, status)
      VALUES (${id}::uuid, ${parsed.userId}, ${parsed.fireAt}::timestamptz, ${parsed.message},
              ${parsed.eventTitle ?? null}, ${parsed.eventUrl ?? null}, 'pending')
      RETURNING id, user_id, fire_at, message, event_title, event_url, status, created_at, fired_at
    `;
    return rowToReminder(rows[0]);
  }
  async listForUser(userId) {
    const rows = await this.sql`
      SELECT id, user_id, fire_at, message, event_title, event_url, status, created_at, fired_at
      FROM reminders
      WHERE user_id = ${userId}
      ORDER BY fire_at ASC
    `;
    return rows.map(rowToReminder);
  }
  async listActiveForUser(userId) {
    const rows = await this.sql`
      SELECT id, user_id, fire_at, message, event_title, event_url, status, created_at, fired_at
      FROM reminders
      WHERE user_id = ${userId} AND status = 'pending'
      ORDER BY fire_at ASC
    `;
    return rows.map(rowToReminder);
  }
  async listDue(now) {
    const rows = await this.sql`
      SELECT id, user_id, fire_at, message, event_title, event_url, status, created_at, fired_at
      FROM reminders
      WHERE status = 'pending' AND fire_at <= ${now.toISOString()}::timestamptz
      ORDER BY fire_at ASC
    `;
    return rows.map(rowToReminder);
  }
  async get(id) {
    const rows = await this.sql`
      SELECT id, user_id, fire_at, message, event_title, event_url, status, created_at, fired_at
      FROM reminders
      WHERE id = ${id}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToReminder(row) : null;
  }
  async cancel(id, userId) {
    const existing = await this.get(id);
    if (!existing || existing.userId !== userId) return null;
    if (existing.status !== "pending") return existing;
    await this.sql`
      UPDATE reminders SET status = 'cancelled' WHERE id = ${id}::uuid AND user_id = ${userId}
    `;
    const updated = await this.get(id);
    return updated;
  }
  async markFired(id, firedAt) {
    await this.sql`
      UPDATE reminders
      SET status = 'fired', fired_at = ${firedAt.toISOString()}::timestamptz
      WHERE id = ${id}::uuid AND status = 'pending'
    `;
    return this.get(id);
  }
  async recordDelivery(reminderId, userId, replyText, channel) {
    const id = randomUUID();
    await this.sql`
      INSERT INTO reminder_history (id, reminder_id, user_id, reply_text, channel)
      VALUES (${id}::uuid, ${reminderId}::uuid, ${userId}, ${replyText}, ${channel})
    `;
  }
  async listHistory(userId, limit = 20) {
    const rows = await this.sql`
      SELECT id, reminder_id, user_id, delivered_at, reply_text, channel
      FROM reminder_history
      WHERE user_id = ${userId}
      ORDER BY delivered_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      reminderId: row.reminder_id,
      userId: row.user_id,
      deliveredAt: new Date(row.delivered_at).toISOString(),
      replyText: row.reply_text,
      channel: row.channel
    }));
  }
}
function rowToReminder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    fireAt: new Date(row.fire_at).toISOString(),
    message: row.message,
    eventTitle: row.event_title ?? void 0,
    eventUrl: row.event_url ?? void 0,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    firedAt: row.fired_at ? new Date(row.fired_at).toISOString() : null
  };
}
const reminderStore = new Proxy({}, {
  get(_target, prop, receiver) {
    const instance = defaultInstance$1();
    return Reflect.get(instance, prop, receiver);
  }
});
function defaultInstance$1() {
  const globalScope = globalThis;
  if (!globalScope.__okupyReminderStore) {
    globalScope.__okupyReminderStore = new ReminderStore(getDb());
  }
  return globalScope.__okupyReminderStore;
}

const eventSchema = z.object({
  title: z.string(),
  url: z.url(),
  summary: z.string(),
  date: z.string().nullable(),
  location: z.string(),
  freeFood: z.boolean(),
  networking: z.boolean(),
  builderCredits: z.boolean(),
  why: z.string()
});
const exaResultSchema = z.object({
  title: z.string().optional(),
  url: z.url(),
  text: z.string().optional(),
  highlights: z.array(z.string()).optional()
});
function classifyEvent(item, location, project) {
  const parsed = exaResultSchema.safeParse(item);
  if (!parsed.success) return null;
  const value = parsed.data;
  const evidence = [value.title, value.text, ...value.highlights ?? []].filter(Boolean).join(" ");
  const normalized = evidence.toLowerCase();
  const freeFood = ["free food", "pizza", "lunch", "dinner", "refreshments", "catering"].some((signal) => normalized.includes(signal));
  const networking = ["network", "founder", "demo day", "meetup", "pitch", "cofounder"].some((signal) => normalized.includes(signal));
  const builderCredits = ["credits", "startup perk", "grant", "compute"].some((signal) => normalized.includes(signal));
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
    why: `Matches ${project}: ${signals.join(", ") || "potential local builder event"}`
  };
}
const findBuilderEvents = createTool({
  id: "find-builder-events",
  description: "Find current local events offering food, networking, startup perks, or builder credits.",
  inputSchema: z.object({
    location: z.string().trim().min(2),
    project: z.string().trim().min(2),
    interests: z.array(z.string()).default([]),
    radiusMiles: z.number().int().min(1).max(250).default(25),
    request: z.string().default("Find me something worthwhile this week")
  }),
  outputSchema: z.object({ results: z.array(eventSchema) }),
  execute: async (input) => {
    const apiKey = secret("EXA_API_KEY");
    if (!apiKey) throw new Error("EXA_API_KEY is required for event discovery.");
    const now = /* @__PURE__ */ new Date();
    const until = new Date(now.getTime() + config.searchWindowDays * 864e5);
    const query = [
      `Upcoming free in-person founder, startup, developer, demo day, hackathon, or community events within ${input.radiusMiles} miles of "${input.location}"`,
      `between ${now.toISOString().slice(0, 10)} and ${until.toISOString().slice(0, 10)}.`,
      "Prioritize explicit free food, pizza, meals, refreshments, networking, cloud credits, grants, or startup perks.",
      `Relevant to: ${input.project}; ${input.interests.join(", ")}. Request: ${input.request}`
    ].join(" ");
    const response = await fetch(config.exaSearchUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: config.maxResults,
        startPublishedDate: `${now.toISOString().slice(0, 10)}T00:00:00.000Z`,
        contents: { text: { maxCharacters: 1800 } }
      }),
      signal: AbortSignal.timeout(3e4)
    });
    if (!response.ok) throw new Error(`Exa search failed (${response.status}).`);
    const body = z.object({ results: z.array(z.unknown()).optional() }).parse(await response.json());
    return {
      results: (body.results ?? []).map((item) => classifyEvent(item, input.location, input.project)).filter((event) => event !== null)
    };
  }
});
const reminderSummarySchema = z.object({
  id: z.string(),
  fireAt: z.string(),
  message: z.string(),
  eventTitle: z.string().nullable(),
  eventUrl: z.url().nullable(),
  status: z.enum(["pending", "fired", "cancelled"])
});
const scheduleReminder = createTool({
  id: "schedule-reminder",
  description: 'Schedule a reminder message for a future time. Use after findBuilderEvents when the user says "remind me", "set a timer", "ping me in 4 hours", or "remind me 12 hours before". Times must be in the future. Returns the persisted reminder so the agent can confirm.',
  inputSchema: z.object({
    userId: z.string().trim().min(1).max(256),
    fireAt: z.iso.datetime({ offset: true }).describe("ISO-8601 datetime when the reminder should fire"),
    message: z.string().trim().min(1).max(1e3).describe("Short iMessage-friendly reminder text"),
    eventTitle: z.string().trim().max(240).optional(),
    eventUrl: z.url().optional()
  }),
  outputSchema: reminderSummarySchema,
  execute: async (input) => {
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
      status: reminder.status
    };
  }
});
const listReminders = createTool({
  id: "list-reminders",
  description: "List reminders for a user, newest pending first. Use when the user asks what is on their schedule or wants to confirm a reminder was set.",
  inputSchema: z.object({
    userId: z.string().trim().min(1).max(256),
    includeFired: z.boolean().default(false)
  }),
  outputSchema: z.object({ reminders: z.array(reminderSummarySchema) }),
  execute: async (input) => {
    const all = input.includeFired ? await reminderStore.listForUser(input.userId) : await reminderStore.listActiveForUser(input.userId);
    return {
      reminders: all.map((reminder) => ({
        id: reminder.id,
        fireAt: reminder.fireAt,
        message: reminder.message,
        eventTitle: reminder.eventTitle ?? null,
        eventUrl: reminder.eventUrl ?? null,
        status: reminder.status
      }))
    };
  }
});
const cancelReminder = createTool({
  id: "cancel-reminder",
  description: 'Cancel a pending reminder. Use when the user says "cancel that reminder", "forget the reminder", or no longer wants to be notified.',
  inputSchema: z.object({
    userId: z.string().trim().min(1).max(256),
    reminderId: z.string().trim().min(1).max(256)
  }),
  outputSchema: z.object({ cancelled: z.boolean(), reminder: reminderSummarySchema.nullable() }),
  execute: async (input) => {
    const reminder = await reminderStore.cancel(input.reminderId, input.userId);
    return {
      cancelled: reminder?.status === "cancelled",
      reminder: reminder ? {
        id: reminder.id,
        fireAt: reminder.fireAt,
        message: reminder.message,
        eventTitle: reminder.eventTitle ?? null,
        eventUrl: reminder.eventUrl ?? null,
        status: reminder.status
      } : null
    };
  }
});

const aiml = createOpenAI({
  baseURL: "https://api.aimlapi.com/v1",
  apiKey: process.env.AIML_API_KEY
});
const builderEventAgent = new Agent({
  id: "builder-event-agent",
  name: "Builder Event Agent",
  instructions: `You help isolated builders leave the build cave for worthwhile nearby events.
You are NOT a passive chatbot \u2014 you are a deterministic agent: every event list ends with the same
prompt asking whether the user wants reminders scheduled, and you act on the answer.

Discovery. Use findBuilderEvents for every discovery request. Prefer events with explicit free food,
useful networking, cofounders, potential customers, feedback, or builder credits. Never invent perks,
dates, or venues. Return at most five results, number them 1\u20135, use the tool's classification and why
fields, include source links, and tell the user to verify the event details and RSVP page. Be concise
for iMessage.

Deterministic follow-up. After returning events, ALWAYS end with one short sentence asking whether
to set reminders. Example wording: "Want me to remind you about any of these? Reply with the number
and timing, e.g. '3 in 4 hours' or 'all of them 12 hours before'." Never skip this line on a fresh
discovery turn.

Reminders. Use scheduleReminder when the user asks for a reminder, timer, ping, or "remind me to
apply". Resolve natural-language offsets to a concrete ISO datetime in the user's timezone:
- "in 4 hours" / "in 12 hours" \u2192 now + N hours
- "tomorrow at 9am" \u2192 tomorrow 09:00 local
- "12 hours before" an event \u2192 event datetime \u2212 12h
- "the night before" \u2192 event datetime \u2212 18h

When the user says something like "go through the scans and pick the ones to schedule invites for",
interpret it as: enumerate every returned event that matches the requested filter (free food, credits,
cofounder events, etc.) and call scheduleReminder for each one with the event title, URL, and a short
"apply / RSVP" message. Then summarise what you scheduled.

Confirm after scheduling. Reply in one short sentence naming the event, the fire time, and the
channel (iMessage). If multiple reminders were created, list them compactly.

Inspect and cancel. Use listReminders to recap what is queued and cancelReminder (with the
reminder id) to drop a reminder. Never invent event URLs you did not return from findBuilderEvents.`,
  model: aiml("gpt-4o-mini"),
  tools: { findBuilderEvents, scheduleReminder, listReminders, cancelReminder },
  memory: new Memory({ storage, options: { lastMessages: 20 } })
});

async function startGmailConnection(userId, callbackUrl) {
  const apiKey = secret("COMPOSIO_API_KEY");
  if (!apiKey) {
    return {
      app: "gmail",
      redirectUrl: "",
      status: "not_configured",
      note: "COMPOSIO_API_KEY is not set. Add it to connect Gmail."
    };
  }
  try {
    const composio = new Composio({ apiKey, baseURL: config.composioApiUrl });
    const session = await composio.sessions.create(userId, {
      toolkits: ["gmail"],
      manageConnections: { callbackUrl }
    });
    const request = await session.authorize("gmail", { callbackUrl });
    return {
      app: "gmail",
      redirectUrl: request.redirectUrl ?? "",
      status: "pending",
      note: "Open the Connect Link to authenticate Gmail."
    };
  } catch (error) {
    return {
      app: "gmail",
      redirectUrl: "",
      status: "unavailable",
      note: `Composio could not start the Gmail connection: ${error instanceof Error ? error.message : "unknown error"}`
    };
  }
}

const dashboardHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Okupy \u2014 leave the build cave</title>
<style>
:root{--ink:#151515;--paper:#f4f0e6;--acid:#d9ff43;--purple:#7057ff}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.shell{max-width:1080px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid;padding-bottom:18px}.brand{font:bold 25px system-ui}.pill{background:var(--acid);border:1px solid;border-radius:99px;padding:7px 12px;font-size:12px}.hero{display:grid;grid-template-columns:1.4fr .6fr;gap:30px;padding:70px 0 55px}.hero h1{font:800 clamp(44px,8vw,88px)/.92 system-ui;margin:0;letter-spacing:-.06em}.hero h1 span{color:var(--purple)}.hero p{font:18px/1.5 system-ui;margin-top:24px;max-width:640px}.stat{border:2px solid;padding:22px;align-self:end;background:white;box-shadow:7px 7px 0 var(--ink)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{border:1.5px solid;padding:25px;background:#faf8f2}.card h2{font:700 22px system-ui;margin-top:0}label{display:block;font-size:12px;text-transform:uppercase;margin:14px 0 6px}input,textarea{width:100%;border:1.5px solid;padding:12px;background:white;font:inherit}textarea{min-height:75px}button{border:1.5px solid;background:var(--ink);color:white;padding:13px 18px;margin-top:16px;font:bold 14px inherit;cursor:pointer}button.alt{background:var(--purple)}#status{white-space:pre-wrap;margin-top:14px;font-size:13px}.reminder{border:1.5px solid;padding:14px;margin-top:12px;background:white;display:flex;justify-content:space-between;align-items:center;gap:14px}.reminder b{display:block;font:14px system-ui}.reminder time{font-size:12px;color:var(--purple)}.reminder button{margin:0;padding:8px 12px;font-size:12px;background:var(--paper);color:var(--ink)}.steps{display:flex;gap:12px;margin:55px 0 25px}.steps div{flex:1;border-top:2px solid;padding-top:12px}.steps b{display:block;color:var(--purple)}@media(max-width:720px){.hero,.grid{grid-template-columns:1fr}.hero{padding:45px 0}.steps{display:block}.steps div{margin:20px 0}}
</style></head><body><main class="shell"><header class="top"><div class="brand">OKUPY /</div><div class="pill">\u25CF iMessage-first agent</div></header>
<section class="hero"><div><h1>Free food.<br><span>Real people.</span><br>Keep building.</h1><p>Tell Okupy what you're making once. Your agent remembers, searches Exa for nearby events, and texts you the rooms with food, cofounders, customers, feedback, and credits. Ask it to remind you and it will ping you back on iMessage.</p></div><aside class="stat"><b>NOT ANOTHER EVENT LIST</b><p>Every result explains why leaving your room is worth it \u2014 and Okupy can text you a nudge before it starts.</p></aside></section>
<div class="grid"><section class="card"><h2>01 / Agent memory</h2><form id="profile">
<label for="uid">Your private ID or phone</label><input id="uid" required maxlength="256" autocomplete="username" placeholder="+1 415\u2026">
<label for="project">What are you building?</label><textarea id="project" required maxlength="2000" placeholder="An API that\u2026"></textarea>
<label for="location">City</label><input id="location" required maxlength="240" placeholder="San Francisco, CA">
<label for="goals">Who or what do you need?</label><input id="goals" maxlength="1000" placeholder="cofounder, first customers, product feedback">
<button type="submit">Remember me</button></form></section>
<section class="card"><h2>02 / Connections</h2><p>Composio handles authorization. Okupy never asks for your Gmail password.</p><button class="alt" id="gmail" type="button">Connect Gmail \u2197</button>
<h2 style="margin-top:35px">03 / Find a room</h2><label for="ask">What should I find?</label><input id="ask" placeholder="Find something this Thursday"><button id="discover" type="button">Search with Exa</button><div id="status" aria-live="polite"></div></section></div>
<section class="card"><h2>04 / Scheduled reminders</h2><p>Set a reminder in chat ("remind me in 4 hours" or "ping me 12h before") and Okupy will text you when it fires.</p><div id="reminders" aria-live="polite"></div></section>
<div class="steps"><div><b>MEMORY</b>Your build context follows you.</div><div><b>SEARCH</b>Live, sourced Exa results.</div><div><b>REMIND</b>Timed iMessage nudges.</div><div><b>CONNECT</b>Composio powers your apps.</div></div></main>
<script>
const $=id=>document.getElementById(id), status=$('status');
async function request(path, options){const response=await fetch(path,options);const text=await response.text();let body;try{body=JSON.parse(text)}catch{throw new Error(text||'The server returned an unreadable response.')}if(!response.ok)throw new Error(body.error||'Request failed.');return body}
function values(){return {userId:$('uid').value.trim(),project:$('project').value.trim(),location:$('location').value.trim(),goals:$('goals').value.split(',').map(value=>value.trim()).filter(Boolean),interests:[]}}
async function loadReminders(){const userId=$('uid').value.trim();const target=$('reminders');if(!userId){target.innerHTML='<p style="font-size:13px;margin-top:10px">Save your profile above to view scheduled reminders.</p>';return}try{const body=await request('/v1/reminders/'+encodeURIComponent(userId));if(!body.reminders||body.reminders.length===0){target.innerHTML='<p style="font-size:13px;margin-top:10px">No reminders yet. Ask the agent to set one.</p>';return}target.innerHTML=body.reminders.map(reminder=>{const at=new Date(reminder.fireAt).toLocaleString();const event=reminder.eventTitle?reminder.eventTitle:'';return '<div class="reminder" data-id="'+reminder.id+'"><div><time>'+at+'</time><b>'+reminder.message+'</b>'+(event?'<div style="font-size:12px">'+event+'</div>':'')+'</div><button data-cancel="'+reminder.id+'">Cancel</button></div>'}).join('');for(const button of target.querySelectorAll('button[data-cancel]')){button.onclick=async()=>{try{await request('/v1/reminders/'+button.dataset.cancel+'?userId='+encodeURIComponent(userId),{method:'DELETE'});await loadReminders()}catch(error){status.textContent='Cancel failed. '+error.message}}}}
}catch(error){target.innerHTML='<p style="font-size:13px;margin-top:10px">Reminders unavailable: '+error.message+'</p>'}}
$('profile').onsubmit=async event=>{event.preventDefault();status.textContent='Saving\u2026';try{const profile=values();await request('/v1/profile/'+encodeURIComponent(profile.userId),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(profile)});status.textContent='\u2713 Memory saved. Text the agent whenever you want.';await loadReminders()}catch(error){status.textContent='Could not save: '+error.message}};
$('discover').onclick=async()=>{status.textContent='Searching the city\u2026';try{const body=await request('/v1/discover',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:$('uid').value.trim(),message:$('ask').value.trim()||'Find me an event'})});status.textContent=body.reply;await loadReminders()}catch(error){status.textContent='Search failed. '+error.message+' Please try again.'}};
$('gmail').onclick=async()=>{status.textContent='Starting Gmail connection\u2026';try{const body=await request('/v1/connections',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:$('uid').value.trim()||'dashboard-user',app:'gmail'})});if(body.redirectUrl)location.assign(body.redirectUrl);else status.textContent=body.note}catch(error){status.textContent='Connection failed. '+error.message}};
$('uid').addEventListener('change',loadReminders);
loadReminders();
</script></body></html>`;

const builderProfileInputSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  name: z.string().trim().max(120).default(""),
  project: z.string().trim().min(2).max(2e3),
  projectStage: z.string().trim().min(1).max(120).default("building"),
  goals: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  interests: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  location: z.string().trim().min(2).max(240),
  radiusMiles: z.number().int().min(1).max(250).default(25)
});
class ProfileStore {
  constructor(sql = getDb()) {
    this.sql = sql;
  }
  sql;
  async readProfile(userId) {
    const rows = await this.sql`
      SELECT user_id, name, project, project_stage, goals, interests, location, radius_miles, updated_at
      FROM profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToProfile(row) : null;
  }
  async readDraft(userId) {
    const rows = await this.sql`
      SELECT step, project, location FROM onboarding_drafts WHERE user_id = ${userId} LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      step: row.step,
      project: row.project ?? void 0,
      location: row.location ?? void 0
    };
  }
  async getProfile(userId) {
    return this.readProfile(userId);
  }
  async saveProfile(input) {
    const parsed = builderProfileInputSchema.parse(input);
    const goalsJson = JSON.stringify(parsed.goals);
    const interestsJson = JSON.stringify(parsed.interests);
    await this.sql`
      INSERT INTO profiles (user_id, name, project, project_stage, goals, interests, location, radius_miles, updated_at)
      VALUES (${parsed.userId}, ${parsed.name}, ${parsed.project}, ${parsed.projectStage},
              ${goalsJson}::jsonb, ${interestsJson}::jsonb, ${parsed.location}, ${parsed.radiusMiles}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        name = EXCLUDED.name,
        project = EXCLUDED.project,
        project_stage = EXCLUDED.project_stage,
        goals = EXCLUDED.goals,
        interests = EXCLUDED.interests,
        location = EXCLUDED.location,
        radius_miles = EXCLUDED.radius_miles,
        updated_at = now()
    `;
    await this.sql`DELETE FROM onboarding_drafts WHERE user_id = ${parsed.userId}`;
    const profile = await this.readProfile(parsed.userId);
    if (!profile) throw new Error("Profile write did not persist.");
    return profile;
  }
  async hasOnboarding(userId) {
    const draft = await this.readDraft(userId);
    return draft !== null;
  }
  async beginOnboarding(userId) {
    await this.sql`
      INSERT INTO onboarding_drafts (user_id, step) VALUES (${userId}, 'project')
      ON CONFLICT (user_id) DO NOTHING
    `;
    return "First, what are you building?";
  }
  async advanceOnboarding(userId, message) {
    const value = message.trim();
    if (value.length < 2) {
      return { complete: false, reply: "Please add a little more detail so I can remember it." };
    }
    const draft = await this.readDraft(userId) ?? { step: "project" };
    if (draft.step === "project") {
      await this.upsertDraft(userId, { step: "location", project: value.slice(0, 2e3), location: draft.location });
      return { complete: false, reply: "Got it. What city or area should I search near?" };
    }
    if (draft.step === "location") {
      await this.upsertDraft(userId, { step: "goals", project: draft.project, location: value.slice(0, 240) });
      return { complete: false, reply: "Last one: who or what do you need\u2014cofounders, customers, feedback, credits, or something else?" };
    }
    const goals = value.split(/,|\band\b/i).map((goal) => goal.trim()).filter(Boolean).slice(0, 20);
    if (!draft.project || !draft.location) {
      return { complete: false, reply: "Something went off track. Tell me again what you're building." };
    }
    const profile = await this.saveProfile({
      userId,
      project: draft.project,
      location: draft.location,
      goals,
      interests: []
    });
    return { complete: true, profile, reply: "You're set. What kind of event should I find for you?" };
  }
  async upsertDraft(userId, draft) {
    await this.sql`
      INSERT INTO onboarding_drafts (user_id, step, project, location, updated_at)
      VALUES (${userId}, ${draft.step}, ${draft.project ?? null}, ${draft.location ?? null}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        step = EXCLUDED.step,
        project = EXCLUDED.project,
        location = EXCLUDED.location,
        updated_at = now()
    `;
  }
}
function rowToProfile(row) {
  return {
    userId: row.user_id,
    name: row.name ?? "",
    project: row.project,
    projectStage: row.project_stage ?? "building",
    goals: parseJsonArray(row.goals),
    interests: parseJsonArray(row.interests),
    location: row.location,
    radiusMiles: row.radius_miles ?? 25,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
const profileStore = new Proxy({}, {
  get(_target, prop, receiver) {
    const instance = defaultInstance();
    return Reflect.get(instance, prop, receiver);
  }
});
function defaultInstance() {
  const globalScope = globalThis;
  if (!globalScope.__okupyProfileStore) {
    globalScope.__okupyProfileStore = new ProfileStore(getDb());
  }
  return globalScope.__okupyProfileStore;
}
const getProfile = (userId) => defaultInstance().getProfile(userId);
const saveProfile = (profile) => defaultInstance().saveProfile(profile);

async function respond(userId, message) {
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
      needsOnboarding: true
    };
  }
  if (!secret("EXA_API_KEY")) {
    return {
      userId: normalizedUserId,
      reply: "I remember what you're building. Add EXA_API_KEY so I can search live events for you.",
      needsOnboarding: false
    };
  }
  if (!secret("AIML_API_KEY")) {
    return {
      userId: normalizedUserId,
      reply: "I remember what you're building. Add AIML_API_KEY so I can coordinate live event discovery.",
      needsOnboarding: false
    };
  }
  const prompt = `Builder profile: ${JSON.stringify(profile)}
Current request: ${message.trim() || "Find me something worthwhile this week"}`;
  const result = await builderEventAgent.generate(prompt, {
    memory: { thread: normalizedUserId, resource: normalizedUserId }
  });
  return { userId: normalizedUserId, reply: result.text, needsOnboarding: false };
}

const spectrumState = { instance: null, ready: false };
function setSpectrum(spectrum) {
  spectrumState.instance = spectrum;
  spectrumState.ready = true;
}
async function spectrumSend(userId, body) {
  const spectrum = spectrumState.instance;
  if (!spectrum || !spectrumState.ready) return false;
  try {
    const space = { id: userId, type: "dm" };
    await spectrum.send(space, text(body));
    return true;
  } catch (error) {
    console.error(`[spectrum] send failed for ${userId}`, error);
    return false;
  }
}

let status = "disabled";
function photonStatus() {
  return status;
}
async function startPhoton() {
  const projectId = secret("SPECTRUM_PROJECT_ID") || secret("PHOTON_PROJECT_ID");
  const projectSecret = secret("SPECTRUM_PROJECT_SECRET") || secret("PHOTON_PROJECT_SECRET");
  if (!projectId || !projectSecret) {
    status = "disabled";
    return;
  }
  status = "starting";
  try {
    const spectrum = await Spectrum({
      projectId,
      projectSecret,
      providers: [imessage.config()]
    });
    setSpectrum(spectrum);
    status = "ready";
    void (async () => {
      for await (const [space, message] of spectrum.messages) {
        try {
          const userId = message.sender.id || space.id;
          const text = message.content.type === "text" ? message.content.text : "";
          const result = await respond(userId, text);
          await space.responding(() => message.reply(result.reply));
        } catch (error) {
          console.error("Spectrum message handling failed", error);
        }
      }
    })().catch((error) => {
      status = "error";
      console.error("Spectrum listener failed", error);
    });
  } catch (error) {
    status = "error";
    throw error;
  }
}

const SCHEDULER_INTERVAL_MS = 3e4;
let timer = null;
async function deliver(reminder) {
  const prompt = `Reminder fired: ${reminder.message}` + (reminder.eventTitle ? ` (event: ${reminder.eventTitle})` : "") + (reminder.eventUrl ? ` ${reminder.eventUrl}` : "");
  let reply = prompt;
  let channel = "log";
  try {
    const result = await respond(reminder.userId, prompt);
    reply = result.reply;
    if (photonStatus() === "ready") {
      const sent = await spectrumSend(reminder.userId, reply);
      channel = sent ? "imessage" : "log";
    } else {
      console.log(`[scheduler] reminder fired for ${reminder.userId}: ${reply}`);
    }
  } catch (error) {
    console.error(`[scheduler] reminder delivery failed for ${reminder.id}`, error);
  } finally {
    try {
      await reminderStore.markFired(reminder.id, /* @__PURE__ */ new Date());
      await reminderStore.recordDelivery(reminder.id, reminder.userId, reply, channel);
    } catch (error) {
      console.error(`[scheduler] reminder persistence failed for ${reminder.id}`, error);
    }
  }
}
async function tick() {
  const due = await reminderStore.listDue(/* @__PURE__ */ new Date());
  if (due.length === 0) return;
  await Promise.all(due.map(deliver));
}
function startScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((error) => console.error("[scheduler] tick failed", error));
  }, SCHEDULER_INTERVAL_MS);
  void tick().catch((error) => console.error("[scheduler] initial tick failed", error));
}

const discoverSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  message: z.string().trim().max(2e3).default("Find me something worthwhile this week")
});
const connectionSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  app: z.literal("gmail").default("gmail")
});
async function requestBody(request) {
  try {
    return await request.json();
  } catch {
    return void 0;
  }
}
function validationError(result) {
  return result.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
}
const apiHandler = (handler) => handler;
await mkdir(config.dataDirectory, {
  recursive: true
});
if (isDatabaseConfigured()) {
  await runMigrations();
} else {
  console.error("DATABASE_URL is not set \u2014 profiles and reminders will not persist across restarts.");
}
const mastra = new Mastra({
  agents: {
    builderEventAgent
  },
  storage,
  server: {
    host: "0.0.0.0",
    apiRoutes: [registerApiRoute("/", {
      method: "GET",
      handler: apiHandler(async (c) => c.html(dashboardHtml))
    }), registerApiRoute("/health", {
      method: "GET",
      handler: apiHandler(async (c) => {
        const photon = photonStatus();
        let database = "unconfigured";
        if (isDatabaseConfigured()) {
          try {
            await runMigrations();
            database = "ready";
          } catch {
            database = "error";
          }
        }
        return c.json({
          ok: photon !== "error" && database !== "error",
          framework: "mastra",
          search: "exa",
          memory: "libsql",
          database,
          channel: "photon-imessage",
          photon
        }, photon === "error" || database === "error" ? 503 : 200);
      })
    }), registerApiRoute("/v1/profile/:userId", {
      method: "GET",
      handler: apiHandler(async (c) => c.json(await getProfile(c.req.param("userId")) ?? {}))
    }), registerApiRoute("/v1/profile/:userId", {
      method: "PUT",
      handler: apiHandler(async (c) => {
        const result = builderProfileInputSchema.safeParse(await requestBody(c.req.raw));
        if (!result.success) return c.json({
          error: validationError(result)
        }, 400);
        if (result.data.userId !== c.req.param("userId")) {
          return c.json({
            error: "Path and profile user IDs must match."
          }, 400);
        }
        return c.json(await saveProfile(result.data));
      })
    }), registerApiRoute("/v1/discover", {
      method: "POST",
      handler: apiHandler(async (c) => {
        const result = discoverSchema.safeParse(await requestBody(c.req.raw));
        if (!result.success) return c.json({
          error: validationError(result)
        }, 400);
        try {
          return c.json(await respond(result.data.userId, result.data.message));
        } catch (error) {
          console.error("Event discovery failed", error);
          return c.json({
            error: "Event discovery is temporarily unavailable. Please try again."
          }, 502);
        }
      })
    }), registerApiRoute("/v1/connections", {
      method: "POST",
      handler: apiHandler(async (c) => {
        const result = connectionSchema.safeParse(await requestBody(c.req.raw));
        if (!result.success) return c.json({
          error: validationError(result)
        }, 400);
        const callbackUrl = new URL("/v1/connections/callback", c.req.url).toString();
        return c.json(await startGmailConnection(result.data.userId, callbackUrl));
      })
    }), registerApiRoute("/v1/connections/callback", {
      method: "GET",
      handler: apiHandler(async (c) => {
        const failure = c.req.query("error");
        if (failure) return c.html("<h1>Connection not completed</h1><p>Return to Okupy and try again.</p>", 400);
        return c.html("<h1>Connected</h1><p>You can close this tab and return to Okupy.</p>");
      })
    }), registerApiRoute("/v1/reminders/:userId", {
      method: "GET",
      handler: apiHandler(async (c) => {
        const includeFired = c.req.query("includeFired") === "true";
        const reminders = includeFired ? await reminderStore.listForUser(c.req.param("userId")) : await reminderStore.listActiveForUser(c.req.param("userId"));
        return c.json({
          reminders
        });
      })
    }), registerApiRoute("/v1/reminders/:id", {
      method: "DELETE",
      handler: apiHandler(async (c) => {
        const userId = c.req.query("userId")?.trim();
        if (!userId) return c.json({
          error: "userId query parameter is required."
        }, 400);
        const reminder = await reminderStore.cancel(c.req.param("id"), userId);
        if (!reminder) return c.json({
          error: "Reminder not found."
        }, 404);
        return c.json({
          reminder
        });
      })
    }), registerApiRoute("/v1/reminders/:userId/history", {
      method: "GET",
      handler: apiHandler(async (c) => {
        const limitRaw = c.req.query("limit");
        const limit = Math.max(1, Math.min(100, Number(limitRaw) || 20));
        return c.json({
          history: await reminderStore.listHistory(c.req.param("userId"), limit)
        });
      })
    })]
  }
});
void startPhoton().catch((error) => console.error("Photon startup failed", error));
startScheduler();

export { mastra as m };
