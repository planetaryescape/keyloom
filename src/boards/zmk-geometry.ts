// A ZMK `zmk,physical-layout` node as keyloom geometry (04#geometryjson-is-generated-from-the-firmware-tree).
// Each key is `<&key_physical_attrs w h x y r rx ry>` in hundredths of a key and of a degree, with
// negative numbers in parentheses, `(-3000)`, and the keys listed in binding order. The format is
// regular enough that a pattern is clearer than a devicetree parser, and boards/ may not import firmware/.
import { GeometryError } from "./geometry-error.ts";
import type { GeometryKey } from "./schema.ts";

const KEY = /<\s*&key_physical_attrs((?:\s+(?:\(-?\d+\)|-?\d+)){7})\s*>/g;

// Comments hold column headings and sometimes a commented-out key.
export const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Whether `label: node {` appears in a file, comments aside. */
export const definesLabel = (text: string, label: string): boolean => labelledNode(withoutComments(text), label) !== undefined;

function labelledNode(code: string, label: string): string | undefined {
  const open = new RegExp(`(?:^|[\\s;{}])${label}\\s*:\\s*[A-Za-z0-9_,@-]+\\s*\\{`).exec(code);
  if (!open) return undefined;
  const start = open.index + open[0].length;
  for (let depth = 1, i = start; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(start, i);
  }
  return undefined;
}

/**
 * Keys of the physical layout in `text`. A file that holds several layouts (a split keyboard's 5- and 6-column variants) is
 * read through the node's label, which a board names as `file#label`; without a label the whole file is the layout.
 */
export function parsePhysicalLayout(text: string, label?: string): GeometryKey[] {
  const code = label === undefined ? withoutComments(text) : labelledNode(withoutComments(text), label);
  if (code === undefined) throw new GeometryError(`no physical layout labelled ${label}`);
  const keys: GeometryKey[] = [];
  for (const m of code.matchAll(KEY)) {
    const n = (m[1] as string).trim().split(/\s+/).map((t) => Number(t.replace(/[()]/g, "")));
    const [w, h, x, y, r, rx, ry] = n as [number, number, number, number, number, number, number];
    keys.push({ x: x / 100, y: y / 100, w: w / 100, h: h / 100, r: r / 100, rx: rx / 100, ry: ry / 100 });
  }
  if (keys.length === 0) throw new GeometryError("no <&key_physical_attrs ...> keys found");
  return keys;
}
