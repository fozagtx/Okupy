import { mkdir } from "node:fs/promises";
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import type { ApiRouteHandler } from "@mastra/core/server";
import { z } from "zod";
import { builderEventAgent } from "./agent.js";
import { startGmailConnection } from "./composio.js";
import { config } from "./config.js";
import { isDatabaseConfigured, runMigrations } from "./db.js";
import { dashboardHtml } from "./dashboard.js";
import { photonStatus, startPhoton } from "./photon.js";
import { builderProfileInputSchema, getProfile, saveProfile } from "./profiles.js";
import { reminderStore } from "./reminders.js";
import { respond } from "./respond.js";
import { startScheduler } from "./scheduler.js";
import { storage } from "./storage.js";

const discoverSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  message: z.string().trim().max(2_000).default("Find me something worthwhile this week"),
});
const connectionSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  app: z.literal("gmail").default("gmail"),
});

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function validationError(result: z.ZodSafeParseError<unknown>): string {
  return result.error.issues.map(issue => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
}

const apiHandler = (handler: ApiRouteHandler) => handler;

await mkdir(config.dataDirectory, { recursive: true });

if (isDatabaseConfigured()) {
  await runMigrations();
} else {
  console.error("DATABASE_URL is not set — profiles and reminders will not persist across restarts.");
}

export const mastra = new Mastra({
  agents: { builderEventAgent },
  storage,
  server: {
    host: "0.0.0.0",
    apiRoutes: [
      registerApiRoute("/", { method: "GET", handler: apiHandler(async c => c.html(dashboardHtml)) }),
      registerApiRoute("/health", {
        method: "GET",
        handler: apiHandler(async c => {
          const photon = photonStatus();
          let database: "ready" | "error" | "unconfigured" = "unconfigured";
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
            photon,
          }, photon === "error" || database === "error" ? 503 : 200);
        }),
      }),
      registerApiRoute("/v1/profile/:userId", {
        method: "GET",
        handler: apiHandler(async c => c.json((await getProfile(c.req.param("userId"))) ?? {})),
      }),
      registerApiRoute("/v1/profile/:userId", {
        method: "PUT",
        handler: apiHandler(async c => {
          const result = builderProfileInputSchema.safeParse(await requestBody(c.req.raw));
          if (!result.success) return c.json({ error: validationError(result) }, 400);
          if (result.data.userId !== c.req.param("userId")) {
            return c.json({ error: "Path and profile user IDs must match." }, 400);
          }
          return c.json(await saveProfile(result.data));
        }),
      }),
      registerApiRoute("/v1/discover", {
        method: "POST",
        handler: apiHandler(async c => {
          const result = discoverSchema.safeParse(await requestBody(c.req.raw));
          if (!result.success) return c.json({ error: validationError(result) }, 400);
          try {
            return c.json(await respond(result.data.userId, result.data.message));
          } catch (error) {
            console.error("Event discovery failed", error);
            return c.json({ error: "Event discovery is temporarily unavailable. Please try again." }, 502);
          }
        }),
      }),
      registerApiRoute("/v1/connections", {
        method: "POST",
        handler: apiHandler(async c => {
          const result = connectionSchema.safeParse(await requestBody(c.req.raw));
          if (!result.success) return c.json({ error: validationError(result) }, 400);
          const callbackUrl = new URL("/v1/connections/callback", c.req.url).toString();
          return c.json(await startGmailConnection(result.data.userId, callbackUrl));
        }),
      }),
      registerApiRoute("/v1/connections/callback", {
        method: "GET",
        handler: apiHandler(async c => {
          const failure = c.req.query("error");
          if (failure) return c.html("<h1>Connection not completed</h1><p>Return to Okupy and try again.</p>", 400);
          return c.html("<h1>Connected</h1><p>You can close this tab and return to Okupy.</p>");
        }),
      }),
      registerApiRoute("/v1/reminders/:userId", {
        method: "GET",
        handler: apiHandler(async c => {
          const includeFired = c.req.query("includeFired") === "true";
          const reminders = includeFired
            ? await reminderStore.listForUser(c.req.param("userId"))
            : await reminderStore.listActiveForUser(c.req.param("userId"));
          return c.json({ reminders });
        }),
      }),
      registerApiRoute("/v1/reminders/:id", {
        method: "DELETE",
        handler: apiHandler(async c => {
          const userId = c.req.query("userId")?.trim();
          if (!userId) return c.json({ error: "userId query parameter is required." }, 400);
          const reminder = await reminderStore.cancel(c.req.param("id"), userId);
          if (!reminder) return c.json({ error: "Reminder not found." }, 404);
          return c.json({ reminder });
        }),
      }),
      registerApiRoute("/v1/reminders/:userId/history", {
        method: "GET",
        handler: apiHandler(async c => {
          const limitRaw = c.req.query("limit");
          const limit = Math.max(1, Math.min(100, Number(limitRaw) || 20));
          return c.json({ history: await reminderStore.listHistory(c.req.param("userId"), limit) });
        }),
      }),
    ],
  },
});

void startPhoton().catch(error => console.error("Photon startup failed", error));
startScheduler();
