// What a graphical keycap prints for a binding. Pure, so the browser viewer and anything else that
// draws keys share it. The names come from the same places the terminal grid uses (shortKeyLabel,
// modsText); this module only adds the two things a cap can do that a terminal cell can't: use
// symbols for the keys that have one, and split a binding into a tap legend and a hold legend.
import { type GridContext, modsText, shortKeyLabel } from "./render-grid.ts";
import type { Binding, Mod } from "./schema.ts";

export type Legend = {
  kind: Binding["kind"];
  /** The large legend. Empty for blank and transparent keys. */
  tap: string;
  /** The small legend under it: what holding does, or what a layer key does. */
  hold?: string;
};

// Only keys whose symbol is better known than their name. Everything else keeps the shared label.
const GLYPH: Readonly<Record<string, string>> = {
  ENTER: "⏎",
  BACKSPACE: "⌫",
  DELETE: "⌦",
  TAB: "⇥",
  SPACE: "Space",
  CAPS_LOCK: "⇪",
  LEFT: "←",
  RIGHT: "→",
  UP: "↑",
  DOWN: "↓",
};

const GLYPH_WITH_MODS: Readonly<Record<string, string>> = { ...GLYPH, SPACE: "SPC" };

const LAYER_ACTION_WORD = {
  momentary: "hold",
  toggle: "toggle",
  to: "go to",
  oneShot: "one-shot",
} as const satisfies Record<Extract<Binding, { kind: "layer" }>["action"], string>;

// "Space" is wide, so with modifiers in front (Hyp+Space) the shared short label takes over.
function capText(code: string, mods?: readonly Mod[]): string {
  const key =
    mods === undefined
      ? (GLYPH[code] ?? shortKeyLabel(code))
      : (GLYPH_WITH_MODS[code] ?? shortKeyLabel(code));
  return `${mods ? modsText(mods) : ""}${key}`;
}

/** "L2" for a layer still called "Layer 2", the name for any other; an unknown id is shown as is. */
export function layerLegend(layerId: string, ctx: GridContext): string {
  const index = ctx.layers.findIndex((layer) => layer.id === layerId);
  const layer = ctx.layers[index];
  if (layer === undefined) return layerId;
  return layer.name === `Layer ${index}` ? `L${index}` : layer.name;
}

export function bindingLegend(binding: Binding, ctx: GridContext): Legend {
  switch (binding.kind) {
    case "key":
      return { kind: "key", tap: capText(binding.code, binding.mods) };
    case "modifier":
      return { kind: "modifier", tap: modsText(binding.mods) };
    case "holdTap":
      return {
        kind: "holdTap",
        tap: capText(binding.tap.code, binding.tap.mods),
        hold: "mods" in binding.hold ? modsText(binding.hold.mods) : layerLegend(binding.hold.layerId, ctx),
      };
    case "layer":
      return {
        kind: "layer",
        tap: layerLegend(binding.layerId, ctx),
        hold: LAYER_ACTION_WORD[binding.action],
      };
    case "macro": {
      const index = ctx.macros.findIndex((macro) => macro.id === binding.macroId);
      return { kind: "macro", tap: index < 0 ? "M?" : `M${index}`, hold: "macro" };
    }
    case "native":
      return { kind: "native", tap: binding.label };
    case "transparent":
      return { kind: "transparent", tap: "" };
    case "none":
      return { kind: "none", tap: "" };
  }
}
