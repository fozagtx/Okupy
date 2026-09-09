import { Composio } from "@composio/core";
import { config, secret } from "./config.js";

export type ConnectionResult = {
  app: "gmail";
  redirectUrl: string;
  status: "pending" | "not_configured" | "unavailable";
  note: string;
};

export async function startGmailConnection(userId: string, callbackUrl: string): Promise<ConnectionResult> {
  const apiKey = secret("COMPOSIO_API_KEY");
  if (!apiKey) {
    return {
      app: "gmail",
      redirectUrl: "",
      status: "not_configured",
      note: "COMPOSIO_API_KEY is not set. Add it to connect Gmail.",
    };
  }

  try {
    const composio = new Composio({ apiKey, baseURL: config.composioApiUrl });
    const session = await composio.sessions.create(userId, {
      toolkits: ["gmail"],
      manageConnections: { callbackUrl },
    });
    const request = await session.authorize("gmail", { callbackUrl });
    return {
      app: "gmail",
      redirectUrl: request.redirectUrl ?? "",
      status: "pending",
      note: "Open the Connect Link to authenticate Gmail.",
    };
  } catch (error) {
    return {
      app: "gmail",
      redirectUrl: "",
      status: "unavailable",
      note: `Composio could not start the Gmail connection: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
