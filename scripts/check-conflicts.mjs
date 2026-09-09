import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
});
if (listed.status !== 0) {
  console.error(listed.stderr || "Unable to list files for conflict-marker scanning.");
  process.exit(1);
}

const marker = /^(<{7}|={7}|>{7}) /m;
const conflicts = [];
for (const file of listed.stdout.split("\0").filter(Boolean)) {
  if (file === "scripts/check-conflicts.mjs") continue;
  try {
    const contents = readFileSync(file);
    if (!contents.includes(0) && marker.test(contents.toString("utf8"))) conflicts.push(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

if (conflicts.length) {
  console.error(`Conflict markers found in:\n${conflicts.join("\n")}`);
  process.exit(1);
}
