import { z } from "zod";
import { config, secret } from "./config.js";

export type StoreId = "amazon" | "jumia";
export type ProductSearchStore = StoreId | "both";

export type ProductSearchResult = {
  store: StoreId;
  productId: string;
  title: string;
  description: string;
  url: string;
};

const AMAZON_ROOT_HOSTS = new Set([
  "amazon.ae",
  "amazon.ca",
  "amazon.cn",
  "amazon.co.jp",
  "amazon.co.uk",
  "amazon.co.za",
  "amazon.com",
  "amazon.com.au",
  "amazon.com.be",
  "amazon.com.br",
  "amazon.com.mx",
  "amazon.com.tr",
  "amazon.de",
  "amazon.eg",
  "amazon.es",
  "amazon.fr",
  "amazon.ie",
  "amazon.in",
  "amazon.it",
  "amazon.nl",
  "amazon.pl",
  "amazon.sa",
  "amazon.se",
  "amazon.sg",
  "amzn.to",
]);
// Okupy currently monitors Jumia Ghana only.
const JUMIA_GH_HOST_PATTERN = /(?:^|\.)jumia\.com\.gh$/;

export function detectStore(hostname: string): StoreId | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if ([...AMAZON_ROOT_HOSTS].some(root => host === root || host.endsWith(`.${root}`))) return "amazon";
  if (JUMIA_GH_HOST_PATTERN.test(host)) return "jumia";
  return null;
}

/** True only for Jumia Ghana (jumia.com.gh) — other Jumia countries are out of scope. */
export function isJumiaGhanaHost(hostname: string): boolean {
  return JUMIA_GH_HOST_PATTERN.test(hostname.toLowerCase());
}

export function isJumiaHost(hostname: string): boolean {
  return isJumiaGhanaHost(hostname);
}

export function isAmazonHost(hostname: string): boolean {
  return detectStore(hostname) === "amazon";
}

export function detectStoreFromUrl(rawUrl: string): StoreId | null {
  try {
    return detectStore(new URL(rawUrl).hostname);
  } catch {
    return null;
  }
}

export type FetchedPrice = {
  store: StoreId;
  productId: string;
  title: string;
  price: string | null;
  currency: string;
  imageUrl: string | null;
};

export type StorePolicy = {
  enabledStores: StoreId[];
  jumiaGhanaOnly: boolean;
};

/**
 * Which stores are currently monitored.
 * Override with WATCH_STORES="jumia" to disable Amazon, or "amazon" for Amazon-only.
 * Default tracks both; Jumia is always Ghana-only (jumia.com.gh).
 */
export function storePolicy(): StorePolicy {
  const raw = (process.env.WATCH_STORES ?? "").trim().toLowerCase();
  const enabledStores: StoreId[] =
    raw === "jumia"
      ? ["jumia"]
      : raw === "amazon"
        ? ["amazon"]
        : ["amazon", "jumia"];
  return { enabledStores, jumiaGhanaOnly: true };
}

export function isStoreEnabled(store: StoreId): boolean {
  return storePolicy().enabledStores.includes(store);
}

/** Human-readable rejection when a URL is from a store/country we don't monitor. */
export function unsupportedStoreMessage(rawUrl: string): string | null {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "That doesn't look like a product URL. Send an Amazon link or a Jumia Ghana link (jumia.com.gh/...-<ID>.html).";
  }
  if (host.includes("jumia") && !JUMIA_GH_HOST_PATTERN.test(host)) {
    return "I only track Jumia Ghana (jumia.com.gh) right now. Send the jumia.com.gh version of that link.";
  }
  if (isAmazonHost(host) && !isStoreEnabled("amazon")) {
    return "Amazon tracking is paused — I only track Jumia Ghana right now.";
  }
  if (JUMIA_GH_HOST_PATTERN.test(host) && !isStoreEnabled("jumia")) {
    return "Jumia Ghana tracking is paused right now.";
  }
  if (!detectStore(host)) {
    return "That doesn't look like an Amazon or Jumia Ghana product URL. Send https://www.amazon.com/dp/<ASIN> or https://www.jumia.com.gh/...-<ID>.html.";
  }
  return null;
}

export function extractAsinFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isAmazonHost(url.hostname)) return null;
    const dpMatch = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (dpMatch) return dpMatch[1].toUpperCase();
    const asinMatch = url.searchParams.get("asin");
    if (asinMatch && /^[A-Z0-9]{10}$/i.test(asinMatch)) return asinMatch.toUpperCase();
    return null;
  } catch {
    return null;
  }
}

// ---- Jumia ----
// Jumia product URLs embed the SKU at the end of the path:
//   /<slug>-<SKU>.html   e.g. /tecno-spark-50-...-300723006.html
//   /<slug>-<VENDOR>-mpg<NUM>.html (marketplace listings)
// The trailing token is the stable product id used for dedupe.

export function extractJumiaSkuFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isJumiaHost(url.hostname)) return null;
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const match = last.match(/-([A-Za-z0-9]{6,})\.html$/i);
    if (!match) return null;
    return match[1].toUpperCase();
  } catch {
    return null;
  }
}

export function canonicalJumiaUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isJumiaHost(url.hostname)) return null;
    const sku = extractJumiaSkuFromUrl(rawUrl);
    if (!sku) return null;
    url.protocol = "https:";
    url.username = "";
    url.password = "";
    url.port = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

// ---- Unified entry points (store-aware) ----

export function extractProductIdFromUrl(rawUrl: string): { store: StoreId; productId: string } | null {
  const store = detectStoreFromUrl(rawUrl);
  if (store === "amazon") {
    const asin = extractAsinFromUrl(rawUrl);
    return asin ? { store, productId: asin } : null;
  }
  if (store === "jumia") {
    const sku = extractJumiaSkuFromUrl(rawUrl);
    return sku ? { store, productId: sku } : null;
  }
  return null;
}

export function canonicalProductUrl(rawUrl: string): { store: StoreId; productId: string; url: string } | null {
  const store = detectStoreFromUrl(rawUrl);
  if (store === "amazon") {
    const canonical = canonicalAmazonUrl(rawUrl);
    const asin = canonical ? extractAsinFromUrl(canonical) : null;
    return canonical && asin ? { store, productId: asin, url: canonical } : null;
  }
  if (store === "jumia") {
    const canonical = canonicalJumiaUrl(rawUrl);
    const sku = canonical ? extractJumiaSkuFromUrl(rawUrl) : null;
    return canonical && sku ? { store, productId: sku, url: canonical } : null;
  }
  return null;
}

export function canonicalAmazonUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!isAmazonHost(url.hostname)) return null;
    const asin = extractAsinFromUrl(rawUrl);
    if (!asin) return null;
    url.protocol = "https:";
    url.username = "";
    url.password = "";
    url.port = "";
    url.pathname = `/dp/${asin}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

const FIRECRAWL_EXTRACT_URL = config.firecrawlExtractUrl;
const FIRECRAWL_SEARCH_URL = config.firecrawlSearchUrl;

const searchResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      web: z
        .array(
          z.object({
            title: z.string().optional(),
            description: z.string().optional(),
            url: z.string(),
          }),
        )
        .optional(),
    })
    .optional(),
  error: z.string().optional(),
});

/** Search supported storefronts and return only canonical product-detail URLs. */
export async function searchProducts(
  query: string,
  store: ProductSearchStore = "both",
  limit = 5,
): Promise<ProductSearchResult[]> {
  const normalizedQuery = z.string().trim().min(2).max(200).parse(query);
  const normalizedLimit = z.number().int().min(1).max(10).parse(limit);
  const apiKey = secret("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is required to search for products.");

  const includeDomains =
    store === "amazon" ? ["amazon.com"] : store === "jumia" ? ["jumia.com.gh"] : ["amazon.com", "jumia.com.gh"];
  const response = await fetch(FIRECRAWL_SEARCH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: `${normalizedQuery} product`,
      limit: Math.min(30, Math.max(normalizedLimit * 3, 10)),
      sources: ["web"],
      includeDomains,
      ...(store === "jumia" ? { country: "GH" } : {}),
      ignoreInvalidURLs: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Firecrawl search failed with status ${response.status}.`);

  const payload = searchResponseSchema.parse(await response.json());
  if (payload.error) throw new Error(`Firecrawl search error: ${payload.error}`);

  const seen = new Set<string>();
  const results: ProductSearchResult[] = [];
  for (const candidate of payload.data?.web ?? []) {
    const resolved = canonicalProductUrl(candidate.url);
    if (!resolved || (store !== "both" && resolved.store !== store)) continue;
    const key = `${resolved.store}:${resolved.productId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      store: resolved.store,
      productId: resolved.productId,
      title: candidate.title?.trim() || `${resolved.store === "amazon" ? "Amazon" : "Jumia Ghana"} item`,
      description: candidate.description?.trim() || "",
      url: resolved.url,
    });
    if (results.length >= normalizedLimit) break;
  }
  return results;
}

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
  return fetchProductPage(url, "amazon");
}

export async function fetchJumiaPage(url: string): Promise<FetchedPrice> {
  return fetchProductPage(url, "jumia");
}

/** Store-aware scrape: detects amazon vs jumia from the URL. */
export async function fetchProductPage(url: string, fallbackStore?: StoreId): Promise<FetchedPrice> {
  const detected = detectStoreFromUrl(url) ?? fallbackStore ?? null;
  if (!detected) {
    throw new Error("That doesn't look like an Amazon or Jumia product URL.");
  }
  const productId = detected === "amazon" ? extractAsinFromUrl(url) : extractJumiaSkuFromUrl(url);
  if (!productId) {
    throw new Error(
      detected === "amazon"
        ? "Couldn't extract an ASIN from that URL. Double-check the Amazon link."
        : "Couldn't extract a product ID from that URL. Send the full Jumia product link ending in -<ID>.html.",
    );
  }
  const apiKey = secret("FIRECRAWL_API_KEY");
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is required to scrape product pages.");
  }

  const storeLabel = detected === "amazon" ? "Amazon" : "Jumia";
  const response = await fetch(FIRECRAWL_EXTRACT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      urls: [url],
      prompt:
        `Extract the product title, current price (numeric only, no currency symbol), ISO currency code, and the main product image URL from this ${storeLabel} product page.`,
      schema: {
        ...productSchema,
        properties: {
          ...productSchema.properties,
          title: { type: "string", description: `Full product title as shown on ${storeLabel}` },
        },
      },
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
  const title = (data.title ?? "").trim() || (detected === "amazon" ? "Amazon item" : "Jumia item");
  const currency =
    (data.currency ?? "").trim().toUpperCase() || detectCurrencyFromUrl(url, detected) || defaultCurrencyForStore(detected);
  const price = cleanPrice(data.price ?? "");
  const imageUrl = (data.imageUrl ?? "").trim() || null;
  return { store: detected, productId, title, price, currency, imageUrl };
}

function cleanPrice(value: string | null | undefined): string | null {
  if (!value) return null;
  // Jumia renders prices with thin spaces as thousand separators (e.g. "GH₵ 1 875").
  const spaceless = value.replace(/[\s\u00a0\u2009\u202f]+/g, "");
  const match = spaceless.match(/(\d{1,3}(?:[,.]\d{3})*[.,]\d{2}|\d+[.,]\d{2}|\d+)/);
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

function detectCurrencyFromUrl(url: string, store?: StoreId): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    // Only Jumia Ghana is monitored — always GHS.
    if (host.includes("jumia.com.gh")) return "GHS";
    if (host.includes("jumia")) return store === "jumia" ? "GHS" : null;
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

function defaultCurrencyForStore(store: StoreId): string {
  return store === "jumia" ? "GHS" : "USD";
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
