import { secret } from "./config.js";
import { respond } from "./respond.js";
import { clearSpectrum, setSpectrumSender } from "./spectrum-state.js";

export type SpectrumStatus = "disabled" | "starting" | "ready" | "error";

let status: SpectrumStatus = "disabled";

export function photonStatus(): SpectrumStatus {
  return status;
}

export async function startPhoton(): Promise<void> {
  const projectId = secret("SPECTRUM_PROJECT_ID") || secret("PHOTON_PROJECT_ID");
  const projectSecret = secret("SPECTRUM_PROJECT_SECRET") || secret("PHOTON_PROJECT_SECRET");
  if (!projectId || !projectSecret) {
    status = "disabled";
    return;
  }

  status = "starting";
  try {
    const [{ Spectrum }, { imessage }] = await Promise.all([
      import("@spectrum-ts/core"),
      import("@spectrum-ts/imessage"),
    ]);
    const spectrum = await Spectrum({
      projectId,
      projectSecret,
      providers: [imessage.config()],
    });
    const channel = imessage(spectrum);
    setSpectrumSender(async (userId, body) => {
      const user = await channel.user(userId);
      const space = await channel.space.create(user);
      await space.send(body);
    });
    status = "ready";
    console.log("[spectrum] iMessage listener ready");

    void (async () => {
      for await (const [space, message] of spectrum.messages) {
        try {
          const userId = message.sender?.id || space.id;
          const text = message.content.type === "text" ? message.content.text : "";
          console.log(`[spectrum] received iMessage ${message.id}`);
          const result = await respond(userId, text);
          await space.responding(() => message.reply(result.reply));
          console.log(`[spectrum] replied to iMessage ${message.id}`);
        } catch (error) {
          console.error("Spectrum message handling failed", error);
        }
      }
      clearSpectrum();
      status = "error";
      console.error("Spectrum listener ended unexpectedly");
    })().catch(error => {
      clearSpectrum();
      status = "error";
      console.error("Spectrum listener failed", error);
    });
  } catch (error) {
    clearSpectrum();
    status = "error";
    console.error("Spectrum startup failed", error);
  }
}
