import { secret } from "./config.js";
import { respond } from "./respond.js";
import { setSpectrum } from "./spectrum-state.js";

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
      import("spectrum-ts"),
      import("spectrum-ts/providers/imessage"),
    ]);
    const spectrum = await Spectrum({
      projectId,
      projectSecret,
      providers: [imessage.config()],
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
    })().catch(error => {
      status = "error";
      console.error("Spectrum listener failed", error);
    });
  } catch (error) {
    status = "error";
    console.error("Spectrum startup failed", error);
  }
}