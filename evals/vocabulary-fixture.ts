// A synthetic Glove80 with plain letters and no number layer or home-row mods yet (D-006).
import { showBoard } from "../src/app/index.ts";
import { type Binding, LayoutSchema } from "../src/layout/schema.ts";

export const HOME_POSITIONS = [35, 36, 37, 38, 39, 40, 41, 42, 43, 44];
export const TOP_POSITIONS = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
export const DIGITS = ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N0"];
export const F_POSITION = 38;
export const J_POSITION = 41;

export function vocabularyFixture() {
  const board = showBoard("moergo/glove80").definition;
  const bindings: Binding[] = Array.from({ length: board.keyCount }, () => ({ kind: "none" }));
  for (const [i, code] of ["A", "S", "D", "F", "G", "H", "J", "K", "L", "SEMICOLON"].entries()) {
    bindings[HOME_POSITIONS[i]!] = { kind: "key", code };
  }
  for (const [i, code] of [..."QWERTYUIOP"].entries()) bindings[TOP_POSITIONS[i]!] = { kind: "key", code };
  bindings[69] = { kind: "key", code: "SPACE" };
  const before = LayoutSchema.parse({
    schemaVersion: 1, boardId: board.id, firmware: board.firmware,
    layers: [{ id: "base", name: "Base", bindings }],
    macros: [], combos: [], holdTapProfiles: [], settings: [], passthrough: [],
  });
  return { board, before };
}
