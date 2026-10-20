// What a graphical keycap prints for a binding. Pure, so the browser viewer and anything else that
// draws keys share it. The names come from the same places the terminal grid uses (shortKeyLabel,
// modsText); this module only adds the two things a cap can do that a terminal cell can't: use
// symbols for the keys that have one, and split a binding into a tap legend and a hold legend.
import { type GridContext, shortKeyLabel } from "./render-grid.ts";
import type { Binding, MacroStep, Mod, SlotAction } from "./schema.ts";
import { nativeLegend } from "./native-legend.ts";
import { capMods, layerLegend } from "./cap-words.ts";

export { capMods, layerDisplayName, layerLegend } from "./cap-words.ts";

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

// Only keys whose symbol or short word is better known than their name. Everything else keeps the shared label. These are what a
// person reads on a real cap; the firmware's own spelling (BRID, PGDN, VOLU) is for Advanced view (D-270).
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
  PAGE_UP: "PgUp",
  PAGE_DOWN: "PgDn",
  APPLICATION: "Menu",
  PRINT_SCREEN: "PrtSc",
  INSERT: "Ins",
  BRIGHTNESS_DOWN: "Bri−",
  BRIGHTNESS_UP: "Bri+",
  AUDIO_MUTE: "Mute",
  AUDIO_VOL_DOWN: "Vol−",
  AUDIO_VOL_UP: "Vol+",
  MEDIA_PLAY_PAUSE: "Play",
  MEDIA_REWIND: "Rew",
  MEDIA_FAST_FORWARD: "Fwd",
  MEDIA_NEXT_TRACK: "Next",
  MEDIA_PREV_TRACK: "Prev",
  MEDIA_STOP: "Stop",
  // A modifier on a key of its own prints its symbol, the way a Mac keycap does, instead of a firmware-ish LSFT (D-267).
  LEFT_SHIFT: "⇧",
  RIGHT_SHIFT: "⇧",
  LEFT_CTRL: "⌃",
  RIGHT_CTRL: "⌃",
  LEFT_ALT: "⌥",
  RIGHT_ALT: "⌥",
  LEFT_GUI: "⌘",
  RIGHT_GUI: "⌘",
};

// The open-box mark for Space, so Hyper+Space is "✦␣" and not a six-letter legend that has to shrink or wrap.
const GLYPH_WITH_MODS: Readonly<Record<string, string>> = { ...GLYPH, SPACE: "␣" };

// What a shifted key types on a US layout: a cap prints "!" for Shift+1, as the key would.
const SHIFTED: Readonly<Record<string, string>> = {
  N1: "!", N2: "@", N3: "#", N4: "$", N5: "%", N6: "^", N7: "&", N8: "*", N9: "(", N0: ")",
  GRAVE: "~", MINUS: "_", EQUAL: "+", LEFT_BRACKET: "{", RIGHT_BRACKET: "}", BACKSLASH: "|",
  SEMICOLON: ":", QUOTE: '"', COMMA: "<", DOT: ">", SLASH: "?",
};

// One word each, printed on the front skirt in the condensed width (D-270).
const LAYER_ACTION_WORD = {
  momentary: "hold",
  toggle: "toggle",
  to: "go to",
  oneShot: "once",
} as const satisfies Record<Extract<Binding, { kind: "layer" }>["action"], string>;

function capText(code: string, mods?: readonly Mod[]): string {
  if (mods === undefined || mods.length === 0) return GLYPH[code] ?? shortKeyLabel(code);
  const shifted = SHIFTED[code];
  if (shifted !== undefined && mods.every((mod) => mod === "LSFT" || mod === "RSFT")) return shifted;
  return `${capMods(mods)}${GLYPH_WITH_MODS[code] ?? shortKeyLabel(code)}`;
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

/** What one tap dance slot prints in a corner of its cap: the same short forms the main legend uses. */
function slotCap(a: SlotAction, ctx: GridContext): string {
  switch (a.kind) {
    case "key": return capText(a.code, a.mods);
    case "modifier": return capMods(a.mods);
    case "layer": return layerLegend(a.layerId, ctx);
    case "macro": {
      const index = ctx.macros.findIndex((macro) => macro.id === a.macroId);
      return macroLegend(index, ctx.macros[index]?.name, ctx.macros[index]?.steps);
    }
  }
}

// An imported macro is named after its firmware slot (ST_MACRO_2), which says nothing a cap can use.
const SLOT_NAME = /^(?:ST_)?MACRO[\s_-]?\d+$|^M\d+$/i;

/**
 * What a macro's cap prints: the first word of its name, such as "Copy" for "Copy, switch, paste". A word longer than five letters is
 * cut to four so it fits at the legend floor. An imported macro named after its firmware slot (ST_MACRO_2) prints what it sends
 * instead: its one key, or its first key and an ellipsis (D-270). With neither, it says "Macro". The whole name stays in the panel.
 */
export function macroLegend(index: number, name: string | undefined, steps?: readonly MacroStep[]): string {
  if (index < 0) return "Macro";
  const first = name?.trim().split(/[\s,;:._-]+/).find((word) => word !== "");
  if (first !== undefined && !SLOT_NAME.test(name?.trim() ?? "")) return first.length <= 5 ? first : first.slice(0, 4);
  const sent = (steps ?? []).flatMap((step) => (step.op === "tap" && step.code !== undefined ? [capText(step.code, step.mods)] : step.op === "text" ? [`“${step.text.slice(0, 3)}`] : []));
  if (sent.length === 0) return "Macro";
  return sent.length === 1 ? (sent[0] as string) : `${sent[0]}…`;
}

export function bindingLegend(binding: Binding, ctx: GridContext): Legend {
  switch (binding.kind) {
    case "key":
      return { kind: "key", tap: capText(binding.code, binding.mods) };
    case "modifier":
      return { kind: "modifier", tap: capMods(binding.mods) };
    case "holdTap":
      return {
        kind: "holdTap",
        tap: binding.tap.macroId ? (ctx.macros.find((m) => m.id === binding.tap.macroId)?.name ?? "M") : capText(binding.tap.code, binding.tap.mods),
        hold: "mods" in binding.hold ? capMods(binding.hold.mods) : layerLegend(binding.hold.layerId, ctx),
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
      return { kind: "macro", tap: macroLegend(index, ctx.macros[index]?.name, ctx.macros[index]?.steps) };
    }
    case "native": {
      const print = nativeLegend(binding, ctx);
      return { kind: "native", tap: print.tap, ...(print.hold === undefined ? {} : { hold: print.hold }) };
    }
    case "tapDance": {
      const td = ctx.tapDances?.find((t) => t.id === binding.tapDanceId);
      if (!td) return { kind: "tapDance", tap: "Dance" };
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
