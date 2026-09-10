import { z } from "zod";
import { secret } from "./config.js";

const AMAZON_HOSTS = new Set(["amazon.com", "www.amazon.com", "smile.amazon.com"]);

export type FetchedPrice = {
  title: string;
  price: string | null;
  currency: string;
  imageUrl: string | null;
};

export function extractAsinFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!AMAZON_HOSTS.has(url.hostname.toLowerCase())) return null;
    const dpMatch = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (dpMatch) return dpMatch[1].toUpperCase();
    const asinMatch = url.searchParams.get("asin");
    if (asinMatch && /^[A-Z0-9]{10}$/i.test(asinMatch)) return asinMatch.toUpperCase();
    return null;
  } catch {
    return null;
  }
}

export function canonicalAmazonUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!AMAZON_HOSTS.has(url.hostname.toLowerCase())) return null;
    const asin = extractAsinFromUrl(rawUrl);
    if (!asin) return null;
    url.pathname = `/dp/${asin}`;
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

const FIRECRAWL_EXTRACT_URL = "https://api.firecrawl.dev/v2/extract";

const extractResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      title: z.string().optional(),
      price: z.string().optional(),
      currency: z.string().optional(),
      imageUrl: z.string().optional(),
    })
    .nullable()
    .optional(),
  error: z.string().optional(),
});

const productSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Full product title as shown on Amazon" },
    price: { type: "string", description: "Numeric price as a string, e.g. 149.99 (no currency symbol)" },
    currency: { type: "string", description: "Three-letter currency code, uppercase, e.g. USD" },
    imageUrl: { type: "string", description: "Absolute URL of the main product image" },
  },
  required: ["title", "price", "currency"],
} as const;

export async function fetchAmazonPage(url: string): Promise<FetchedPrice> {
  const apiKey = secret("FIRECRAWL_API_KEY");
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is required to scrape Amazon product pages.");
  }

  const response = await fetch(FIRECRAWL_EXTRACT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      urls: [url],
      prompt:
        "Extract the product title, current price (numeric only, no currency symbol), ISO currency code, and the main product image URL.",
      schema: productSchema,
      onlyMainContent: true,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl extract failed with status ${response.status}.`);
  }

  const payload = extractResponseSchema.parse(await response.json());
  if (payload.error) throw new Error(`Firecrawl extract error: ${payload.error}`);
  const data = payload.data ?? {};
  const title = (data.title ?? "").trim() || "Amazon item";
  const currency = (data.currency ?? "").trim().toUpperCase() || detectCurrencyFromUrl(url) || "USD";
  const price = cleanPrice(data.price ?? "");
  const imageUrl = (data.imageUrl ?? "").trim() || null;
  return { title, price, currency, imageUrl };
}

function cleanPrice(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.replace(/\s+/g, " ").match(/(\d{1,3}(?:[,.]\d{3})*[.,]\d{2}|\d+[.,]\d{2}|\d+)/);
  if (!match) return null;
  const raw = match[1];
  if (raw.includes(",") && raw.includes(".")) {
    const lastComma = raw.lastIndexOf(",");
    const lastDot = raw.lastIndexOf(".");
    if (lastComma > lastDot) return raw.replace(/\./g, "").replace(",", ".");
    return raw.replace(/,/g, "");
  }
  if (raw.includes(",")) {
    const parts = raw.split(",");
    if (parts.length === 2 && parts[1].length === 2) return raw.replace(",", ".");
    return raw.replace(/,/g, "");
  }
  return raw;
}

function detectCurrencyFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".ca")) return "CAD";
    if (host.endsWith(".co.uk") || host.endsWith(".uk")) return "GBP";
    if (host.endsWith(".de") || host.endsWith(".fr") || host.endsWith(".it") || host.endsWith(".es")) return "EUR";
    if (host.endsWith(".jp")) return "JPY";
    if (host.endsWith(".com.au")) return "AUD";
    if (host.endsWith(".in")) return "INR";
    return null;
  } catch {
    return null;
  }
}

export type PriceComparison = {
  previous: string | null;
  current: string;
  currency: string;
  changed: boolean;
  droppedByAmount: number | null;
  droppedByPercent: number | null;
  reachedTarget: boolean;
};

export function comparePrices(
  previous: string | null,
  current: string,
  currency: string,
  target?: string | null,
): PriceComparison {
  const prevNumber = previous ? Number(previous) : null;
  const currNumber = Number(current);
  const targetNumber = target ? Number(target) : null;
  const validCurrent = Number.isFinite(currNumber);
  const validPrev = previous !== null && Number.isFinite(prevNumber);
  let droppedByAmount: number | null = null;
  let droppedByPercent: number | null = null;
  if (validCurrent && validPrev && prevNumber !== null && currNumber < prevNumber) {
    droppedByAmount = prevNumber - currNumber;
    droppedByPercent = prevNumber > 0 ? (droppedByAmount / prevNumber) * 100 : null;
  }
  return {
    previous,
    current,
    currency,
    changed: Boolean(validPrev && prevNumber !== null && currNumber !== prevNumber),
    droppedByAmount,
    droppedByPercent,
    reachedTarget: Boolean(targetNumber !== null && validCurrent && currNumber <= targetNumber),
  };
}