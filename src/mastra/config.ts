import { existsSync } from "node:fs";
import { join } from "node:path";

/** Public service locations live here. Only credentials belong in the environment. */
const dataDirectory = existsSync("/var/data") ? "/var/data" : join(process.cwd(), "data");

export const config = {
  exaSearchUrl: "https://api.exa.ai/search",
  composioApiUrl: "https://backend.composio.dev",
  dataDirectory,
  profileFile: join(dataDirectory, "profiles.json"),
  memoryDatabaseUrl: `file:${join(dataDirectory, "mastra.db")}`,
  searchWindowDays: 45,
  maxResults: 8,
} as const;

export function secret(name: string): string {
  return process.env[name]?.trim() ?? "";
}
