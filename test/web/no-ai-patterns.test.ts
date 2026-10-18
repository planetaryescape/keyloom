// Two patterns BK called an AI smell (18#patterns-keyloom-doesnt-use): a coloured accent stripe down a card's left edge, and a sparkle
// marking what a model made. Read from the real stylesheets and components, so a new screen can't bring either back.
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

const root = new URL("../../src/web/", import.meta.url).pathname;
const files = async (pattern: string) => {
  const out: Array<{ path: string; text: string }> = [];
  for await (const path of new Glob(pattern).scan(root)) out.push({ path, text: await Bun.file(root + path).text() });
  return out;
};

// Thin rules that are not a card's accent: History's timeline rail and the lab's dashed time marker.
const ALLOWED = [/^history\/history\.css: {2}border-left: 1px solid var\(--line-2\);$/, /^lab\/lab\.css: {2}border-left: 1\.5px dashed var\(--ink-3\);$/];

describe("no accent stripes", () => {
  test("no left border or left inset shadow of any width, outside the two rules allowed", async () => {
    const found: string[] = [];
    for (const { path, text } of await files("**/*.css")) {
      for (const line of text.split("\n")) {
        const stripe = /border-left(-width)?:\s*(\d+(\.\d+)?)px/.exec(line) ?? /inset\s+(\d+(\.\d+)?)px\s+0\s+0\s+(?!0)/.exec(line);
        if (stripe === null) continue;
        const where = `${path}:${line}`;
        if (ALLOWED.some((ok) => ok.test(where))) continue;
        found.push(where.trim());
      }
    }
    expect(found).toEqual([]);
  });
});

describe("no sparkle for AI", () => {
  test("no component imports a sparkle or wand icon", async () => {
    const found = (await files("**/*.tsx")).filter(({ text }) => /\b(Sparkles?|WandSparkles|Wand2?|Stars)\b/.test(text.match(/import[^;]+from "lucide-react"/)?.[0] ?? "")).map((f) => f.path);
    expect(found).toEqual([]);
  });
});
