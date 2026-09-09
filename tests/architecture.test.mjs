import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the application is a TypeScript Mastra service", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const render = readFileSync("render.yaml", "utf8");
  const source = readFileSync("src/mastra/index.ts", "utf8");
  assert.ok(pkg.dependencies["@mastra/core"]);
  assert.match(source, /new Mastra/);
  assert.match(render, /runtime: node/);
  assert.doesNotMatch(render, /python|uvicorn/i);
});

test("URLs stay out of environment templates and Render", () => {
  const env = readFileSync(".env.example", "utf8");
  const render = readFileSync("render.yaml", "utf8");
  assert.doesNotMatch(env, /URL=/);
  assert.doesNotMatch(render, /URL\b/);
});
