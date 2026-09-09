import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const pkgPath = resolve(process.cwd(), ".mastra/output/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.overrides = pkg.overrides ?? {};
pkg.overrides["@photon-ai/imessage-kit"] = "3.0.0-rc.2";
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);