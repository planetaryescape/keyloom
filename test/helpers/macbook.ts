// Fixtures for the MacBook board: layouts that use each thing the kanata generator writes.
import { getBoard } from "../../src/boards/registry.ts";
import { identityLayout } from "../../src/firmware/kanata/identity.ts";
import { physicalKeys } from "../../src/firmware/kanata/board-config.ts";
import type { Binding, Layout } from "../../src/layout/schema.ts";

export const macbook = () => getBoard("apple/macbook-ansi").definition;

/** The position of a physical key by KeyCode name. */
export function at(code: string): number {
  const i = physicalKeys(macbook()).findIndex((k) => k.kind === "key" && k.code === code);
  if (i < 0) throw new Error(`no ${code} on the MacBook board`);
  return i;
}

export function withBindings(layout: Layout, layerId: string, set: Record<string, Binding>): Layout {
  return { ...layout, layers: layout.layers.map((l) => (l.id !== layerId ? l : { ...l, bindings: l.bindings.map((b, p) => { const code = (physicalKeys(macbook())[p] as { code?: string }).code; return code !== undefined && set[code] ? set[code] : b; }) })) };
}

const layer = (id: string, name: string, base: Layout): Layout["layers"][number] => ({ id, name, bindings: base.layers[0]!.bindings.map(() => ({ kind: "transparent" }) as Binding) });

const HRM = (tap: string, mod: "LGUI" | "LALT" | "LCTL" | "LSFT"): Binding => ({ kind: "holdTap", tap: { code: tap }, hold: { mods: [mod] }, profileId: "hrm" });

/** Home-row mods, a Space layer, combos, a macro with text, Option-Option, tap dance, one-shot, Caps Word and a toggle. */
export function richLayout(variant = "tap-hold-opposite-hand"): Layout {
  let l = identityLayout(macbook());
  l = withBindings(l, "base", {
    A: HRM("A", "LGUI"), S: HRM("S", "LALT"), D: HRM("D", "LCTL"), F: HRM("F", "LSFT"),
    SPACE: { kind: "holdTap", tap: { code: "SPACE" }, hold: { layerId: "nav" }, profileId: "space" },
    CAPS_LOCK: { kind: "native", firmware: "kanata", source: "(caps-word-toggle 2000)", label: "Caps Word" },
    RIGHT_ALT: { kind: "macro", macroId: "opt-opt" },
    RIGHT_GUI: { kind: "layer", action: "toggle", layerId: "num" },
    TAB: { kind: "tapDance", tapDanceId: "td-tab" },
    N2: { kind: "layer", action: "oneShot", layerId: "nav" },
    N1: { kind: "macro", macroId: "sign" },
  });
  const nav = layer("nav", "Navigation", l);
  nav.bindings[at("H")] = { kind: "key", code: "LEFT" };
  nav.bindings[at("J")] = { kind: "key", code: "DOWN" };
  nav.bindings[at("K")] = { kind: "key", code: "UP" };
  nav.bindings[at("L")] = { kind: "key", code: "RIGHT" };
  const num = layer("num", "Numbers", l);
  num.bindings[at("RIGHT_GUI")] = { kind: "layer", action: "toggle", layerId: "num" };
  return {
    ...l,
    layers: [...l.layers, nav, num],
    macros: [
      { id: "opt-opt", name: "Option-Option", steps: [{ op: "tap", code: "LEFT_ALT" }, { op: "tap", code: "LEFT_ALT" }] },
      { id: "sign", name: "Signature", steps: [{ op: "text", text: "Best, BK!" }, { op: "waitMs", ms: 100 }, { op: "press", code: "LEFT_GUI" }, { op: "tap", code: "S" }, { op: "release", code: "LEFT_GUI" }] },
    ],
    tapDances: [{ id: "td-tab", name: "Tab or backtick", tap: { kind: "key", code: "TAB" }, doubleTap: { kind: "key", code: "GRAVE" } }],
    combos: [
      { id: "cut", name: "Cut", positions: [at("X"), at("C")], layerIds: "all", output: { kind: "key", code: "X", mods: ["LGUI"] }, timeoutMs: 50 },
      { id: "eq", name: "Equals", positions: [at("I"), at("O")], layerIds: ["base"], output: { kind: "key", code: "EQUAL" } },
    ],
    holdTapProfiles: [
      { id: "hrm", name: "Home-row mods", firmware: "kanata", options: { variant, "hold-ms": 200, "tap-repress-ms": 120, "require-prior-idle-ms": 150 } },
      { id: "space", name: "Space layer", firmware: "kanata", options: { variant: "tap-hold-press", "hold-ms": 1000 } },
    ],
  };
}
