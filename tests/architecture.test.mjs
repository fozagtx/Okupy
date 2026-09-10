import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8");

test("the application is a TypeScript AI SDK service", () => {
  const pkg = JSON.parse(read("package.json"));
  const render = read("render.yaml");
  const source = read("src/server.ts");
  assert.ok(pkg.dependencies["@ai-sdk/openai"]);
  assert.ok(pkg.dependencies["ai"]);
  assert.equal(pkg.dependencies["@mastra/core"], undefined, "Mastra must be fully removed");
  assert.match(source, /createServer/);
  assert.match(render, /runtime: node/);
  assert.doesNotMatch(render, /python|uvicorn|docker/i);
  assert.equal(existsSync(join(root, "src/okupy")), false, "legacy Python backend must stay removed");
  assert.equal(existsSync(join(root, "pyproject.toml")), false);
  assert.equal(existsSync(join(root, "requirements.txt")), false);
});

test("URLs stay in TypeScript config and out of environment configuration", () => {
  const env = read(".env.example");
  const render = read("render.yaml");
  const config = read("src/mastra/config.ts");
  const server = read("src/server.ts");
  assert.doesNotMatch(env, /\bEXA_URL=|SEARCH_URL=|API_URL=|FIRECRAWL_URL=/);
  assert.doesNotMatch(render, /\bEXA_URL|SEARCH_URL|API_URL|FIRECRAWL_URL\b/);
  assert.match(config, /https:\/\/api\.exa\.ai\/search/);
  assert.match(config, /https:\/\/backend\.composio\.dev/);
  assert.match(config, /https:\/\/api\.firecrawl\.dev\/v2\/extract/);
  assert.match(config, /https:\/\/api\.aimlapi\.com\/v1/);
  assert.doesNotMatch(`${env}\n${render}`, /EVE_API_KEY|OKUPY_API_URL/);
  assert.doesNotMatch(server, /\?host|query\.get\("host"\)/);
  assert.match(env, /DATABASE_URL=/, "DATABASE_URL must be configured for Neon persistence");
  assert.match(env, /FIRECRAWL_API_KEY=/, "Firecrawl key is required for Amazon scraping");
  assert.match(env, /PUBLIC_BASE_URL=/, "OAuth callbacks need an allowlisted public base URL");
});

test("deployment uses a reproducible Node build", () => {
  const render = read("render.yaml");
  const config = read("src/mastra/config.ts");
  assert.ok(existsSync(join(root, "package-lock.json")));
  assert.match(render, /buildCommand: npm ci && npm run build/);
  assert.match(render, /startCommand: npm start/);
  assert.match(config, /firecrawlExtractUrl/);
  assert.match(config, /aimlApiBaseUrl/);
  assert.doesNotMatch(config, /profileFile|memoryDatabaseUrl|dataDirectory/);
  assert.doesNotMatch(render, /mountPath: \/var\/data/);
});

test("iMessage uses the current split Spectrum cloud packages", () => {
  const pkg = JSON.parse(read("package.json"));
  const photon = read("src/mastra/photon.ts");
  const spectrumState = read("src/mastra/spectrum-state.ts");

  assert.ok(pkg.dependencies["@spectrum-ts/core"]);
  assert.ok(pkg.dependencies["@spectrum-ts/imessage"]);
  assert.equal(pkg.dependencies["spectrum-ts"], undefined);
  assert.equal(pkg.overrides?.["@photon-ai/imessage-kit"], undefined);
  assert.match(photon, /import\("@spectrum-ts\/core"\)/);
  assert.match(photon, /import\("@spectrum-ts\/imessage"\)/);
  assert.doesNotMatch(`${photon}\n${spectrumState}`, /from "spectrum-ts"|import\("spectrum-ts/);
});
