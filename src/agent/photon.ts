import { secret } from "./config.js";
import { respond } from "./respond.js";
import { clearSpectrum, setSpectrumSender } from "./spectrum-state.js";

export type SpectrumStatus = "disabled" | "starting" | "ready" | "error";

let status: SpectrumStatus = "disabled";

export function photonStatus(): SpectrumStatus {
  return status;
}

function extractText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (c.type === "text" && typeof c.text === "string") return c.text;
    if (c.type === "markdown" && typeof c.markdown === "string") return c.markdown;
    if (c.type === "reply" && c.content) return extractText(c.content);
    if (c.type === "group" && Array.isArray(c.items)) {
      return c.items.map(extractText).filter(Boolean).join(" ");
    }
    if (typeof c.text === "string") return c.text;
    if (typeof c.markdown === "string") return c.markdown;
  }
  return "";
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
      while (true) {
        try {
          for await (const [space, message] of spectrum.messages) {
            try {
              // Ignore outbound messages sent by the bot to avoid self-reply loops
              if ((message as { direction?: string }).direction === "outbound") {
                continue;
              }

              const text = extractText(message.content).trim();
              if (!text) {
                // Ignore reactions, typing notifications, and empty pings
                continue;
              }

              const userId = message.sender?.id || space.id;
              console.log(`[spectrum] received iMessage ${message.id} from ${userId}`);

              let replyText: string;
              try {
                const result = await respond(userId, text);
                replyText = result.reply;
              } catch (respondError) {
                console.error("[spectrum] respond() error:", respondError);
                replyText = "Sorry, I had a momentary issue processing that. Please try again.";
              }

              try {
                await message.reply(replyText);
                console.log(`[spectrum] replied to iMessage ${message.id}`);
              } catch (replyError) {
                console.warn(`[spectrum] message.reply failed, attempting space.send:`, replyError);
                await space.send(replyText);
                console.log(`[spectrum] sent reply via space.send for ${message.id}`);
              }
            } catch (msgError) {
              console.error("[spectrum] message handling failed:", msgError);
            }
          }
          console.warn("[spectrum] message stream ended, reconnecting in 3 seconds...");
        } catch (streamError) {
          console.error("[spectrum] message stream encountered error:", streamError);
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    })().catch(error => {
      clearSpectrum();
      status = "error";
      console.error("[spectrum] listener thread failed:", error);
    });
  } catch (error) {
    clearSpectrum();
    status = "error";
    console.error("[spectrum] startup failed:", error);
  }
}
