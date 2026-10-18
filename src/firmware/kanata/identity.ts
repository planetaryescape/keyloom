// A layout in which every key does what it says (the MacBook as it is before keyloom remaps anything).
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Binding, Layout } from "../../layout/schema.ts";
import { physicalKeys } from "./board-config.ts";

export function identityLayout(board: BoardDefinition): Layout {
  const bindings: Binding[] = physicalKeys(board).map((k) =>
    k.kind === "fn" ? { kind: "native", firmware: "kanata", source: "fn", label: "fn" } : { kind: "key", code: k.code });
  return {
    schemaVersion: 1, boardId: board.id, firmware: "kanata",
    layers: [{ id: "base", name: "Base", bindings }],
    macros: [], tapDances: [], combos: [], conditionalLayers: [], holdTapProfiles: [], settings: [], passthrough: [],
  };
}
