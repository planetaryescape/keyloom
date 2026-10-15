// Oryx's own decoding of BK's layout (oryx-graphql.json) as an independent oracle: Oryx, not
// keyloom, decided what each key's tap and hold are. Descriptors are compared as strings.
import { fromQmk, fromQmkShifted } from "../../src/layout/keycodes.ts";
import type { Binding, Layout, Mod } from "../../src/layout/schema.ts";

type OryxAction = {
  code: string;
  layer: number | null;
  modifier: string | null;
  modifiers: Record<string, boolean> | null;
  macro: { keys: Array<{ code: string; modifiers: Record<string, boolean> | null }> } | null;
} | null;

export type OryxKey = { tap: OryxAction; hold: OryxAction; doubleTap: OryxAction; tapHold: OryxAction };
export type OryxLayer = { title: string; position: number; keys: OryxKey[] };

export async function loadOracle(): Promise<OryxLayer[]> {
  const file = Bun.file(`${import.meta.dir}/../fixtures/oryx/synchronized/oryx-graphql.json`);
  return (await file.json()).data.layout.revision.layers;
}

const ORYX_MODS: Array<[string, Mod]> = [
  ["leftCtrl", "LCTL"], ["leftShift", "LSFT"], ["leftAlt", "LALT"], ["leftGui", "LGUI"],
  ["rightCtrl", "RCTL"], ["rightShift", "RSFT"], ["rightAlt", "RALT"], ["rightGui", "RGUI"],
];
const modsOf = (m: Record<string, boolean> | null): Mod[] => ORYX_MODS.filter(([k]) => m?.[k]).map(([, v]) => v);

const MODIFIER_KEYS = new Map<string, Mod>([
  ["KC_LEFT_CTRL", "LCTL"], ["KC_LEFT_SHIFT", "LSFT"], ["KC_LEFT_ALT", "LALT"], ["KC_LEFT_GUI", "LGUI"],
  ["KC_RIGHT_CTRL", "RCTL"], ["KC_RIGHT_SHIFT", "RSFT"], ["KC_RIGHT_ALT", "RALT"], ["KC_RIGHT_GUI", "RGUI"],
]);
const HYPER: Mod[] = ["LCTL", "LSFT", "LALT", "LGUI"];
export const LAYER_ACTIONS = new Map([["MO", "momentary"], ["TG", "toggle"], ["TO", "to"], ["OSL", "oneShot"]]);

const modsText = (m: Mod[]) => m.join("+");

/** A key that is a plain keycode, possibly with modifiers or a shifted alias. */
function keyText(code: string, mods: Mod[]): string | undefined {
  const info = fromQmk(code);
  if (info) return `${info.name}${mods.length ? `+${modsText(mods)}` : ""}`;
  const shifted = fromQmkShifted(code);
  if (shifted) return `${shifted.code}+${modsText([...mods, "LSFT"])}`;
  return undefined;
}

/** What Oryx says a key does, in the same notation as `irDescriptor`. */
export function oracleDescriptor(k: OryxKey): string {
  const { tap, hold } = k;
  if (k.doubleTap || k.tapHold) return "native";
  if (tap?.macro) {
    const first = tap.macro.keys[0];
    return `macro:${first ? keyText(first.code, modsOf(first.modifiers)) : "?"}`;
  }
  if (tap?.code === "OSM") return "native";
  if (tap && LAYER_ACTIONS.has(tap.code) && tap.layer != null) return `layer:${LAYER_ACTIONS.get(tap.code)}:${tap.layer}`;
  if (tap && hold) {
    const tapText = keyText(tap.code, []);
    if (!tapText) return "native";
    if (hold.code === "ALL_T") return `holdTap:${tapText}/mods:${modsText(HYPER)}`;
    const mod = MODIFIER_KEYS.get(hold.code);
    if (mod) return `holdTap:${tapText}/mods:${mod}`;
    if (hold.code === "MO" && hold.layer != null) return `holdTap:${tapText}/layer:${hold.layer}`;
    return "native";
  }
  // Oryx files a lone key on whichever side it was entered: a plain MO(3) or Left Alt sits on "hold".
  const only = tap ?? hold;
  if (!only) return "transparent"; // Oryx leaves a transparent key empty
  if (!tap && LAYER_ACTIONS.has(only.code) && only.layer != null) return `layer:${LAYER_ACTIONS.get(only.code)}:${only.layer}`;
  if (only.code === "KC_TRANSPARENT") return "transparent";
  if (only.code === "KC_NO") return "none";
  // Oryx files a lone Hyper or Meh key as ALL_T / MEH_T with no tap.
  if (only.code === "KC_HYPR" || only.code === "ALL_T") return `modifier:${modsText(HYPER)}`;
  if (only.code === "KC_MEH" || only.code === "MEH_T") return `modifier:${modsText(["LCTL", "LSFT", "LALT"])}`;
  const mod = MODIFIER_KEYS.get(only.code);
  if (mod && !only.modifiers) return `modifier:${mod}`;
  return keyText(only.code, modsOf(only.modifiers)) ?? "native";
}

/** The same notation from a keyloom binding. */
export function irDescriptor(b: Binding, layout: Layout): string {
  const layerIndex = (id: string) => layout.layers.findIndex((l) => l.id === id);
  switch (b.kind) {
    case "key":
      return `${b.code}${b.mods?.length ? `+${modsText(b.mods)}` : ""}`;
    case "modifier":
      return `modifier:${modsText(b.mods)}`;
    case "holdTap": {
      const tap = `${b.tap.code}${b.tap.mods?.length ? `+${modsText(b.tap.mods)}` : ""}`;
      return "mods" in b.hold ? `holdTap:${tap}/mods:${modsText(b.hold.mods)}` : `holdTap:${tap}/layer:${layerIndex(b.hold.layerId)}`;
    }
    case "layer":
      return `layer:${b.action}:${layerIndex(b.layerId)}`;
    case "macro": {
      const step = layout.macros.find((m) => m.id === b.macroId)?.steps[0];
      return step && step.op === "tap" && step.code ? `macro:${step.code}${step.mods?.length ? `+${modsText(step.mods)}` : ""}` : "macro:?";
    }
    case "transparent":
      return "transparent";
    case "none":
      return "none";
    case "native":
      return "native";
  }
}
