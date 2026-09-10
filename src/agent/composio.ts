import { Composio } from "@composio/core";
import { config, secret } from "./config.js";

export type ConnectionResult = {
  app: "gmail";
  redirectUrl: string;
  status: "pending" | "not_configured" | "unavailable";
  note: string;
};

export type GmailOffer = {
  messageId: string;
  subject: string;
  from: string;
  date: string;
  store: "amazon" | "jumia" | "other";
  productLinks: string[];
  snippet: string;
};

export type GmailScanResult =
  | { status: "ok"; offers: GmailOffer[]; total: number }
  | { status: "not_connected"; redirectUrl: string; note: string }
  | { status: "not_configured"; note: string }
  | { status: "error"; note: string };

/** OAuth link to connect the user's Gmail via Composio. */
export async function startGmailConnection(
  userId: string,
  callbackUrl: string,
): Promise<ConnectionResult> {
  const apiKey = secret("COMPOSIO_API_KEY");
  if (!apiKey) {
    return {
      app: "gmail",
      redirectUrl: "",
      status: "not_configured",
      note: "COMPOSIO_API_KEY is not set. Add it to connect Gmail.",
    };
  }
  if (!callbackUrl || !/^https:\/\//.test(callbackUrl)) {
    return {
      app: "gmail",
      redirectUrl: "",
      status: "not_configured",
      note: "Set PUBLIC_BASE_URL to an https:// URL so Gmail can redirect back to Okupy.",
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

const AMAZON_LINK_RE =
  /https?:\/\/(?:www\.)?amazon\.[a-z.]{2,10}\/(?:dp|gp\/product)\/[A-Z0-9]{10}[^\s"<>]*/gi;
const JUMIA_LINK_RE =
  /https?:\/\/(?:www\.)?jumia\.com\.gh\/[a-z0-9-]+-[A-Za-z0-9]{6,}\.html[^\s"<>]*/gi;

function extractProductLinks(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const m of text.matchAll(AMAZON_LINK_RE)) {
    const clean = m[0].split(/["'>]/)[0];
    if (!seen.has(clean)) { seen.add(clean); links.push(clean); }
  }
  for (const m of text.matchAll(JUMIA_LINK_RE)) {
    const clean = m[0].split(/["'>]/)[0];
    if (!seen.has(clean)) { seen.add(clean); links.push(clean); }
  }
  return links;
}

function detectOfferStore(from: string, subject: string): "amazon" | "jumia" | "other" {
  const h = `${from} ${subject}`.toLowerCase();
  if (h.includes("amazon")) return "amazon";
  if (h.includes("jumia")) return "jumia";
  return "other";
}

/**
 * User-triggered: searches the authenticated user's Gmail for promotional
 * messages from Amazon / Jumia, extracts product links, and returns structured
 * offer data ready for the Gmail agent to present.
 *
 * userId MUST be the iMessage sender handle, the same identity bound to the
 * Composio session, so Gmail access is always scoped to the right person.
 */
export async function scanGmailOffers(
  userId: string,
  maxMessages = 10,
): Promise<GmailScanResult> {
  const apiKey = secret("COMPOSIO_API_KEY");
  if (!apiKey) {
    return {
      status: "not_configured",
      note: "COMPOSIO_API_KEY is not set. Add it to enable Gmail scanning.",
    };
  }

  try {
    const composio = new Composio({ apiKey, baseURL: config.composioApiUrl });
    const session = await composio.sessions.create(userId, { toolkits: ["gmail"] });

    // Step 1: list promotional threads from Amazon / Jumia (last 14 days)
    let listResult: Record<string, unknown>;
    try {
      const raw = await session.execute("GMAIL_LIST_THREADS", {
        q: "from:(amazon OR jumia) category:promotions newer_than:14d",
        maxResults: maxMessages,
      });
      listResult = (raw as Record<string, unknown>);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Composio throws a 404/auth error when the Gmail connection doesn't exist yet
      if (/not connected|no connection|unauthorized|auth|404|connection/i.test(msg)) {
        const callbackUrl = config.publicBaseUrl
          ? `${config.publicBaseUrl}/v1/connections/callback`
          : "";
        let redirectUrl = "";
        if (callbackUrl) {
          try {
            const auth = await session.authorize("gmail", { callbackUrl });
            redirectUrl = auth.redirectUrl ?? "";
          } catch {
            // best-effort
          }
        }
        return {
          status: "not_connected",
          redirectUrl,
          note: redirectUrl
            ? "Connect your Gmail first: open the link, then say 'check my Gmail for offers' again."
            : "Your Gmail isn't connected. Use POST /v1/connections to get an OAuth link, then try again.",
        };
      }
      throw error;
    }

    // Step 2: extract thread list from the Composio response envelope
    const threads = extractThreadList(listResult);

    // Step 3: fetch each thread detail and parse offers
    const offers: GmailOffer[] = [];
    for (const thread of threads.slice(0, maxMessages)) {
      try {
        const detail = await session.execute("GMAIL_GET_THREAD", { threadId: thread.id });
        const parsed = parseThreadDetail(detail as Record<string, unknown>, thread.id);
        if (parsed) offers.push(parsed);
      } catch {
        // skip threads that can't be parsed
      }
    }

    return { status: "ok", offers, total: offers.length };
  } catch (error) {
    return {
      status: "error",
      note: `Gmail scan failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

// ---- private helpers --------------------------------------------------------

function extractThreadList(raw: Record<string, unknown>): Array<{ id: string }> {
  // Composio wraps results: try common envelope shapes
  const candidates =
    (raw["threads"] ?? raw["messages"] ?? raw["data"] ?? raw["result"] ?? []);
  if (!Array.isArray(candidates)) return [];
  return candidates.filter(
    (x): x is { id: string } =>
      typeof x === "object" &&
      x !== null &&
      typeof (x as Record<string, unknown>)["id"] === "string",
  );
}

function parseThreadDetail(
  raw: Record<string, unknown>,
  fallbackId: string,
): GmailOffer | null {
  const messages = raw["messages"] ?? raw["data"] ?? [raw];
  const first = Array.isArray(messages) ? messages[0] : messages;
  if (!first || typeof first !== "object") return null;

  const msg = first as Record<string, unknown>;
  const headers = extractHeaders(msg);

  const subject = headers["subject"] ?? "(no subject)";
  const from = headers["from"] ?? "";
  const date = headers["date"] ?? new Date().toISOString();
  const snippet = typeof msg["snippet"] === "string" ? msg["snippet"] : "";
  const body = extractBody(msg);

  const combined = `${subject} ${body} ${snippet}`;
  const productLinks = extractProductLinks(combined);

  // Only surface emails with a trackable link or clear promotional signal
  if (productLinks.length === 0 && !isLikelyOffer(subject, from)) return null;

  return {
    messageId: typeof msg["id"] === "string" ? msg["id"] : fallbackId,
    subject,
    from,
    date,
    store: detectOfferStore(from, subject),
    productLinks,
    snippet: snippet.slice(0, 200),
  };
}

function extractHeaders(msg: Record<string, unknown>): Record<string, string> {
  const payload = msg["payload"] as Record<string, unknown> | undefined;
  const rawHeaders = payload?.["headers"] ?? msg["headers"] ?? [];
  const result: Record<string, string> = {};
  if (!Array.isArray(rawHeaders)) return result;
  for (const h of rawHeaders) {
    if (typeof h === "object" && h !== null) {
      const hh = h as Record<string, unknown>;
      if (typeof hh["name"] === "string" && typeof hh["value"] === "string") {
        result[hh["name"].toLowerCase()] = hh["value"];
      }
    }
  }
  return result;
}

function extractBody(msg: Record<string, unknown>): string {
  try {
    const payload = msg["payload"] as Record<string, unknown> | undefined;
    if (!payload) return "";
    const body = payload["body"] as Record<string, unknown> | undefined;
    if (typeof body?.["data"] === "string") {
      return Buffer.from(body["data"], "base64url").toString("utf8");
    }
    const parts = payload["parts"] as Array<Record<string, unknown>> | undefined;
    if (!parts) return "";
    for (const part of parts) {
      const pb = part["body"] as Record<string, unknown> | undefined;
      if (typeof pb?.["data"] === "string") {
        return Buffer.from(pb["data"], "base64url").toString("utf8");
      }
    }
    return "";
  } catch {
    return "";
  }
}

function isLikelyOffer(subject: string, from: string): boolean {
  const s = `${subject} ${from}`.toLowerCase();
  return /deal|offer|discount|sale|promo|off|save|price drop|flash|limited|today only|shop now/.test(s);
}
