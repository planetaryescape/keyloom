// The key card's words (23#key-moments): what the key is, in a title a person would say, and what Apply will do, in one sentence.
// Pure, so the card and its tests agree.
import { keyCodeLabel } from "../../layout/keycodes.ts";
import { capMods, layerDisplayName } from "../../layout/cap-words.ts";
import { nativeLegend } from "../../layout/native-legend.ts";
import type { Binding, Layout, Macro, Mod, SlotAction } from "../../layout/schema.ts";

const MOD_WORD: Readonly<Record<string, string>> = { "⌃": "Control", "⌥": "Option", "⇧": "Shift", "⌘": "Command", "✦": "Hyper", "◆": "Meh" };

/** "Option", "Shift + Command", "Hyper": the side is left out, as on the cap (D-267). */
export function modWords(mods: readonly Mod[]): string {
  const marks = capMods(mods);
  if (marks === "✦" || marks === "◆") return MOD_WORD[marks] as string;
  return [...marks].map((mark) => MOD_WORD[mark] ?? mark).join(" + ");
}

/** "I", "Shift + 4", "Hyper + Space". */
// Labels from the key table that read oddly in a sentence.
const PLAIN: Readonly<Record<string, string>> = {
  SPACE: "Space",
  LEFT_GUI: "Command", RIGHT_GUI: "Command", LEFT_ALT: "Option", RIGHT_ALT: "Option",
  LEFT_CTRL: "Control", RIGHT_CTRL: "Control", LEFT_SHIFT: "Shift", RIGHT_SHIFT: "Shift",
};

export function keyPhrase(code: string, mods?: readonly Mod[]): string {
  const key = PLAIN[code] ?? keyCodeLabel(code);
  return mods === undefined || mods.length === 0 ? key : `${modWords(mods)} + ${key}`;
}

const layerName = (layout: Pick<Layout, "layers">, id: string): string => layerDisplayName(layout.layers.find((layer) => layer.id === id)?.name ?? id);

export function slotPhrase(action: SlotAction, layout: Pick<Layout, "layers" | "macros">): string {
  switch (action.kind) {
    case "key": return keyPhrase(action.code, action.mods);
    case "modifier": return modWords(action.mods);
    case "layer": return layerName(layout, action.layerId);
    case "macro": return macroWords(layout.macros.find((macro) => macro.id === action.macroId));
  }
}

const SLOT_MACRO = /^(?:ST_)?MACRO[\s_-]?\d+$/i;

/**
 * What a macro is called in words: its name, or, when the name is only its firmware slot (Oryx's ST_MACRO_1), what it sends:
 * "Command, then C". Waits are left out; they are in the card's step list.
 */
export function macroWords(macro: Pick<Macro, "name" | "steps"> | undefined): string {
  if (macro === undefined) return "A macro";
  if (!SLOT_MACRO.test(macro.name.trim())) return macro.name;
  const sends = macro.steps.flatMap((step) => (step.op === "tap" && step.code !== undefined ? [keyPhrase(step.code, step.mods)] : step.op === "text" ? [`“${step.text}”`] : []));
  return sends.length === 0 ? "A macro" : sends.join(", then ");
}

/** The card's title: what the key is, said plainly ("S, or hold for Option", "Go to Navigation"). */
export function cardTitle(binding: Binding, layout: Pick<Layout, "layers" | "macros" | "tapDances" | "passthrough">): string {
  switch (binding.kind) {
    case "key": return keyPhrase(binding.code, binding.mods);
    case "modifier": return modWords(binding.mods);
    case "holdTap": {
      const hold = "mods" in binding.hold ? modWords(binding.hold.mods) : layerName(layout, binding.hold.layerId);
      const tap = binding.tap.macroId ? (layout.macros.find((m) => m.id === binding.tap.macroId)?.name ?? binding.tap.macroId) : keyPhrase(binding.tap.code, binding.tap.mods);
      return `${tap}, or hold for ${hold}`;
    }
    case "layer": {
      const name = layerName(layout, binding.layerId);
      return { momentary: `Hold for ${name}`, toggle: `Toggle ${name}`, to: `Go to ${name}`, oneShot: `${name} for one key` }[binding.action];
    }
    case "macro":
      return macroWords(layout.macros.find((candidate) => candidate.id === binding.macroId));
    case "tapDance": {
      const dance = layout.tapDances.find((candidate) => candidate.id === binding.tapDanceId);
      if (dance === undefined) return "A tap dance";
      const twice = dance.doubleTap === undefined ? "" : `, twice for ${slotPhrase(dance.doubleTap, layout)}`;
      return `${slotPhrase(dance.tap, layout)}${twice}`;
    }
    case "native": {
      const print = nativeLegend(binding, layout);
      if (print.hold === undefined) return print.tap;
      // Only a layer is held; other front words name what kind of key it is ("lights", "mouse", "flash").
      if (print.hold === "once") return `${print.tap} for one key`;
      return print.layerId === undefined ? `${print.tap} (${print.hold})` : `${print.tap}, or hold for ${print.hold}`;
    }
    case "transparent": return "Falls through";
    case "none": return "Does nothing";
  }
}

/**
 * Apply's label: the change in words ("Hold I for Control", "Make it F17"), so the button says what it does (23#shared-patterns).
 * `before` is what the key is now.
 */
export function applyWords(before: Binding, after: Binding, layout: Pick<Layout, "layers" | "macros" | "tapDances" | "passthrough">): string {
  switch (after.kind) {
    case "holdTap": {
      const tap = keyPhrase(after.tap.code, after.tap.mods);
      const hold = "mods" in after.hold ? modWords(after.hold.mods) : layerName(layout, after.hold.layerId);
      const sameTap = before.kind === "holdTap" && JSON.stringify(before.tap) === JSON.stringify(after.tap);
      return sameTap || before.kind !== "holdTap" ? `Hold ${tap} for ${hold}` : `Tap for ${tap}, hold for ${hold}`;
    }
    case "key":
    case "modifier":
    case "macro":
      return `Make it ${cardTitle(after, layout)}`;
    case "layer":
      return cardTitle(after, layout);
    case "tapDance":
      return before.kind === "tapDance" ? "Save the tap dance" : "Make it a tap dance";
    case "transparent":
      return "Let it fall through";
    case "none":
      return "Make it do nothing";
    case "native":
      return "Apply";
  }
}

// What macOS does with a few shortcuts people put on keys, said on the card so ⇧⌘4 reads as more than symbols.
const MAC_MEANING: Readonly<Record<string, string>> = {
  "⇧⌘N3": "a screenshot of the screen",
  "⇧⌘N4": "a screenshot of an area",
  "⇧⌘N5": "the screenshot tools",
  "⌘C": "copy",
  "⌘V": "paste",
  "⌘X": "cut",
  "⌘Z": "undo",
  "⇧⌘Z": "redo",
  "⌘SPACE": "Spotlight",
  "⌘TAB": "switching apps",
  "⌘GRAVE": "switching windows",
};

/** "macOS reads ⇧⌘4 as a screenshot of an area.", or null when keyloom doesn't know what the shortcut means. */
export function macMeaning(code: string, mods: readonly Mod[] | undefined, printed: string): string | null {
  if (mods === undefined || mods.length === 0) return null;
  const meaning = MAC_MEANING[`${capMods(mods)}${code}`];
  return meaning === undefined ? null : `macOS reads ${printed} as ${meaning}.`;
}
