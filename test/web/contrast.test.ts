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
  // Chrome on the room and on cards (23#palette).
  ...["room", "room-spot", "surface", "surface-2", "surface-3"].flatMap((bg) => [
    ["ink", bg, TEXT] as const,
    ["ink-2", bg, TEXT] as const,
    ["ink-3", bg, TEXT] as const,
  ]),
  ["primary-ink", "primary", TEXT],
  ["pending-ink", "surface", TEXT],
  ["ok-ink", "surface", TEXT],
  ["bad-ink", "surface", TEXT],
  // The keycap: the tap legend on the top face, the front print on the skirt at its darkest and lightest, the draft's amber front
  // print, the empty slots' ghost words, the red thumb caps and a laptop's keys.
  ["legend", "top-lo", TEXT],
  ["legend", "top-hi", TEXT],
  ["front", "skirt-lo", TEXT],
  ["front", "skirt-hi", TEXT],
  ["ghost", "skirt-hi", TEXT],
  ["pending-ink", "skirt-lo", TEXT],
  ["red-legend", "red-top-lo", TEXT],
  ["red-legend", "red-top-hi", TEXT],
  ["red-front", "red-skirt-lo", TEXT],
  ["red-front", "red-skirt-hi", TEXT],
  ["mac-legend", "mac-top", TEXT],
  ["mac-legend", "mac-key", TEXT],
  // Marks on and around a cap: the focus and selection ring, the proposal's amber ring and a combo line, against the case they sit on.
  ["ink", "case-lo", UI],
  ["ink", "case-hi", UI],
  ["pending", "case-lo", UI],
  ["color-combo", "case-lo", UI],
  ["color-combo", "room", UI],
  // The older names other screens still use (tokens.css keeps them, holding the new values).
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
  ["color-error", "color-page", TEXT],
  ["color-accent", "color-page", TEXT],
  ["color-accent", "color-surface", TEXT],
  ["color-accent", "color-panel", TEXT],
  ["color-accent", "color-accent-bg", TEXT],
  ["color-text", "color-accent-bg", TEXT],
  ["color-text-muted", "color-accent-bg", TEXT],
  ["color-warning", "color-surface", TEXT],
  ["color-warning", "color-page", TEXT],
  ["color-warning", "color-warning-bg", TEXT],
  ["color-text", "color-warning-bg", TEXT],
  ["color-text-muted", "color-warning-bg", TEXT],
  ["color-success", "color-surface", TEXT],
  ["color-success", "color-page", TEXT],
  ["color-success", "color-success-bg", TEXT],
  ["color-text", "color-success-bg", TEXT],
  ["color-text-muted", "color-success-bg", TEXT],
  ["color-border-strong", "color-panel", UI],
  ["color-focus", "color-panel", UI],
  // Inspect's kind tints: each ink on its own tint.
  ["cap-key-ink", "cap-key", TEXT],
  ["cap-modifier-ink", "cap-modifier", TEXT],
  ["cap-hold-ink", "cap-hold", TEXT],
  ["cap-layer-ink", "cap-layer", TEXT],
  ["cap-macro-ink", "cap-macro", TEXT],
  ["cap-dance-ink", "cap-dance", TEXT],
  ["cap-native-ink", "cap-native", TEXT],
];

// Inspect lays each kind's tint over the top face at 55% (keyboard.css); the tap legend must still read on it. A lit key's skirt carries
// its LED at --led-wash; the front print must read on the reddest one, Navigation's #f50909 in BK's layout (P1 review).
const blend = (a: string, b: string, share: number): string =>
  `#${[1, 3, 5].map((o) => Math.round(Number.parseInt(a.slice(o, o + 2), 16) * share + Number.parseInt(b.slice(o, o + 2), 16) * (1 - share)).toString(16).padStart(2, "0")).join("")}`;

describe("legends on Inspect's tints and on a red-lit skirt", () => {
  for (const [theme, values] of [["light", themes.light], ["dark", themes.dark]] as const) {
    test(`${theme}`, () => {
      const failures: string[] = [];
      const at = (name: string) => values.get(name) as string;
      for (const tint of ["cap-hold", "cap-layer", "cap-macro"]) {
        for (const face of ["top-lo", "top-hi"]) {
          const got = ratio(at("legend"), blend(at(tint), at(face), 0.55));
          if (got < TEXT) failures.push(`legend on ${tint} over ${face}: ${got.toFixed(2)}:1`);
        }
      }
      for (const skirt of ["skirt-lo", "skirt-hi"]) {
        const got = ratio(at("front"), blend("#f50909", at(skirt), 0.12));
        if (got < TEXT) failures.push(`front on red-lit ${skirt}: ${got.toFixed(2)}:1`);
      }
      expect(failures).toEqual([]);
    });
  }
});

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

  // Kinds are not drawn at rest (D-264). Under Inspect each kind's tint must still differ from a plain key's.
  test("under Inspect, every kind's tint differs from a plain key by at least 1.2:1 in both themes", () => {
    const failures: string[] = [];
    for (const [theme, values] of themeList) {
      for (const kind of ["modifier", "hold", "layer", "macro", "native"]) {
        const got = ratio(need(values, "cap-key"), need(values, `cap-${kind}`));
        if (got < 1.2) failures.push(`${theme}: cap-${kind} against cap-key is ${got.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  // The light means one thing per colour (D-263): amber is a change not on the keyboard, green is one that is, and neither may be
  // mistaken for the other.
  test("amber and green are told apart in both themes", () => {
    for (const [, values] of themeList) {
      expect(need(values, "pending")).not.toBe(need(values, "ok"));
    }
  });

  test("the six layer colours differ from each other, so two layers are not told apart by one hue", () => {
    for (const [, values] of themeList) {
      const colours = [1, 2, 3, 4, 5, 6].map((n) => need(values, `layer-${n}`));
      expect(new Set(colours).size).toBe(6);
    }
  });
});
