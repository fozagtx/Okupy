/**
 * Photon Spectrum sidecar.
 * spectrum-ts is TypeScript/gRPC-only, so Python talks to this process over loopback HTTP.
 */
import http from "node:http";

const port = Number(process.env.PHOTON_SIDECAR_PORT || 8789);
const token = process.env.PHOTON_SIDECAR_TOKEN || "";
const apiUrl = (process.env.OKUPY_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

let app = null;

function authorized(req) {
  if (!token) return true;
  return req.headers["x-okupy-sidecar-token"] === token;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function bootSpectrum() {
  const projectId = process.env.PHOTON_PROJECT_ID;
  const projectSecret = process.env.PHOTON_PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    console.warn("Photon credentials missing; sidecar HTTP is up but Spectrum is idle.");
    return null;
  }
  try {
    const mod = await import("spectrum-ts");
    const Spectrum = mod.Spectrum || mod.default || mod;
    const imessage = mod.imessage || mod.providers?.imessage;
    const instance = await Spectrum({
      projectId,
      projectSecret,
      providers: imessage?.config ? [imessage.config()] : [],
    });
    if (instance?.messages) {
      (async () => {
        for await (const [space, message] of instance.messages) {
          const text = message?.text || message?.body || "";
          const from = message?.from || space?.id || "";
          try {
            const res = await fetch(`${apiUrl}/v1/imessage/inbound`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ from, text }),
            });
            const result = await res.json();
            const reply = `Okupy job ${result.job_id}: ${result.title}`;
            if (typeof message?.reply === "function") {
              await space?.responding?.(async () => message.reply(reply));
            } else if (typeof space?.send === "function") {
              await space.send(reply);
            }
          } catch (err) {
            console.error("Inbound dispatch failed", err);
          }
        }
      })();
    }
    console.log("Photon Spectrum connected.");
    return instance;
  } catch (err) {
    console.warn("spectrum-ts not available yet:", err.message);
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, spectrum: Boolean(app) }));
    return;
  }
  if (req.method === "POST" && req.url === "/send") {
    if (!authorized(req)) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }
    try {
      const body = await readBody(req);
      if (app && typeof app.send === "function") {
        await app.send(body);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

app = await bootSpectrum();
server.listen(port, "127.0.0.1", () => {
  console.log(`Okupy Photon sidecar on 127.0.0.1:${port}`);
});
