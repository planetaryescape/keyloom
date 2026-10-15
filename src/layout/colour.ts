// QMK's HSV (each channel 0 to 255, hue wrapping at 256) <-> the hex the browser draws. It is the same conversion
// the firmware's hsv_to_rgb does up to rounding, so what the cap shows is what the LED will be, within a shade.
import type { Hsv, Layer } from "./schema.ts";

export const DARK: Hsv = [0, 0, 0];

/** The colour of the key at `position` while `layer` is on top: its own, else the layer's, else dark. */
export function colourAt(layer: Pick<Layer, "lighting">, position: number): Hsv {
  const lighting = layer.lighting;
  return lighting?.keys?.[String(position)] ?? lighting?.layer ?? DARK;
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex = (n: number) => clamp(n).toString(16).padStart(2, "0");

export function hsvToHex([h, s, v]: Hsv): string {
  const hue = (h / 256) * 6;
  const sector = Math.floor(hue);
  const f = hue - sector;
  const p = v * (1 - s / 255);
  const q = v * (1 - (s / 255) * f);
  const t = v * (1 - (s / 255) * (1 - f));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][sector % 6] as [number, number, number];
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function hexToHsv(value: string): Hsv | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((c) => Number.parseInt(c as string, 16)) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d + 6) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
  }
  return [clamp((hue / 6) * 256) % 256, max === 0 ? 0 : clamp((d / max) * 255), max];
}

/** True for {0,0,0}, which the firmware writes as off. */
export const isDark = ([h, s, v]: Hsv): boolean => h === 0 && s === 0 && v === 0;

/** The swatches the colour controls offer first: Oryx's own hues at full strength, white, and the 245-value red its layers default to. */
export const SWATCHES: ReadonlyArray<{ name: string; hsv: Hsv }> = [
  { name: "Red", hsv: [0, 255, 255] },
  { name: "Orange", hsv: [21, 255, 255] },
  { name: "Yellow", hsv: [43, 255, 255] },
  { name: "Green", hsv: [85, 255, 255] },
  { name: "Teal", hsv: [113, 255, 255] },
  { name: "Cyan", hsv: [131, 255, 255] },
  { name: "Blue", hsv: [170, 255, 255] },
  { name: "Purple", hsv: [188, 255, 255] },
  { name: "Pink", hsv: [213, 255, 255] },
  { name: "White", hsv: [0, 0, 255] },
];

/** A colour's name when it is one of the swatches, else its hex, for labels and history lines. */
export const colourName = (hsv: Hsv): string => SWATCHES.find((s) => s.hsv.every((n, i) => n === hsv[i]))?.name.toLowerCase() ?? hsvToHex(hsv);
