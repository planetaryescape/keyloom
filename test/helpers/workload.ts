import type { BoardDefinition } from "../../src/boards/schema.ts";
import type { EmulatorEvent, EmulatorReport, EmulationResult } from "../../src/firmware/emulate/types.ts";
import type { Binding, Layout } from "../../src/layout/schema.ts";
import { WorkloadSuiteSchema } from "../../src/lab/workload/schema.ts";
import { showBoard } from "../../src/app/boards.ts";
import { openApp } from "../../src/app/context.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { tempDir } from "./tmp.ts";

export const key = (code: string): Binding => ({ kind: "key", code });
export const none: Binding = { kind: "none" };
export function tinyLayout(base: Binding[] = [key("S"), { kind: "layer", action: "momentary", layerId: "symbols" }, none, key("V")], upper?: Binding[]): Layout {
  return {
    schemaVersion: 1, boardId: "zsa/moonlander", firmware: "qmk",
    layers: [{ id: "base", name: "Base", bindings: base }, ...(upper ? [{ id: "symbols", name: "Symbols", bindings: upper }] : [])],
    macros: [], combos: [], tapDances: [], conditionalLayers: [], holdTapProfiles: [], settings: [], passthrough: [],
  };
}
export const tinyBoard = (): BoardDefinition => ({ ...showBoard("zsa/moonlander").definition, keyCount: 4, hands: { left: [0, 1], right: [2, 3] }, fingers: { "0": "index", "1": "thumb", "2": "index", "3": "index" } });
export const suiteText = (text: string) => WorkloadSuiteSchema.parse({ schemaVersion: 1, id: "tiny", host: "us-ansi", tasks: [{ id: "task", kind: "text", text }] });
export const stroke = (at: number, key: string, mods: string[] = []): EmulatorReport[] => [
  { at, kind: "keyboard", keys: [key], mods }, { at: at + 10, kind: "keyboard", keys: [], mods: [] },
];
export const replayResult = (reports: EmulatorReport[], warnings: string[] = []): EmulationResult => ({ firmware: "qmk", reports, text: "THIS IS NOT AN ORACLE", warnings });
export const event = (at: number, position: number, action: "press" | "release"): EmulatorEvent => ({ at, position, action });

export function workloadApp(layout = tinyLayout(undefined, [{ kind: "transparent" }, none, key("E"), none])) {
  const dir = tempDir(); const app = openApp({ dataDir: dir });
  const keyCount = showBoard(layout.boardId).definition.keyCount;
  const padded = { ...layout, layers: layout.layers.map((l) => ({ ...l, bindings: [...l.bindings, ...Array.from({ length: keyCount - l.bindings.length }, () => none)] })) };
  const stored = createLayout(app.db, { name: "workload-test", layout: padded, summary: "Synthetic workload fixture", origin: "import" });
  return { app, dir, layoutId: stored.layout.id, revisionId: stored.revision.id };
}
