// The key panel's slots on top of the editor's Draft (16#the-key-panel). The person fills slots
// ("When tapped", "When held") and the kind follows from which are filled (D-086), so nothing
// here asks for a kind. Pure, so the rules are tested without a browser.
import { KEYCODES, type KeyCodeInfo } from "../../layout/keycodes.ts";
import type { HoldTapProfile, Layout, Mod } from "../../layout/schema.ts";
import { sortMods, switchKind, toggleMod, type Draft, type LayerAction } from "../editor/draft.ts";

const MOD_OF_KEY: Readonly<Record<string, Mod>> = {
  LEFT_CTRL: "LCTL",
  LEFT_SHIFT: "LSFT",
  LEFT_ALT: "LALT",
  LEFT_GUI: "LGUI",
  RIGHT_CTRL: "RCTL",
  RIGHT_SHIFT: "RSFT",
  RIGHT_ALT: "RALT",
  RIGHT_GUI: "RGUI",
};

/** The modifier a modifier key (Left Control) stands for; undefined for any other key. */
export const modOfKey = (code: string): Mod | undefined => (Object.hasOwn(MOD_OF_KEY, code) ? MOD_OF_KEY[code] : undefined);

/** What a person can put in the tap slot. */
export type TapPick =
  | { t: "key"; code: string }
  | { t: "layer"; action: LayerAction; layerId: string }
  | { t: "macro"; macroId: string }
  | { t: "transparent" }
  | { t: "none" };

/** What a person can put in the hold slot: modifiers or a layer, the two holds the model has. */
export type HoldPick = { t: "mods"; mods: Mod[] } | { t: "layer"; layerId: string };

export type TapKind = "key" | "modifier" | "layer" | "macro" | "tapDance" | "transparent" | "none" | "native";

/** The hold slot is filled once the draft is a hold-tap. */
export const hasHold = (draft: Draft): boolean => draft.kind === "holdTap";

/** What the tap slot holds. For a hold-tap that is always a key. */
export const tapKind = (draft: Draft): TapKind => (draft.kind === "holdTap" ? "key" : draft.kind);

/** The key the tap slot sends, with its modifiers; null when the slot holds something that is not a key. */
export function tapKey(draft: Draft): { code: string | null; mods: Mod[] } | null {
  if (draft.kind === "holdTap") return draft.tap;
  if (draft.kind === "key") return draft.key;
  return null;
}

/** The modifiers the toggles under the tap slot show. */
export function tapMods(draft: Draft): Mod[] {
  if (draft.kind === "modifier") return draft.modifier;
  return tapKey(draft)?.mods ?? [];
}

/** Whether the toggles under the tap slot mean anything: a key to send with them, or a modifier to extend. */
export const canToggleTapMods = (draft: Draft): boolean =>
  draft.kind === "modifier" || ((draft.kind === "key" || draft.kind === "holdTap") && tapKey(draft)?.code != null);

export function toggleTapMod(draft: Draft, mod: Mod): Draft {
  if (draft.kind === "modifier") return { ...draft, modifier: toggleMod(draft.modifier, mod) };
  if (draft.kind === "holdTap") return { ...draft, tap: { ...draft.tap, mods: toggleMod(draft.tap.mods, mod) } };
  if (draft.kind === "key") {
    const key = { ...draft.key, mods: toggleMod(draft.key.mods, mod) };
    return { ...draft, key, tap: { ...key } };
  }
  return draft;
}

/** Fills the tap slot. Under a hold, only keys fit: a hold-tap taps a key. */
export function pickTap(draft: Draft, pick: TapPick): Draft {
  if (draft.kind === "holdTap") {
    return pick.t === "key" ? { ...draft, tap: { code: pick.code, mods: draft.tap.mods }, key: { code: pick.code, mods: draft.tap.mods } } : draft;
  }
  switch (pick.t) {
    case "key": {
      const mod = modOfKey(pick.code);
      // A lone modifier key is a `modifier` binding, the way both importers read one.
      if (mod !== undefined) return { ...draft, kind: "modifier", modifier: [mod] };
      // Modifiers already on the slot go with the new key: Ctrl, then A, is Ctrl+A.
      const mods = draft.kind === "modifier" ? draft.modifier : draft.kind === "key" ? draft.key.mods : [];
      const key = { code: pick.code, mods: sortMods(mods) };
      return { ...draft, kind: "key", key, tap: { ...key } };
    }
    case "layer":
      return { ...draft, kind: "layer", layerAction: pick.action, layerId: pick.layerId };
    case "macro":
      return { ...draft, kind: "macro", macroId: pick.macroId };
    case "transparent":
      return { ...draft, kind: "transparent" };
    case "none":
      return { ...draft, kind: "none" };
  }
}

/** A hold fits a key, or a lone modifier key (which the hold-tap then taps). */
export const canAddHold = (draft: Draft): boolean =>
  (draft.kind === "key" && draft.key.code !== null) || (draft.kind === "modifier" && draft.modifier.length === 1);

const MODIFIER_KEY_OF: Readonly<Record<Mod, string>> = {
  LCTL: "LEFT_CTRL",
  LSFT: "LEFT_SHIFT",
  LALT: "LEFT_ALT",
  LGUI: "LEFT_GUI",
  RCTL: "RIGHT_CTRL",
  RSFT: "RIGHT_SHIFT",
  RALT: "RIGHT_ALT",
  RGUI: "RIGHT_GUI",
};

/** Opens the hold slot: the tap stays as it is and the hold waits to be picked (16: adding a hold to A keeps A). */
export function addHold(draft: Draft, profileId: string | null): Draft {
  if (!canAddHold(draft)) return draft;
  const tap = draft.kind === "modifier" ? { code: MODIFIER_KEY_OF[draft.modifier[0] as Mod], mods: [] } : { ...draft.key };
  return { ...switchKind({ ...draft, key: tap }, "holdTap"), tap, holdType: "mods", holdMods: [], profileId };
}

export function pickHold(draft: Draft, pick: HoldPick): Draft {
  if (draft.kind !== "holdTap") return draft;
  return pick.t === "mods"
    ? { ...draft, holdType: "mods", holdMods: sortMods(pick.mods) }
    : { ...draft, holdType: "layer", holdLayerId: pick.layerId };
}

export function toggleHoldMod(draft: Draft, mod: Mod): Draft {
  return draft.kind === "holdTap" ? { ...draft, holdType: "mods", holdMods: toggleMod(draft.holdMods, mod) } : draft;
}

/** Empties the hold slot; the tap goes back to being a plain key. */
export function clearHold(draft: Draft): Draft {
  if (draft.kind !== "holdTap") return draft;
  return { ...switchKind(draft, "key"), holdMods: [], holdType: "mods" };
}

/**
 * The profile a new hold-tap should get: the one the layout made for what this hold is (home-row
 * mods on the home row, layer-tap for a layer hold), else the first. Matched on the id and name,
 * since ids differ by firmware (`home-row-mods`, `hm`).
 */
export function profileFor(layout: Layout, hold: "mods" | "layer", homeRow: boolean): string | null {
  const profiles = layout.holdTapProfiles;
  const text = (profile: HoldTapProfile) => `${profile.id} ${profile.name}`.toLowerCase();
  const matches = (pattern: RegExp) => profiles.find((profile) => pattern.test(text(profile)));
  const wanted =
    hold === "layer"
      ? matches(/layer|\blt\b/)
      : (homeRow ? matches(/home|\bhm\b|hrm/) : undefined) ?? matches(/mod[- ]?tap|\bmt\b/);
  return (wanted ?? profiles[0])?.id ?? null;
}

const CHAR_KEYS: readonly KeyCodeInfo[] = KEYCODES.filter((key) => key.category === "letter" || key.category === "number" || key.category === "punctuation");

/** The key a typed character stands for ("a", "7", ";"), so typing fills the tap slot. */
export function keyForChar(char: string): KeyCodeInfo | undefined {
  if (char === " ") return KEYCODES.find((key) => key.name === "SPACE");
  if (char.length !== 1) return undefined;
  const wanted = char.toLowerCase();
  return CHAR_KEYS.find((key) => key.label.toLowerCase() === wanted);
}
