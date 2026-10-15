import { describe, expect, test } from "bun:test";

// 18#visual-system: spacing is the 4-based tokens only. This guards the files the shell, the panel and
// the board own; older stylesheets still carry raw values and move over as their screens are rebuilt.
const OWNED = ["shell/shell.css", "panel/panel.css", "keyboard/keyboard.css", "tokens.css"];
const SPACING = /(^|[\s{;])((?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?)\s*:\s*([^;}]+)/g;

describe("spacing uses tokens", () => {
  for (const file of OWNED) {
    test(`${file} has no raw px in padding, margin or gap`, async () => {
      const css = await Bun.file(new URL(`../../src/web/${file}`, import.meta.url)).text();
      const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const raw: string[] = [];
      for (const match of bare.matchAll(SPACING)) {
        const value = match[3] as string;
        // The token definitions themselves are the one place a px value belongs.
        if (file !== "tokens.css" && /\d+(\.\d+)?px/.test(value)) raw.push(`${match[2]}: ${value.trim()}`);
      }
      expect(raw).toEqual([]);
    });
  }
});
