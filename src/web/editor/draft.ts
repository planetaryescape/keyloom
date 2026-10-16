// The binding editor's working state. One Draft holds the parameters of every kind at once, so
// switching Key to Hold-tap and back keeps what was typed (keymap-editor issue #225, 09-web-editor).
// Pure, so the rules are tested without a browser.
import { macroWords } from "../card/card-words.ts";
import type { Binding, Layout, Macro, Mod, SlotAction, TapDance } from "../../layout/schema.ts";
import { modsWords } from "../../layout/describe.ts";
import { keyCodeLabel } from "../../layout/keycodes.ts";

export type LayerAction = Extract<Binding, { kind: "layer" }>["action"];
export type NativeBinding = Extract<Binding, { kind: "native" }>;
export type TapDanceBinding = Extract<Binding, { kind: "tapDance" }>;
export type KeyChoice = { code: string | null; mods: Mod[] };

export type Draft = {
  kind: Binding["kind"];
  key: KeyChoice;
  modifier: Mod[];
  tap: KeyChoice;
  holdType: "mods" | "layer";
  holdMods: Mod[];
  holdLayerId: string | null;
  profileId: string | null;
  layerAction: LayerAction;
  layerId: string | null;
  macroId: string | null;
  /** Kept so a native key can be left alone; keyloom can't build one. */
  native: NativeBinding | null;
  /** Kept so a tap dance whose slots the panel can't show (a toggle on the hold, say) is left alone, not rebuilt wrongly. */
  tapDance: TapDanceBinding | null;
  /** The slots that make a key a tap dance (16#tap-dance-is-a-key-with-a-double-tap-slot). Either one filled is a dance. */
  doubleTap: SlotAction | null;
  tapThenHold: SlotAction | null;
  /** The tap dance entry this key edits, or the id a new one will get. */
  danceId: string | null;
  /** The dance's own tapping term; null falls back to the firmware's. */
  danceTermMs: number | null;
  /** The dance is used by other keys: false changes a copy for this key only, true changes it for every key. */
  danceForAll: boolean;
  /** Macros made or edited in the picker, saved with the change. */
  pendingMacros: Macro[];
};

/** Either extra slot filled makes the key a tap dance. */
export const isDance = (draft: Draft): boolean => draft.doubleTap !== null || draft.tapThenHold !== null;

// Left side first, then right, the order the toggles are drawn in.
export const MOD_ORDER: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];

export function sortMods(mods: readonly Mod[]): Mod[] {
  return MOD_ORDER.filter((mod) => mods.includes(mod));
}

export function toggleMod(mods: readonly Mod[], mod: Mod): Mod[] {
  return sortMods(mods.includes(mod) ? mods.filter((m) => m !== mod) : [...mods, mod]);
}

const emptyChoice = (): KeyChoice => ({ code: null, mods: [] });

/** Starting state for editing `binding` on `currentLayerId`; kinds the binding doesn't use get sensible defaults. */
export function draftFromBinding(binding: Binding, layout: Layout, currentLayerId: string): Draft {
  const otherLayer = layout.layers.find((layer) => layer.id !== currentLayerId)?.id ?? null;
  const draft: Draft = {
    kind: binding.kind,
    key: emptyChoice(),
    modifier: [],
    tap: emptyChoice(),
    holdType: "mods",
    holdMods: [],
    holdLayerId: otherLayer,
    profileId: layout.holdTapProfiles[0]?.id ?? null,
    layerAction: "momentary",
    layerId: otherLayer,
    macroId: layout.macros[0]?.id ?? null,
    native: null,
    tapDance: null,
    doubleTap: null,
    tapThenHold: null,
    danceId: null,
    danceTermMs: null,
    danceForAll: false,
    pendingMacros: [],
  };
  switch (binding.kind) {
    case "key":
      draft.key = { code: binding.code, mods: sortMods(binding.mods ?? []) };
      draft.tap = { ...draft.key };
      break;
    case "modifier":
      draft.modifier = sortMods(binding.mods);
      draft.holdMods = [...draft.modifier];
      break;
    case "holdTap":
      draft.tap = { code: binding.tap.code, mods: sortMods(binding.tap.mods ?? []) };
      draft.key = { ...draft.tap };
      draft.profileId = binding.profileId;
      if ("mods" in binding.hold) {
        draft.holdType = "mods";
        draft.holdMods = sortMods(binding.hold.mods);
        draft.modifier = [...draft.holdMods];
      } else {
        draft.holdType = "layer";
        draft.holdLayerId = binding.hold.layerId;
      }
      break;
    case "layer":
      draft.layerAction = binding.action;
      draft.layerId = binding.layerId;
      break;
    case "macro":
      draft.macroId = binding.macroId;
      break;
    case "native":
      draft.native = binding;
      break;
    case "tapDance": {
      const entry = layout.tapDances.find((candidate) => candidate.id === binding.tapDanceId);
      const expanded = entry === undefined ? null : expandDance(draft, entry);
      if (expanded !== null) return expanded;
      draft.tapDance = binding;
      break;
    }
    case "transparent":
    case "none":
      break;
  }
  return draft;
}

/**
 * A tap dance as the panel's slots, or null when a slot holds something the panel can't show (a hold that
 * toggles a layer, a macro on the hold): that dance is left as it is rather than rebuilt without the part.
 */
function expandDance(base: Draft, td: TapDance): Draft | null {
  const next: Draft = { ...base, kind: "key", doubleTap: td.doubleTap ?? null, tapThenHold: td.tapThenHold ?? null, danceId: td.id, danceTermMs: td.termMs ?? null };
  switch (td.tap.kind) {
    case "key":
      next.key = { code: td.tap.code, mods: sortMods(td.tap.mods ?? []) };
      next.tap = { ...next.key };
      break;
    case "modifier":
      next.kind = "modifier";
      next.modifier = sortMods(td.tap.mods);
      break;
    case "layer":
      next.kind = "layer";
      next.layerAction = td.tap.action;
      next.layerId = td.tap.layerId;
      break;
    case "macro":
      next.kind = "macro";
      next.macroId = td.tap.macroId;
      break;
  }
  if (td.hold === undefined) return next;
  if (td.tap.kind !== "key") return null;
  if (td.hold.kind === "modifier") return { ...next, kind: "holdTap", holdType: "mods", holdMods: sortMods(td.hold.mods) };
  if (td.hold.kind === "layer" && td.hold.action === "momentary") return { ...next, kind: "holdTap", holdType: "layer", holdLayerId: td.hold.layerId };
  return null;
}

/** Changes kind and carries over what the two kinds share: the key, and the modifiers. */
export function switchKind(draft: Draft, kind: Binding["kind"]): Draft {
  if (kind === draft.kind) return draft;
  const next: Draft = { ...draft, kind };
  if (draft.kind === "key" && kind === "holdTap") {
    if (draft.key.code !== null) next.tap = { ...draft.key };
    if (draft.modifier.length > 0) next.holdMods = [...draft.modifier];
  } else if (draft.kind === "holdTap" && kind === "key") {
    if (draft.tap.code !== null) next.key = { ...draft.tap };
  } else if (draft.kind === "modifier" && kind === "holdTap") {
    next.holdMods = [...draft.modifier];
    next.holdType = "mods";
  } else if (draft.kind === "holdTap" && kind === "modifier") {
    if (draft.holdType === "mods") next.modifier = [...draft.holdMods];
  }
  return next;
}

/** Why the draft can't be turned into a binding yet, in words for the person; null when it can. */
export function incompleteReason(draft: Draft, layout: Layout): string | null {
  if (isDance(draft) && (draft.danceId === null || !["key", "holdTap", "modifier", "layer", "macro"].includes(draft.kind))) return "Pick what a tap does.";
  switch (draft.kind) {
    case "key":
      return draft.key.code === null ? "Pick a key." : null;
    case "modifier":
      return draft.modifier.length === 0 ? "Turn on at least one modifier." : null;
    case "holdTap":
      if (draft.tap.code === null) return "Pick the key to send on a tap.";
      if (draft.holdType === "mods" && draft.holdMods.length === 0) return "Turn on at least one modifier for the hold.";
      if (draft.holdType === "layer" && draft.holdLayerId === null) return "Pick the layer to hold.";
      // A tap dance times its hold itself, so it needs no hold-tap profile.
      if (draft.profileId === null && !isDance(draft)) {
        return layout.holdTapProfiles.length === 0
          ? "This layout has no hold-tap profile yet, so a hold-tap can't be made here."
          : "Pick a hold-tap profile.";
      }
      return null;
    case "layer":
      return draft.layerId === null ? "Pick a layer." : null;
    case "macro":
      return draft.macroId === null
        ? layout.macros.length === 0
          ? "This layout has no macros yet."
          : "Pick a macro."
        : null;
    case "native":
    case "tapDance":
    case "transparent":
    case "none":
      return null;
  }
}

const withMods = (choice: KeyChoice & { code: string }) =>
  choice.mods.length > 0 ? { code: choice.code, mods: sortMods(choice.mods) } : { code: choice.code };

/** The binding the draft stands for, or null while it is incomplete. */
export function bindingFromDraft(draft: Draft, layout: Layout): Binding | null {
  if (incompleteReason(draft, layout) !== null) return null;
  if (isDance(draft)) return { kind: "tapDance", tapDanceId: draft.danceId as string };
  switch (draft.kind) {
    case "key":
      return { kind: "key", ...withMods(draft.key as KeyChoice & { code: string }) };
    case "modifier":
      return { kind: "modifier", mods: sortMods(draft.modifier) };
    case "holdTap":
      return {
        kind: "holdTap",
        tap: withMods(draft.tap as KeyChoice & { code: string }),
        hold:
          draft.holdType === "mods"
            ? { mods: sortMods(draft.holdMods) }
            : { layerId: draft.holdLayerId as string },
        profileId: draft.profileId as string,
      };
    case "layer":
      return { kind: "layer", action: draft.layerAction, layerId: draft.layerId as string };
    case "macro":
      return { kind: "macro", macroId: draft.macroId as string };
    case "native":
      return draft.native;
    case "tapDance":
      return draft.tapDance;
    case "transparent":
      return { kind: "transparent" };
    case "none":
      return { kind: "none" };
  }
}

/** Mods sorted and empty lists dropped, so two spellings of one binding compare equal. */
export function normalise(binding: Binding): Binding {
  switch (binding.kind) {
    case "key":
      return { kind: "key", ...withMods({ code: binding.code, mods: binding.mods ?? [] }) };
    case "modifier":
      return { kind: "modifier", mods: sortMods(binding.mods) };
    case "holdTap":
      return {
        ...binding,
        tap: withMods({ code: binding.tap.code, mods: binding.tap.mods ?? [] }),
        hold: "mods" in binding.hold ? { mods: sortMods(binding.hold.mods) } : binding.hold,
      };
    default:
      return binding;
  }
}

export function sameBinding(a: Binding, b: Binding): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

const ACTION_WORD: Record<LayerAction, string> = {
  momentary: "Hold",
  toggle: "Toggle",
  to: "Go to",
  oneShot: "One-shot",
};

export function keyWords(code: string, mods: readonly Mod[] | undefined): string {
  const key = keyCodeLabel(code);
  return mods === undefined || mods.length === 0 ? key : `${modsWords(sortMods(mods))} + ${key}`;
}

/** A few words for the revision history: "F17", "Tap A, hold Left Ctrl", "Hold Symbols". */
export function bindingSummary(binding: Binding, layout: Layout): string {
  const layerName = (id: string) => layout.layers.find((layer) => layer.id === id)?.name ?? id;
  switch (binding.kind) {
    case "key":
      return keyWords(binding.code, binding.mods);
    case "modifier":
      return modsWords(sortMods(binding.mods));
    case "holdTap": {
      const hold = "mods" in binding.hold ? modsWords(sortMods(binding.hold.mods)) : layerName(binding.hold.layerId);
      return `Tap ${keyWords(binding.tap.code, binding.tap.mods)}, hold ${hold}`;
    }
    case "layer":
      return `${ACTION_WORD[binding.action]} ${layerName(binding.layerId)}`;
    case "macro":
      // An imported macro named only by its firmware slot says what it sends instead (D-270).
      return `Macro ${macroWords(layout.macros.find((macro) => macro.id === binding.macroId)).replace(/^A macro$/, binding.macroId)}`;
    case "tapDance": {
      const td = layout.tapDances.find((t) => t.id === binding.tapDanceId);
      return td ? `Tap dance ${td.name}` : "Tap dance";
    }
    case "native":
      return binding.label;
    case "transparent":
      return "Transparent";
    case "none":
      return "Nothing";
  }
}

/** "Base, key 7: F17". Key numbers count from 1, like the inspector. */
export function changeSummary(layout: Layout, layerId: string, position: number, binding: Binding): string {
  const layerName = layout.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
  return `${layerName}, key ${position + 1}: ${bindingSummary(binding, layout)}`;
}

/** The layout with one binding swapped, for describing a draft the same way an applied binding is. */
export function withBinding(layout: Layout, layerId: string, position: number, binding: Binding): Layout {
  return {
    ...layout,
    layers: layout.layers.map((layer) =>
      layer.id === layerId ? { ...layer, bindings: layer.bindings.map((b, i) => (i === position ? binding : b)) } : layer,
    ),
  };
}
