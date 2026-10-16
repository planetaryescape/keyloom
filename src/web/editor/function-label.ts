// The validator reports functions as canonical strings (key:LEFT+LCTL, layer:toggle:layer-4). People
// read the same legends the board shows, so this turns one into the other for the diff lines.
import { keyCodeLabel } from "../../layout/keycodes.ts";
import { modsText, tapText } from "../../layout/render-grid.ts";
import type { Layout, Mod } from "../../layout/schema.ts";
import { cardTitle, macroWords } from "../card/card-words.ts";

const LAYER_ACTION: Readonly<Record<string, string>> = { momentary: "Hold", toggle: "Toggle", to: "Go to", oneShot: "One-shot" };

export function functionLabel(fn: string, layout: Layout): string {
  const [kind, ...rest] = fn.split(":");
  const body = rest.join(":");
  switch (kind) {
    case "key": {
      const [code = body, ...mods] = body.split("+");
      return tapText(code, mods.length ? (mods as Mod[]) : undefined);
    }
    case "mod":
      return `Hold ${modsText(body.split("+") as Mod[])}`;
    case "layer": {
      const [action = "", layerId = ""] = rest;
      const name = layout.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
      return `${LAYER_ACTION[action] ?? action} ${name}`;
    }
    case "macro":
      return macroWords(layout.macros.find((macro) => macro.id === body));
    case "native": {
      // native:<firmware>:<source as written>, e.g. native:qmk:DUAL_FUNC_0. Said as the cap prints it, never as firmware (D-270).
      const [firmware = "", ...source] = rest;
      if (firmware !== "qmk" && firmware !== "zmk" && firmware !== "kanata") return "A custom key";
      const words = cardTitle({ kind: "native", firmware, source: source.join(":"), label: "" }, layout);
      return words === "Custom" ? "A custom key" : words;
    }
    default:
      return fn;
  }
}

/**
 * The same function in words, for a sentence or a chip ("Backspace stays where it is"), where the
 * keycap legend ("BSPC") would read as jargon. A key whose label is punctuation keeps its legend.
 */
export function functionName(fn: string, layout: Layout): string {
  const [kind, ...rest] = fn.split(":");
  if (kind !== "key") return functionLabel(fn, layout);
  const [code = "", ...mods] = rest.join(":").split("+");
  const label = keyCodeLabel(code);
  return `${mods.length ? modsText(mods as Mod[]) : ""}${/^[A-Za-z0-9]/.test(label) ? label : tapText(code)}`;
}
