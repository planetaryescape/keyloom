import { describe, expect, test } from "bun:test";
import { colourwayAttributes } from "../../src/web/keyboard/colourway.ts";

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

// A pinned colourway (D-395): colourway.css redraws a case or the caps out of their room. Every board pair must hold for every pin in
// both rooms, with the room's own tokens under whatever the pin replaces, applied in the stylesheet's order as the page composes them.
const colourwayCss = await Bun.file(new URL("../../src/web/keyboard/colourway.css", import.meta.url)).text();
type Attrs = Record<string, string>;
// Each rule: its selectors' attribute conditions, and its colour tokens. A selector applies when every [name="value"] in it holds.
const rules = [...colourwayCss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
  selectors: (m[1] as string).split(",").map((sel) => [...sel.matchAll(/\[([a-z-]+)="([a-z]+)"\]/g)].map((a) => [a[1] as string, a[2] as string] as const)),
  tokens: [...(m[2] as string).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)].map((t) => [t[1] as string, t[2] as string] as const),
}));
function composed(room: "light" | "dark", attrs: Attrs): Map<string, string> {
  const values = new Map(themes[room]);
  for (const rule of rules) {
    if (!rule.selectors.some((conds) => conds.every(([name, value]) => attrs[name] === value))) continue;
    for (const [name, value] of rule.tokens) values.set(name, value);
  }
  return values;
}
// What a pin can't change: chrome outside the board, and the laptop's keys (a MacBook has no colourways).
// Combo labels inside the board are drawn on --surface with --ink, so those pairs stay in; the status inks on a card are chrome.
const BOARD_PAIRS = PAIRS.filter(([fg, bg]) => fg === "color-combo" || (!fg.startsWith("color-") && !fg.startsWith("mac-") && bg !== "room-spot" && !(fg.endsWith("-ink") && bg === "surface")));

describe("a pinned colourway keeps the board readable", () => {
  for (const room of ["light", "dark"] as const) {
    for (const caseTone of ["light", "dark", "grey"] as const) {
      for (const capsTone of ["light", "dark"] as const) {
        test(`${caseTone} case, ${capsTone} caps, in the ${room} room`, () => {
          const values = composed(room, colourwayAttributes({ case: caseTone, caps: capsTone }, room) as Attrs);
          const failures: string[] = [];
          for (const [fg, bg, minimum] of BOARD_PAIRS) {
            const got = ratio(values.get(fg) as string, values.get(bg) as string);
            if (got < minimum) failures.push(`${fg} on ${bg}: ${got.toFixed(2)}:1, needs ${minimum}:1`);
          }
          for (const tint of ["cap-hold", "cap-layer", "cap-macro"]) {
            for (const face of ["top-lo", "top-hi"]) {
              const got = ratio(values.get("legend") as string, blend(values.get(tint) as string, values.get(face) as string, 0.55));
              if (got < TEXT) failures.push(`legend on ${tint} over ${face}: ${got.toFixed(2)}:1`);
            }
          }
          expect(failures).toEqual([]);
        });
      }
    }
  }

  test("a pin's case or caps declare every board token the theme does, so nothing falls through to the room's", () => {
    const capNames = ["skirt-hi", "skirt-lo", "top-hi", "top-lo", "legend", "front", "ghost", "pending-ink", "red-skirt-hi", "red-skirt-lo", "red-top-hi", "red-top-lo", "red-legend", "red-front", "keycap-red", "cap-key", "cap-key-ink", "cap-modifier", "cap-hold", "cap-layer", "cap-macro", "cap-dance", "cap-native"];
    const caseNames = ["room", "ink", "ink-2", "ink-3", "surface", "pending", "ok", "bad", "finding", "case-hi", "case-lo", "leg", "knob", "knurl", "hole", "ball-hi", "ball-lo", "screen", "color-combo", "layer-1", "layer-6"];
    for (const [room, tone] of [["dark", "light"], ["light", "dark"]] as const) {
      const caps = composed(room, { "data-caps-room": tone });
      const kase = composed(room, { "data-case-room": tone });
      expect(capNames.filter((n) => caps.get(n) === themes[room].get(n) && themes[room].get(n) !== themes[tone].get(n))).toEqual([]);
      expect(caseNames.filter((n) => kase.get(n) === themes[room].get(n) && themes[room].get(n) !== themes[tone].get(n))).toEqual([]);
    }
  });

  test("the grey case is its own charcoal in both rooms, lighter than the black case", () => {
    for (const room of ["light", "dark"] as const) {
      const grey = composed(room, colourwayAttributes({ case: "grey", caps: "light" }, room) as Attrs);
      const black = composed(room, colourwayAttributes({ case: "dark", caps: "dark" }, room) as Attrs);
      expect(ratio(grey.get("case-hi") as string, black.get("case-hi") as string)).toBeGreaterThan(1.2);
    }
  });
});
