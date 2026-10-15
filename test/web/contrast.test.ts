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
  ["color-error", "color-surface", TEXT],
  ["color-error", "color-panel", TEXT],
  ["color-accent", "color-page", TEXT],
  ["color-accent", "color-surface", TEXT],
  ["color-accent", "color-panel", TEXT],
  ["color-accent", "color-accent-bg", TEXT],
  ["color-accent", "cap-key", UI],
  ["color-text", "color-accent-bg", TEXT],
  ["color-warning", "color-surface", TEXT],
  ["color-warning", "color-warning-bg", TEXT],
  ["color-text", "color-warning-bg", TEXT],
  ["color-success", "color-surface", TEXT],
  ["color-success", "color-success-bg", TEXT],
  ["color-text", "color-success-bg", TEXT],
  ["color-text-muted", "color-accent-bg", TEXT],
  ["color-text-muted", "color-warning-bg", TEXT],
  ["color-text-muted", "color-success-bg", TEXT],
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
  // Chat (rung 3): proposal cards sit on the page colour inside the surface-coloured panel.
  ["color-success", "color-page", TEXT],
  ["color-warning", "color-page", TEXT],
  ["color-error", "color-page", TEXT],
  // The chat-selection ring is drawn in the accent colour inside each kind of cap.
  ["color-accent", "cap-modifier", UI],
  ["color-accent", "cap-hold", UI],
  ["color-accent", "cap-layer", UI],
  ["color-accent", "cap-macro", UI],
  ["color-accent", "cap-native", UI],
  // The preview marks (dashed ring and dot) sit on the board's panel.
  ["color-accent", "color-panel", UI],
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

// Non-text contrast (WCAG 1.4.11, D-100): the shapes that carry meaning on the board must be seen against
// what they sit on, and kinds must not rely on a fill that looks like its neighbour's.
const keyboardCss = await Bun.file(new URL("../../src/web/keyboard/keyboard.css", import.meta.url)).text();

describe("non-text contrast", () => {
  const themeList = [
    ["light", themes.light],
    ["dark", themes.dark],
  ] as const;
  const need = (values: Map<string, string>, name: string): string => {
    const value = values.get(name);
    if (value === undefined) throw new Error(`tokens.css does not declare --${name}`);
    return value;
  };

  // The border the CSS really draws on a cap, not a token this test assumes it uses.
  test("every cap's border, as keyboard.css draws it, is at least 3:1 against the stage in both themes", () => {
    const rule = /\n\.cap \{[^}]*?border:\s*1px solid var\(--([a-z0-9-]+)\)/s.exec(keyboardCss);
    expect(rule).not.toBeNull();
    const token = rule?.[1] as string;
    for (const [theme, values] of themeList) {
      expect({ theme, ratio: Math.round(ratio(need(values, token), need(values, "color-panel")) * 100) / 100 >= 3 }).toEqual({ theme, ratio: true });
    }
  });

  test("a plain key and every other kind of cap differ by at least 1.5:1 in both themes", () => {
    const failures: string[] = [];
    for (const [theme, values] of themeList) {
      for (const kind of ["modifier", "hold", "layer", "macro", "native"]) {
        const got = ratio(need(values, "cap-key"), need(values, `cap-${kind}`));
        if (got < 1.5) failures.push(`${theme}: cap-${kind} against cap-key is ${got.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("a layer key's edge colours stand out from the layer fill and the plain key fill by 3:1", () => {
    const failures: string[] = [];
    for (const [theme, values] of themeList) {
      for (let n = 1; n <= 6; n++) {
        for (const fill of ["cap-layer", "cap-key"]) {
          const got = ratio(need(values, `layer-${n}`), need(values, fill));
          if (got < 3) failures.push(`${theme}: layer-${n} on ${fill} is ${got.toFixed(2)}:1`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test("the six layer colours differ from each other, so two layers are not told apart by one hue", () => {
    for (const [, values] of themeList) {
      const colours = [1, 2, 3, 4, 5, 6].map((n) => need(values, `layer-${n}`));
      expect(new Set(colours).size).toBe(6);
    }
  });
});
