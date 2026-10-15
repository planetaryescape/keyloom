// A function is what a binding ultimately produces, independent of where it sits (02#functions-and-reachability).
// The strings are canonical: modifiers in a fixed order, so two spellings of one function compare equal.
import type { Binding, HoldAction, Mod, TapAction } from "./schema.ts";

const MOD_ORDER: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];

const modsText = (mods: readonly Mod[]) => MOD_ORDER.filter((m) => mods.includes(m)).join("+");

const keyFunction = (a: TapAction) => `key:${a.code}${a.mods?.length ? `+${modsText(a.mods)}` : ""}`;

const holdFunction = (h: HoldAction) => ("layerId" in h ? `layer:momentary:${h.layerId}` : `mod:${modsText(h.mods)}`);

/** The functions a binding produces: none for transparent and none, two for a hold-tap (tap half, hold half). */
export function bindingFunctions(b: Binding): string[] {
  switch (b.kind) {
    case "key": return [keyFunction(b)];
    case "modifier": return [`mod:${modsText(b.mods)}`];
    case "holdTap": return [keyFunction(b.tap), holdFunction(b.hold)];
    case "layer": return [`layer:${b.action}:${b.layerId}`];
    case "macro": return [`macro:${b.macroId}`];
    case "native": return [`native:${b.firmware}:${b.source}`];
    case "transparent":
    case "none": return [];
  }
}

/** Functions joined for display, or the kind's name for a binding that produces none. */
export const describeBinding = (b: Binding): string => {
  const fns = bindingFunctions(b);
  return fns.length ? fns.join(" / ") : b.kind;
};
