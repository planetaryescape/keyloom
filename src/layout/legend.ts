// What a graphical keycap prints for a binding. Pure, so the browser viewer and anything else that
// draws keys share it. The names come from the same places the terminal grid uses (shortKeyLabel,
// modsText); this module only adds the two things a cap can do that a terminal cell can't: use
// symbols for the keys that have one, and split a binding into a tap legend and a hold legend.
import { type GridContext, modsText, shortKeyLabel } from "./render-grid.ts";
import type { Binding, Mod, SlotAction } from "./schema.ts";

export type Legend = {
  kind: Binding["kind"];
  /** The large legend. Empty for blank and transparent keys. */
  tap: string;
  /** The small legend under it: what holding does, or what a layer key does. */
  hold?: string;
  /** A tap dance's double-tap, bottom-right; the cap draws the ⇈ mark before it (18#a-keycap-shows-every-slot-it-has). */
  double?: string;
  /** A tap dance with a tapped-then-held slot: the cap draws a cluster of dots. */
  tapHold?: true;
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

// The open-box mark for Space, so Hyper+Space is "Hyp␣" and not a six-letter legend that has to shrink or wrap.
const GLYPH_WITH_MODS: Readonly<Record<string, string>> = { ...GLYPH, SPACE: "␣" };

// Native labels the importers made that are longer than a keycap holds at the legend floor. Short labels
// come from a table, never from shrinking the type (18#legends).
const NATIVE_SHORT: Readonly<Record<string, string>> = { LyrCol: "LyrC" };

function shortNative(label: string): string {
  const button = /^MSBTN(\d)$/.exec(label);
  return button ? `Btn${button[1]}` : (NATIVE_SHORT[label] ?? label);
}

// One word each, so the action fits under a layer's short label at the legend floor (18#legends).
const LAYER_ACTION_WORD = {
  momentary: "hold",
  // "toggle" is six letters and broke mid-word on a phone cap; "tog" fits at the legend floor (D-187).
  toggle: "tog",
  to: "go",
  oneShot: "once",
} as const satisfies Record<Extract<Binding, { kind: "layer" }>["action"], string>;

// "Space" is wide, so with modifiers in front (Hyp+Space) the shared short label takes over.
function capText(code: string, mods?: readonly Mod[]): string {
  const key =
    mods === undefined
      ? (GLYPH[code] ?? shortKeyLabel(code))
      : (GLYPH_WITH_MODS[code] ?? shortKeyLabel(code));
  return `${mods ? modsText(mods) : ""}${key}`;
}

// Up to four letters: initials of a name with several words ("Left Hand" is LH), a short word as it
// is, and the first three letters of a long one ("Navigate" is NAV).
export function defaultShortLabel(name: string): string {
  const numbered = /^layer\s+(\d+)$/i.exec(name.trim());
  if (numbered) return `L${numbered[1]}`;
  const words = name.trim().split(/[\s_-]+/).filter((word) => word !== "");
  const first = words[0];
  if (first === undefined) return "?";
  if (words.length > 1) return words.map((word) => word.charAt(0)).join("").slice(0, 4).toUpperCase();
  return (first.length <= 4 ? first : first.slice(0, 3)).toUpperCase();
}

/**
 * The short label a layer's key prints: never the whole name. Two layers that would print the same
 * letters get four letters, and a pair that still match fall back to their positions ("L2", "L5").
 */
export function layerLegend(layerId: string, ctx: GridContext): string {
  const index = ctx.layers.findIndex((layer) => layer.id === layerId);
  const layer = ctx.layers[index];
  if (layer === undefined) return layerId;
  // A label the person chose is printed as it is, even when two layers share it.
  if (layer.shortLabel !== undefined) return layer.shortLabel;
  const label = defaultShortLabel(layer.name);
  const clash = (other: string) => ctx.layers.some((candidate) => candidate.id !== layer.id && defaultShortLabel(candidate.name) === other);
  if (!clash(label)) return label;
  const longer = layer.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase();
  const longerClash = ctx.layers.some((candidate) => candidate.id !== layer.id && candidate.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() === longer);
  return longerClash ? `L${index}` : longer;
}

/** What one tap dance slot prints in a corner of its cap: the same short forms the main legend uses. */
function slotCap(a: SlotAction, ctx: GridContext): string {
  switch (a.kind) {
    case "key": return capText(a.code, a.mods);
    case "modifier": return modsText(a.mods);
    case "layer": return layerLegend(a.layerId, ctx);
    case "macro": {
      const index = ctx.macros.findIndex((macro) => macro.id === a.macroId);
      return index < 0 ? "M?" : `M${index}`;
    }
  }
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
      // The play mark on the cap says it is a macro, so no second word competes for the width.
      return { kind: "macro", tap: index < 0 ? "M?" : `M${index}` };
    }
    case "native": {
      // A kept hold-tap is labelled "tap/hold" ("Enter/OSL2"); two short halves fit a cap where the whole would not.
      const [tap, hold, ...more] = binding.label.split("/");
      if (binding.label.length > 5 && tap !== undefined && tap !== "" && hold !== undefined && hold !== "" && more.length === 0) return { kind: "native", tap, hold };
      return { kind: "native", tap: shortNative(binding.label) };
    }
    case "tapDance": {
      const td = ctx.tapDances?.find((t) => t.id === binding.tapDanceId);
      if (!td) return { kind: "tapDance", tap: "TD?" };
      return {
        kind: "tapDance",
        tap: slotCap(td.tap, ctx),
        ...(td.hold ? { hold: slotCap(td.hold, ctx) } : {}),
        ...(td.doubleTap ? { double: slotCap(td.doubleTap, ctx) } : {}),
        ...(td.tapThenHold ? { tapHold: true as const } : {}),
      };
    }
    case "transparent":
      return { kind: "transparent", tap: "" };
    case "none":
      return { kind: "none", tap: "" };
  }
}
