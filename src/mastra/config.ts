/** Public service locations live here. Only credentials belong in the environment. */
export const config = {
  exaSearchUrl: "https://api.exa.ai/search",
  composioConnectionsUrl: "https://backend.composio.dev/api/v1/connectedAccounts",
  dataFile: process.env.RENDER ? "/var/data/profiles.json" : "./data/profiles.json",
  searchWindowDays: 45,
  maxResults: 8,
} as const;

export function secret(name: string): string {
  return process.env[name]?.trim() ?? "";
}
