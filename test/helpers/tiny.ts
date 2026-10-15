// A 4-key board and a 3-layer layout small enough to read in a test. Every layer is reachable (num by a key, nav by a combo) and nav repeats base's keys, so an edit to a base key does not lose a function.
import type { BoardDefinition } from "../../src/boards/schema.ts";
import type { Binding, Layout } from "../../src/layout/schema.ts";
import { moonlander } from "./board.ts";

const real = await moonlander();

export const tinyBoard: BoardDefinition = { ...real.definition, keyCount: 4 };

export const key = (code: string): Binding => ({ kind: "key", code });
export const T: Binding = { kind: "transparent" };

export function tiny(over: Partial<Layout> = {}): Layout {
  return {
    schemaVersion: 1,
    boardId: tinyBoard.id,
    firmware: "qmk",
    layers: [
      { id: "base", name: "Base", bindings: [key("A"), key("B"), { kind: "layer", action: "momentary", layerId: "num" }, key("D")] },
      { id: "num", name: "Numbers", bindings: [key("N1"), key("N2"), T, key("N4")] },
      { id: "nav", name: "Nav", bindings: [key("A"), key("B"), T, key("D")] },
    ],
    macros: [{ id: "m1", name: "Macro", steps: [{ op: "tap", code: "A" }] }],
    tapDances: [],
    combos: [{ id: "go-nav", name: "Nav", positions: [0, 1], layerIds: "all", output: { kind: "layer", action: "momentary", layerId: "nav" } }],
    holdTapProfiles: [{ id: "p", name: "P", firmware: "qmk", options: {} }],
    settings: [],
    passthrough: [],
    ...over,
  };
}
