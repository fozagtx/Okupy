import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import { LibSQLStore } from "@mastra/libsql";
import { builderEventAgent } from "./agent.js";
import { config, secret } from "./config.js";
import { getProfile, saveProfile, type BuilderProfile } from "./profiles.js";
import { respond } from "./respond.js";
import { startPhoton } from "./photon.js";

const dashboard = await readFile("src/mastra/dashboard.html", "utf8");
const json = async (request: Request) => request.json() as Promise<Record<string, unknown>>;
await mkdir(dirname(config.dataFile), { recursive: true });

export const mastra = new Mastra({
  agents: { builderEventAgent },
  storage: new LibSQLStore({ id: "okupy-storage", url: `file:${config.dataFile}.db` }),
  server: { apiRoutes: [
    registerApiRoute("/", { method: "GET", handler: async c => c.html(dashboard) }),
    registerApiRoute("/health", { method: "GET", handler: async c => c.json({ ok: true, framework: "mastra", channel: "photon-imessage" }) }),
    registerApiRoute("/v1/profile/:userId", { method: "GET", handler: async c => c.json(await getProfile(c.req.param("userId"))) }),
    registerApiRoute("/v1/profile/:userId", { method: "PUT", handler: async c => {
      const profile = await json(c.req.raw) as BuilderProfile;
      if (profile.userId !== c.req.param("userId")) return c.json({ error: "Profile IDs must match." }, 400);
      return c.json(await saveProfile(profile));
    }}),
    registerApiRoute("/v1/discover", { method: "POST", handler: async c => {
      const body = await json(c.req.raw);
      return c.json({ reply: await respond(String(body.userId ?? ""), String(body.message ?? "")) });
    }}),
    registerApiRoute("/v1/imessage/inbound", { method: "POST", handler: async c => {
      const body = await json(c.req.raw);
      return c.json({ reply: await respond(String(body.from ?? ""), String(body.text ?? "")) });
    }}),
    registerApiRoute("/v1/connections", { method: "POST", handler: async c => {
      if (!secret("COMPOSIO_API_KEY")) return c.json({ status: "not_configured", note: "Add COMPOSIO_API_KEY to connect Gmail." });
      return c.json({ status: "configured", note: "Composio is configured; create the Gmail connection in the Composio dashboard." });
    }}),
  ]},
});

void startPhoton().catch(error => console.error("Photon startup failed", error));
