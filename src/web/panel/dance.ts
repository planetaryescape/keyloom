// A key's slots as a tap dance (16#tap-dance-is-a-key-with-a-double-tap-slot, D-086): filling "When
// double-tapped" or "When tapped, then held" makes the key a dance, and clearing both turns it back
// into the plain or hold-tap key it was. Pure, so the mapping from slots to a TapDance is tested
// without a browser.
import { tapDanceSlots } from "../../layout/functions.ts";
import type { Layout, Mod, SlotAction, TapDance } from "../../layout/schema.ts";
import { type Draft, isDance, keyWords, sortMods, toggleMod } from "../editor/draft.ts";
import { modOfKey, type TapPick } from "./slots.ts";
import { modsWords } from "../../layout/describe.ts";

export type ExtraSlot = "doubleTap" | "tapThenHold";

/** What the tap slot of a draft does, as a slot action; null while it holds nothing a dance can run (a blank key, a native one). */
export function tapSlotAction(draft: Draft): SlotAction | null {
  switch (draft.kind) {
    case "key":
      return draft.key.code === null ? null : { kind: "key", code: draft.key.code, ...(draft.key.mods.length ? { mods: sortMods(draft.key.mods) } : {}) };
    case "holdTap":
      return draft.tap.code === null ? null : { kind: "key", code: draft.tap.code, ...(draft.tap.mods.length ? { mods: sortMods(draft.tap.mods) } : {}) };
    case "modifier":
      return draft.modifier.length === 0 ? null : { kind: "modifier", mods: sortMods(draft.modifier) };
    case "layer":
      return draft.layerId === null ? null : { kind: "layer", action: draft.layerAction, layerId: draft.layerId };
    case "macro":
      return draft.macroId === null ? null : { kind: "macro", macroId: draft.macroId };
    default:
      return null;
  }
}

/** The hold slot, which is a modifier or a momentary layer (the two holds the panel offers). */
export function holdSlotAction(draft: Draft): SlotAction | undefined {
  if (draft.kind !== "holdTap") return undefined;
  if (draft.holdType === "layer") return draft.holdLayerId === null ? undefined : { kind: "layer", action: "momentary", layerId: draft.holdLayerId };
  return draft.holdMods.length === 0 ? undefined : { kind: "modifier", mods: sortMods(draft.holdMods) };
}

/** A slot action a picker choice stands for; a blank or transparent choice isn't one. */
export function slotFromPick(pick: TapPick): SlotAction | null {
  switch (pick.t) {
    case "key": {
      const mod = modOfKey(pick.code);
      return mod === undefined ? { kind: "key", code: pick.code } : { kind: "modifier", mods: [mod] };
    }
    case "layer":
      return { kind: "layer", action: pick.action, layerId: pick.layerId };
    case "macro":
      return { kind: "macro", macroId: pick.macroId };
    default:
      return null;
  }
}

/** The modifiers the toggles under a slot show. */
export function slotMods(action: SlotAction): Mod[] {
  return action.kind === "key" ? sortMods(action.mods ?? []) : action.kind === "modifier" ? sortMods(action.mods) : [];
}

/** Whether modifier toggles mean anything for the slot: a key to send with them, or a modifier to extend. */
export const canToggleSlotMods = (action: SlotAction): boolean => action.kind === "key" || action.kind === "modifier";

export function toggleSlotMod(action: SlotAction, mod: Mod): SlotAction {
  if (action.kind === "key") {
    const mods = toggleMod(action.mods ?? [], mod);
    return { kind: "key", code: action.code, ...(mods.length ? { mods } : {}) };
  }
  if (action.kind === "modifier") {
    const mods = toggleMod(action.mods, mod);
    // Switching the last modifier off leaves nothing to send, so the slot keeps it on rather than going empty.
    return mods.length === 0 ? action : { kind: "modifier", mods };
  }
  return action;
}

const taken = (layout: Layout, id: string) => layout.tapDances.some((t) => t.id === id);

/** A fresh id for a new dance: `td-<layer>-<key>`, with a number added if that is taken. */
export function newDanceId(layout: Layout, layerId: string, position: number): string {
  const base = `td-${layerId}-${position + 1}`;
  if (!taken(layout, base)) return base;
  let n = 2;
  while (taken(layout, `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Fills one of the extra slots; the first fill makes the key a tap dance. */
export function setExtraSlot(draft: Draft, which: ExtraSlot, action: SlotAction, layout: Layout, at: { layerId: string; position: number }): Draft {
  if (tapSlotAction(draft) === null) return draft;
  return { ...draft, [which]: action, danceId: draft.danceId ?? newDanceId(layout, at.layerId, at.position) };
}

/** Empties one of the extra slots. With both empty the key is a plain or hold-tap key again; its tap and hold are as they were. */
export function clearExtraSlot(draft: Draft, which: ExtraSlot): Draft {
  return { ...draft, [which]: null };
}

/** Whether the tap slot can start a dance: it holds a key, modifier, layer or macro. */
export const canAddExtraSlot = (draft: Draft): boolean => tapSlotAction(draft) !== null;

export function slotWords(action: SlotAction, layout: Layout): string {
  switch (action.kind) {
    case "key": return keyWords(action.code, action.mods);
    case "modifier": return modsWords(sortMods(action.mods));
    case "layer": return layout.layers.find((layer) => layer.id === action.layerId)?.name ?? "a layer";
    case "macro": return layout.macros.find((macro) => macro.id === action.macroId)?.name ?? "a macro";
  }
}

/** "Esc, Caps Lock on double-tap": the name a new dance gets, from what its slots do. */
export function danceName(td: Pick<TapDance, "tap" | "hold" | "doubleTap" | "tapThenHold">, layout: Layout): string {
  const parts = [
    slotWords(td.tap, layout),
    ...(td.hold ? [`${slotWords(td.hold, layout)} on hold`] : []),
    ...(td.doubleTap ? [`${slotWords(td.doubleTap, layout)} on double-tap`] : []),
    ...(td.tapThenHold ? [`${slotWords(td.tapThenHold, layout)} on tap, then hold`] : []),
  ];
  return parts.join(", ");
}

/** The entry a draft stands for, or null when it isn't a dance or a slot is incomplete. */
export function danceFromDraft(draft: Draft, layout: Layout, id: string = draft.danceId ?? ""): TapDance | null {
  if (!isDance(draft) || id === "") return null;
  const tap = tapSlotAction(draft);
  if (tap === null) return null;
  const hold = holdSlotAction(draft);
  if (draft.kind === "holdTap" && hold === undefined) return null;
  const parts = { tap, ...(hold ? { hold } : {}), ...(draft.doubleTap ? { doubleTap: draft.doubleTap } : {}), ...(draft.tapThenHold ? { tapThenHold: draft.tapThenHold } : {}) };
  // The name follows the slots until the person has named it; an existing entry keeps its own.
  const existing = layout.tapDances.find((candidate) => candidate.id === id);
  const sameSlots = existing !== undefined && JSON.stringify(tapDanceSlots(existing)) === JSON.stringify(tapDanceSlots({ ...existing, ...parts, hold: parts.hold, doubleTap: parts.doubleTap, tapThenHold: parts.tapThenHold }));
  return {
    id,
    name: sameSlots ? existing.name : danceName(parts, layout),
    ...parts,
    ...(draft.danceTermMs === null ? {} : { termMs: draft.danceTermMs }),
  };
}

const sameSlot = (a: { layerId: string; position: number }, b: { layerId: string; position: number }) => a.layerId === b.layerId && a.position === b.position;

/** The keys, other than `except`, whose binding is this tap dance. */
export function danceUsers(layout: Layout, id: string, except?: { layerId: string; position: number }): Array<{ layerId: string; position: number }> {
  return layout.layers.flatMap((layer) =>
    layer.bindings.flatMap((binding, position) => {
      const at = { layerId: layer.id, position };
      return binding.kind === "tapDance" && binding.tapDanceId === id && !(except !== undefined && sameSlot(at, except)) ? [at] : [];
    }),
  );
}
