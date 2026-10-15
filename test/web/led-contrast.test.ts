import { describe, expect, test } from "bun:test";
import { hsvToHex } from "../../src/layout/colour.ts";
import type { Hsv } from "../../src/layout/schema.ts";

// A key's LED colour tints its cap (D-192). Whatever hue a person picks, the legend must stay readable on the tinted cap.
const css = await Bun.file(new URL("../../src/web/tokens.css", import.meta.url)).text();

function tokens(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return new Map([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)].map((m) => [m[1] as string, m[2] as string]));
}
const wash = Number(/--led-wash:\s*(\d+)%/.exec(css)?.[1]) / 100;

const rgb = (hex: string) => [1, 3, 5].map((o) => Number.parseInt(hex.slice(o, o + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };
// color-mix(in srgb, led wash, cap) is a straight blend of the sRGB channels.
const mix = (led: string, cap: string) => `#${rgb(led).map((c, i) => Math.round(c * wash + (rgb(cap)[i] as number) * (1 - wash)).toString(16).padStart(2, "0")).join("")}`;

const TONES = ["key", "modifier", "hold", "layer", "macro", "native"] as const;
const everyColour: Hsv[] = [];
for (let h = 0; h < 256; h += 4) for (const s of [255, 128, 0]) for (const v of [255, 128]) everyColour.push([h, s, v]);

describe("a lit cap keeps its legend readable", () => {
  test("the wash is a real, small share", () => {
    expect(wash).toBeGreaterThan(0);
    expect(wash).toBeLessThanOrEqual(0.2);
  });

  for (const [name, theme] of [["light", tokens(':root[data-theme="light"]')], ["dark", tokens(':root[data-theme="dark"]')]] as const) {
    test(`${name}: every hue on every cap tone keeps 4.5:1`, () => {
      let worst = Number.POSITIVE_INFINITY;
      for (const tone of TONES) {
        const cap = theme.get(`cap-${tone === "key" ? "key" : tone}`) as string;
        const ink = theme.get(`cap-${tone}-ink`) ?? (theme.get("cap-key-ink") as string);
        for (const colour of everyColour) worst = Math.min(worst, ratio(ink, mix(hsvToHex(colour), cap)));
      }
      expect(worst).toBeGreaterThanOrEqual(4.5);
    });
  }
});
