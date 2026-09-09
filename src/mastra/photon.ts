import { secret } from "./config.js";
import { respond } from "./respond.js";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { setSpectrum } from "./spectrum-state.js";

export type PhotonStatus = "disabled" | "starting" | "ready" | "error";

let status: PhotonStatus = "disabled";

export function photonStatus(): PhotonStatus {
  return status;
}

export async function startPhoton(): Promise<void> {
  const projectId = secret("PHOTON_PROJECT_ID");
  const projectSecret = secret("PHOTON_PROJECT_SECRET");
  if (!projectId || !projectSecret) {
    status = "disabled";
    return;
  }

  status = "starting";
  try {
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
          console.error("Photon message handling failed", error);
        }
      }
    })().catch(error => {
      status = "error";
      console.error("Photon listener failed", error);
    });
  } catch (error) {
    status = "error";
    throw error;
  }
}