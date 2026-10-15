// A ZMK `zmk,physical-layout` node as keyloom geometry (04#geometryjson-is-generated-from-the-firmware-tree).
// Each key is `<&key_physical_attrs w h x y r rx ry>` in hundredths of a key and of a degree, with
// negative numbers in parentheses, `(-3000)`, and the keys listed in binding order. The format is
// regular enough that a pattern is clearer than a devicetree parser, and boards/ may not import firmware/.
import { GeometryError } from "./geometry-error.ts";
import type { GeometryKey } from "./schema.ts";

const KEY = /<\s*&key_physical_attrs((?:\s+(?:\(-?\d+\)|-?\d+)){7})\s*>/g;

export function parsePhysicalLayout(text: string): GeometryKey[] {
  // Comments hold column headings and sometimes a commented-out key.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const keys: GeometryKey[] = [];
  for (const m of code.matchAll(KEY)) {
    const n = (m[1] as string).trim().split(/\s+/).map((t) => Number(t.replace(/[()]/g, "")));
    const [w, h, x, y, r, rx, ry] = n as [number, number, number, number, number, number, number];
    keys.push({ x: x / 100, y: y / 100, w: w / 100, h: h / 100, r: r / 100, rx: rx / 100, ry: ry / 100 });
  }
  if (keys.length === 0) throw new GeometryError("no <&key_physical_attrs ...> keys found");
  return keys;
}
