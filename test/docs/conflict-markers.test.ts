// A merge resolved by hand left a "||||||| parent of" line in the decision log on main (2026-10-18); nothing caught it.
import { expect, test } from "bun:test";

const MARKER = /^(<{7}|\|{7}|>{7})( |$)|^={7}$/m;

test("no tracked text file holds a leftover merge-conflict marker", async () => {
  const listed = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: `${import.meta.dir}/../..` }).stdout.toString().split("\0").filter(Boolean);
  const text = listed.filter((path) => /\.(md|ts|tsx|json|css|html|ya?ml|sh|c|h|keymap|dtsi|kbd)$/.test(path));
  const found: string[] = [];
  for (const path of text) {
    const body = await Bun.file(`${import.meta.dir}/../../${path}`).text();
    if (MARKER.test(body)) found.push(path);
  }
  expect(found).toEqual([]);
});
