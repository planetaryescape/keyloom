// A QMK Configurator keymap.json (QMK's stock keymaps are often only this) read as the keymap.c `qmk json2c` would write, so its
// keycodes go through the same parser and mapping as a keymap.c's (D-352).
import { z } from "zod";
import { ImportError } from "./import-error.ts";

const KeymapJsonSchema = z.looseObject({
  layout: z.string().regex(/^LAYOUT\w*$/),
  layers: z.array(z.array(z.string())).min(1),
});

// The fields that describe or hold the keymap itself. Anything else (config, modules) is build input keyloom keeps as it was.
const KEYMAP_FIELDS = new Set(["keyboard", "keymap", "layout", "layers", "author", "notes", "version", "documentation"]);

/** True for a Configurator keymap.json, which carries `layers`; Oryx's keymap.json beside a keymap.c only lists modules. */
export function holdsLayers(json: string): boolean {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && "layers" in parsed;
  } catch {
    return false;
  }
}

/** The name a keymap.json gives itself, such as "default". */
export function keymapName(json: string): string | undefined {
  try {
    const name = (JSON.parse(json) as { keymap?: unknown }).keymap;
    return typeof name === "string" && name.trim() !== "" ? name : undefined;
  } catch {
    return undefined;
  }
}

// One keycode must be one C argument: balanced parentheses and no comma outside them, so a layer's key count can't change in the
// text and nothing ends the LAYOUT call early.
function oneArgument(keycode: string): boolean {
  if (!/^[A-Za-z0-9_(),|\s]+$/.test(keycode)) return false;
  let depth = 0;
  for (const c of keycode) {
    if (c === "(") depth++;
    else if (c === ")" && --depth < 0) return false;
    else if (c === "," && depth === 0) return false;
  }
  return depth === 0 && keycode.trim() !== "";
}

export function keymapJsonToC(json: string, file: string): { keymapC: string; rest: string | undefined } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ImportError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
  const result = KeymapJsonSchema.safeParse(parsed);
  if (!result.success) throw new ImportError(`${file} is not a QMK keymap.json: it needs "layout" (a LAYOUT name) and "layers" (lists of keycodes)`);
  const { layout, layers } = result.data;
  const layerSources = layers.map((keys, i) => {
    const bad = keys.findIndex((k) => !oneArgument(k));
    if (bad >= 0) throw new ImportError(`${file} layer ${i} key ${bad + 1} is "${keys[bad]}", which isn't a keycode keyloom can read`);
    return `    [${i}] = ${layout}(${keys.join(", ")})`;
  });
  const keymapC = `#include QMK_KEYBOARD_H\n\nconst uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {\n${layerSources.join(",\n")}\n};\n`;
  const extra = Object.fromEntries(Object.entries(result.data).filter(([key]) => !KEYMAP_FIELDS.has(key)));
  return { keymapC, rest: Object.keys(extra).length === 0 ? undefined : `${JSON.stringify(extra, null, 4)}\n` };
}
