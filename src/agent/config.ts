/** Public service locations live here. Only credentials belong in the environment. */
export const config = {
  exaSearchUrl: "https://api.exa.ai/search",
  composioApiUrl: "https://backend.composio.dev",
  firecrawlExtractUrl: "https://api.firecrawl.dev/v2/extract",
  firecrawlSearchUrl: "https://api.firecrawl.dev/v2/search",
  aimlApiBaseUrl: "https://api.aimlapi.com/v1",
  searchWindowDays: 45,
  maxResults: 8,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, ""),
} as const;

export function secret(name: string): string {
  return process.env[name]?.trim() ?? "";
}
