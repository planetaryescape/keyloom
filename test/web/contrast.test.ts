import { describe, expect, test } from "bun:test";

// Reads the real stylesheet, so a token change that drops a pair below WCAG fails here.
const css = await Bun.file(new URL("../../src/web/tokens.css", import.meta.url)).text();

// A block runs from its selector to the first closing brace; none of the token blocks nest.
function tokens(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`tokens.css has no ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return new Map(
    [...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

const themes = {
  light: tokens(':root[data-theme="light"]'),
  dark: tokens(':root[data-theme="dark"]'),
  // The media query repeats the dark values for people with no data-theme set.
  darkByPreference: tokens(':root:not([data-theme="light"])'),
};

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum]. Text needs 4.5; borders and the focus ring need 3 (WCAG 1.4.11).
const TEXT = 4.5;
const UI = 3;
const PAIRS: readonly (readonly [string, string, number])[] = [
  ["color-text", "color-page", TEXT],
  ["color-text", "color-surface", TEXT],
  ["color-text", "color-panel", TEXT],
  ["color-text-muted", "color-page", TEXT],
  ["color-text-muted", "color-surface", TEXT],
  ["color-text-muted", "color-panel", TEXT],
  ["color-text-muted", "color-error-bg", TEXT],
  ["color-error", "color-error-bg", TEXT],
  ["cap-key-ink", "cap-key", TEXT],
  ["cap-modifier-ink", "cap-modifier", TEXT],
  ["cap-hold-ink", "cap-hold", TEXT],
  ["cap-layer-ink", "cap-layer", TEXT],
  ["cap-macro-ink", "cap-macro", TEXT],
  ["cap-native-ink", "cap-native", TEXT],
  // Transparent keys are drawn with muted text straight on the panel.
  ["color-text-muted", "color-panel", TEXT],
  ["color-border-strong", "color-panel", UI],
  ["color-focus", "color-panel", UI],
  ["color-focus", "cap-key", UI],
  ["color-focus", "cap-layer", UI],
  ["color-combo", "color-panel", UI],
  ["color-combo", "cap-key", UI],
  ["color-combo", "cap-hold", UI],
];

describe("token contrast", () => {
  for (const [theme, values] of [
    ["light", themes.light],
    ["dark", themes.dark],
  ] as const) {
    test(`${theme}: every listed pair meets its minimum`, () => {
      const failures: string[] = [];
      for (const [fg, bg, minimum] of PAIRS) {
        const a = values.get(fg);
        const b = values.get(bg);
        if (a === undefined || b === undefined) {
          failures.push(`${fg} or ${bg} is not declared`);
          continue;
        }
        const got = ratio(a, b);
        if (got < minimum) failures.push(`${fg} on ${bg}: ${got.toFixed(2)}:1, needs ${minimum}:1`);
      }
      expect(failures).toEqual([]);
    });
  }

  test("the preference-driven dark block has the same values as the explicit dark theme", () => {
    expect(Object.fromEntries(themes.darkByPreference)).toEqual(Object.fromEntries(themes.dark));
  });

  test("light and dark declare the same token names", () => {
    expect([...themes.light.keys()].sort()).toEqual([...themes.dark.keys()].sort());
  });
});
