import { spawnSync } from "node:child_process";

const result = spawnSync("git", ["grep", "-n", "-E", "^(<<<<<<< |=======|>>>>>>> )", "--", ".", ":(exclude)scripts/check-conflicts.mjs"], {
  encoding: "utf8",
});

if (result.status === 0) {
  console.error(result.stdout);
  process.exit(1);
}
if (result.status !== 1) {
  console.error(result.stderr || "Unable to scan for conflict markers.");
  process.exit(1);
}
