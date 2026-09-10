import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./mastra/config.js";
import { getDb, isDatabaseConfigured, runMigrations } from "./mastra/db.js";
import { dashboardHtml } from "./mastra/dashboard.js";
import { startPhoton, photonStatus } from "./mastra/photon.js";
import { spectrumState } from "./mastra/spectrum-state.js";
import { startScheduler } from "./mastra/scheduler.js";
import { startWatchScheduler } from "./mastra/watch-scheduler.js";
import { respond } from "./mastra/respond.js";
import { reminderStore } from "./mastra/reminders.js";
import { watchStore } from "./mastra/watch-store.js";
import { startGmailConnection } from "./mastra/composio.js";
import { runWatchAgent } from "./mastra/watch-agent.js";
import { executeAddWatchItem, executeCheckWatchPrices } from "./mastra/watch-tools.js";
import { getProfile, saveProfile, builderProfileInputSchema } from "./mastra/profiles.js";
import { z } from "zod";

const discoverSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  message: z.string().trim().max(2_000).default("Find me something worthwhile this week"),
});

const connectionSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  app: z.literal("gmail").default("gmail"),
});

const watchAddSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  url: z.string().trim().url(),
  targetPrice: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d+)?$/)
    .nullable()
    .optional(),
  fetchNow: z.boolean().default(true),
});

const watchActionSchema = z.object({
  userId: z.string().trim().min(1).max(256),
});

const watchUpdateTargetSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  targetPrice: z.string().trim().regex(/^\d+(?:\.\d+)?$/).nullable(),
});

const MAX_JSON_BODY_BYTES = 1_000_000;

if (isDatabaseConfigured()) {
  await runMigrations();
} else {
  console.error("DATABASE_URL is not set — profiles and reminders will not persist across restarts.");
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let data = "";
    request.on("data", chunk => {
      const text = String(chunk);
      bytes += Buffer.byteLength(text);
      if (bytes > MAX_JSON_BODY_BYTES) {
        reject(new Error("Request body too large."));
        request.destroy();
        return;
      }
      data += text;
    });
    request.on("end", () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function validationError(result: z.ZodSafeParseError<unknown>): string {
  return result.error.issues.map(issue => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
}

function matchRoute(method: string, url: string, pattern: string): Record<string, string> | null {
  if (!url.startsWith(pattern)) return null;
  const rest = url.slice(pattern.length);
  if (rest === "" || rest === "/") {
    return {};
  }
  return { "*": rest.replace(/^\//, "") };
}

type Handler = (request: IncomingMessage, response: ServerResponse, params: Record<string, string>, query: URLSearchParams) => Promise<void> | void;

function route(method: string, path: string, handler: Handler) {
  return { method, path, handler };
}

const routes = [
  route("GET", "/", async (_req, res) => sendHtml(res, 200, dashboardHtml)),
  route("GET", "/health", async (_req, res) => {
    const photon = photonStatus();
    let database: "ready" | "error" | "unconfigured" = "unconfigured";
    if (isDatabaseConfigured()) {
      try {
        await getDb().query("SELECT 1", []);
        database = "ready";
      } catch {
        database = "error";
      }
    }
    sendJson(res, photon === "error" || database === "error" ? 503 : 200, {
      ok: photon !== "error" && database !== "error",
      framework: "ai-sdk",
      search: "exa",
      memory: "neon",
      database,
      channel: "photon-imessage",
      agents: ["event", "watch"],
      photon,
      spectrum: spectrumState.ready,
    });
  }),
  route("GET", "/v1/profile/:userId", async (_req, res, params) => {
    const profile = await getProfile(params.userId);
    if (!profile) {
      sendJson(res, 404, { error: "Profile not found." });
      return;
    }
    sendJson(res, 200, profile);
  }),
  route("PUT", "/v1/profile/:userId", async (req, res, params) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
      return;
    }
    const result = builderProfileInputSchema.safeParse(body);
    if (!result.success) {
      sendJson(res, 400, { error: validationError(result) });
      return;
    }
    if (result.data.userId !== params.userId) {
      sendJson(res, 400, { error: "Path and profile user IDs must match." });
      return;
    }
    sendJson(res, 200, await saveProfile(result.data));
  }),
  route("POST", "/v1/discover", async (req, res) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
      return;
    }
    const result = discoverSchema.safeParse(body);
    if (!result.success) {
      sendJson(res, 400, { error: validationError(result) });
      return;
    }
    try {
      sendJson(res, 200, await respond(result.data.userId, result.data.message));
    } catch (error) {
      console.error("Discover failed", error);
      sendJson(res, 502, { error: "Event discovery is temporarily unavailable. Please try again." });
    }
  }),
  route("POST", "/v1/connections", async (req, res) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
      return;
    }
    const result = connectionSchema.safeParse(body);
    if (!result.success) {
      sendJson(res, 400, { error: validationError(result) });
      return;
    }
    if (!config.publicBaseUrl) {
      sendJson(res, 200, await startGmailConnection(result.data.userId, ""));
      return;
    }
    const callbackUrl = `${config.publicBaseUrl}/v1/connections/callback`;
    sendJson(res, 200, await startGmailConnection(result.data.userId, callbackUrl));
  }),
  route("GET", "/v1/connections/callback", async (_req, res, _params, query) => {
    if (query.has("error")) {
      sendHtml(res, 400, "<h1>Connection not completed</h1><p>Return to Okupy and try again.</p>");
      return;
    }
    sendHtml(res, 200, "<h1>Connected</h1><p>You can close this tab and return to Okupy.</p>");
  }),
  route("GET", "/v1/reminders/:userId", async (_req, res, params, query) => {
    const includeFired = query.get("includeFired") === "true";
    const reminders = includeFired
      ? await reminderStore.listForUser(params.userId)
      : await reminderStore.listActiveForUser(params.userId);
    sendJson(res, 200, { reminders });
  }),
  route("DELETE", "/v1/reminders/:id", async (_req, res, params, query) => {
    const userId = query.get("userId")?.trim();
    if (!userId) {
      sendJson(res, 400, { error: "userId query parameter is required." });
      return;
    }
    const reminder = await reminderStore.cancel(params.id, userId);
    if (!reminder) {
      sendJson(res, 404, { error: "Reminder not found." });
      return;
    }
    sendJson(res, 200, { reminder });
  }),
  route("GET", "/v1/reminders/:userId/history", async (_req, res, params, query) => {
    const limitRaw = query.get("limit");
    const limit = Math.max(1, Math.min(100, Number(limitRaw) || 20));
    sendJson(res, 200, { history: await reminderStore.listHistory(params.userId, limit) });
  }),
  route("POST", "/v1/watch/:userId", async (req, res, params) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
      return;
    }
    const result = watchAddSchema.safeParse(body);
    if (!result.success) {
      sendJson(res, 400, { error: validationError(result) });
      return;
    }
    if (result.data.userId !== params.userId) {
      sendJson(res, 400, { error: "Path and body user IDs must match." });
      return;
    }
    try {
      const added = await executeAddWatchItem(result.data);
      let reply = added.message;
      try {
        const agent = await runWatchAgent(
          result.data.userId,
          `Just added ${added.item.title} at ${added.baselinePrice ?? "unknown price"} ${added.item.lastCurrency}. Confirm with the user.`,
        );
        reply = agent.reply;
      } catch (error) {
        console.warn("Watch confirmation unavailable, returning deterministic receipt", error);
      }
      const cart = await watchStore.listForUser(result.data.userId);
      sendJson(res, 200, { reply, cart, baselinePrice: added.baselinePrice });
    } catch (error) {
      console.error("Watch add failed", error);
      sendJson(res, 502, {
        error: error instanceof Error ? error.message : "Couldn't add that item. Check the URL and try again.",
      });
    }
  }),
  route("GET", "/v1/cart/:userId", async (_req, res, params, query) => {
    const includeRemoved = query.get("includeRemoved") === "true";
    const items = await watchStore.listForUser(params.userId, includeRemoved);
    const alertsRaw = query.get("alerts");
    const alertsLimit = Math.max(1, Math.min(100, Number(alertsRaw) || 0));
    const alerts = alertsLimit > 0 ? await watchStore.listAlerts(params.userId, alertsLimit) : [];
    sendJson(res, 200, { items, alerts });
  }),
  route("DELETE", "/v1/watch/:id", async (_req, res, params, query) => {
    const userId = query.get("userId")?.trim();
    if (!userId) {
      sendJson(res, 400, { error: "userId query parameter is required." });
      return;
    }
    const item = await watchStore.remove(params.id, userId);
    if (!item) {
      sendJson(res, 404, { error: "Watched item not found." });
      return;
    }
    sendJson(res, 200, { item });
  }),
  route("POST", "/v1/watch/:id/pause", async (req, res, params) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
      return;
    }
    const result = watchActionSchema.safeParse(body);
    if (!result.success) {
      sendJson(res, 400, { error: validationError(result) });
      return;
    }
    const item = await watchStore.pause(params.id, result.data.userId);
    if (!item) {
      sendJson(res, 404, { error: "Watched item not found." });
      return;
    }
    sendJson(res, 200, { item });
  }),
  route("POST", "/v1/watch/:id/resume", async (req, res, params) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
      return;
    }
    const result = watchActionSchema.safeParse(body);
    if (!result.success) {
      sendJson(res, 400, { error: validationError(result) });
      return;
    }
    const item = await watchStore.resume(params.id, result.data.userId);
    if (!item) {
      sendJson(res, 404, { error: "Watched item not found." });
      return;
    }
    sendJson(res, 200, { item });
  }),
  route("PUT", "/v1/watch/:id/target", async (req, res, params) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
      return;
    }
    const result = watchUpdateTargetSchema.safeParse(body);
    if (!result.success) {
      sendJson(res, 400, { error: validationError(result) });
      return;
    }
    const item = await watchStore.updateTarget(params.id, result.data.userId, result.data.targetPrice);
    if (!item) {
      sendJson(res, 404, { error: "Watched item not found." });
      return;
    }
    sendJson(res, 200, { item });
  }),
  route("POST", "/v1/watch/:userId/check", async (req, res, params) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
      return;
    }
    const result = watchActionSchema.safeParse(body);
    if (!result.success) {
      sendJson(res, 400, { error: validationError(result) });
      return;
    }
    if (result.data.userId !== params.userId) {
      sendJson(res, 400, { error: "Path and body user IDs must match." });
      return;
    }
    const checked = await executeCheckWatchPrices({ userId: result.data.userId });
    sendJson(res, 200, { ok: true, ...checked });
  }),
  route("POST", "/v1/watch/agent/:userId", async (req, res, params) => {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
      return;
    }
    const schema = z.object({
      message: z.string().trim().max(2_000).default("Show me my watch cart"),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: validationError(parsed) });
      return;
    }
    try {
      const result = await runWatchAgent(params.userId, parsed.data.message);
      sendJson(res, 200, result);
    } catch (error) {
      console.error("Watch agent failed", error);
      sendJson(res, 502, { error: "Watch agent is temporarily unavailable." });
    }
  }),
];

function findHandler(method: string, url: string): { handler: Handler; params: Record<string, string>; query: URLSearchParams } | null {
  const parsed = new URL(url, "http://localhost");
  const path = parsed.pathname;
  const query = parsed.searchParams;
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const segments = candidate.path.split("/").filter(Boolean);
    const pathSegments = path.split("/").filter(Boolean);
    if (segments.length !== pathSegments.length) continue;
    const params: Record<string, string> = {};
    let match = true;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      const part = pathSegments[i];
      if (seg.startsWith(":")) {
        params[seg.slice(1)] = decodeURIComponent(part);
      } else if (seg !== part) {
        match = false;
        break;
      }
    }
    if (match) return { handler: candidate.handler, params, query };
  }
  return null;
}

const port = Number(process.env.PORT) || 4111;
const host = process.env.HOST || "0.0.0.0";

const server = createServer(async (req, res) => {
  try {
    const found = findHandler(req.method ?? "GET", req.url ?? "/");
    if (!found) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }
    await found.handler(req, res, found.params, found.query);
  } catch (error: unknown) {
    console.error("Unhandled error", error);
    sendJson(res, 500, { error: "Internal server error." });
  }
});

server.listen(port, host, () => {
  console.log(`okupy listening on http://${host}:${port}`);
});

void startPhoton().catch(error => console.error("Photon startup failed", error));
startScheduler();
startWatchScheduler();

export { server };
