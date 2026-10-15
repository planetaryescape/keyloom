// A function is what a binding ultimately produces, independent of where it sits (02#functions-and-reachability).
// The strings are canonical: modifiers in a fixed order, so two spellings of one function compare equal.
import type { Binding, HoldAction, Mod, SlotAction, TapAction, TapDance } from "./schema.ts";

const MOD_ORDER: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];

const modsText = (mods: readonly Mod[]) => MOD_ORDER.filter((m) => mods.includes(m)).join("+");

const keyFunction = (a: TapAction) => `key:${a.code}${a.mods?.length ? `+${modsText(a.mods)}` : ""}`;

/** The filled slots in the order a person thinks of them. */
export function tapDanceSlots(td: TapDance): Array<[TapDanceSlotName, SlotAction]> {
  const out: Array<[TapDanceSlotName, SlotAction]> = [["tap", td.tap]];
  if (td.hold) out.push(["hold", td.hold]);
  if (td.doubleTap) out.push(["doubleTap", td.doubleTap]);
  if (td.tapThenHold) out.push(["tapThenHold", td.tapThenHold]);
  return out;
}
export type TapDanceSlotName = "tap" | "hold" | "doubleTap" | "tapThenHold";

const holdFunction = (h: HoldAction) => ("layerId" in h ? `layer:momentary:${h.layerId}` : `mod:${modsText(h.mods)}`);

/** A slot of a tap dance produces what the same action would on a key of its own. */
export function slotFunction(a: SlotAction): string {
  switch (a.kind) {
    case "key": return keyFunction(a);
    case "modifier": return `mod:${modsText(a.mods)}`;
    case "layer": return `layer:${a.action}:${a.layerId}`;
    case "macro": return `macro:${a.macroId}`;
  }
}

/** The functions a binding produces: none for transparent and none, two for a hold-tap (tap half, hold half). */
export function bindingFunctions(b: Exclude<Binding, { kind: "tapDance" }>): string[];
// A tap dance's functions live in the layout's tapDances, so a caller holding any Binding has to pass them.
export function bindingFunctions(b: Binding, tapDances: readonly TapDance[]): string[];
export function bindingFunctions(b: Binding, tapDances: readonly TapDance[] = []): string[] {
  switch (b.kind) {
    case "key": return [keyFunction(b)];
    case "modifier": return [`mod:${modsText(b.mods)}`];
    case "holdTap": return [keyFunction(b.tap), holdFunction(b.hold)];
    case "layer": return [`layer:${b.action}:${b.layerId}`];
    case "macro": return [`macro:${b.macroId}`];
    // A tap dance whose id doesn't exist produces nothing; the validator reports the dangling reference.
    case "tapDance": {
      const td = tapDances.find((t) => t.id === b.tapDanceId);
      return td ? tapDanceSlots(td).map(([, a]) => slotFunction(a)) : [];
    }
    case "native": return [`native:${b.firmware}:${b.source}`];
    case "transparent":
    case "none": return [];
  }
}

/** Functions joined for display, or the kind's name for a binding that produces none. */
export const describeBinding = (b: Binding, tapDances: readonly TapDance[] = []): string => {
  const fns = bindingFunctions(b, tapDances);
  if (b.kind === "tapDance" && fns.length === 0) return `tap dance ${b.tapDanceId}`;
  return fns.length ? fns.join(" / ") : b.kind;
};
