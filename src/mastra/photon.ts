import { secret } from "./config.js";
import { respond } from "./respond.js";

export async function startPhoton() {
  const projectId = secret("PHOTON_PROJECT_ID");
  const projectSecret = secret("PHOTON_PROJECT_SECRET");
  if (!projectId || !projectSecret) return;
  const mod = await import("spectrum-ts");
  const Spectrum = mod.Spectrum || mod.default || mod;
  const imessage = mod.imessage || mod.providers?.imessage;
  const spectrum = await Spectrum({ projectId, projectSecret, providers: imessage?.config ? [imessage.config()] : [] });
  void (async () => {
    for await (const [space, message] of spectrum.messages) {
      const userId = message?.from || space?.id || "unknown";
      const reply = await respond(userId, message?.text || message?.body || "");
      if (typeof message?.reply === "function") await space?.responding?.(() => message.reply(reply));
      else await space?.send?.(reply);
    }
  })();
}
