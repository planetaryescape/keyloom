// Run from the repo root: bun docs/research/spikes/device-helper-24b/check-links.mjs
// Checks relative file targets (not remote URLs/heading anchors) throughout the blueprint.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
let checked = 0;
const missing = [];
for await (const file of new Bun.Glob("docs/blueprint/*.md").scan()) {
  for (const match of readFileSync(file, "utf8").matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    checked++;
    if (!existsSync(resolve(dirname(file), decodeURIComponent(target)))) missing.push({ file, target });
  }
}
console.log(JSON.stringify({ relativeFileTargetsChecked: checked, missing }, null, 2));
if (missing.length) process.exitCode = 1;
