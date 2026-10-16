import { describe, expect, test } from "bun:test";
import { keyName, keyPlace, legendWords } from "../../src/boards/key-names.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
const base = layout.layers[0]?.id ?? "";
const name = (position: number) => keyName(board.definition, layout, { layerId: base, position }, { geometry: board.geometry });

describe("a key named as a person names it (D-279)", () => {
  test("by what it prints, its finger and row, and its layer, never a number", () => {
    expect(name(30)).toBe("S hold ⌥ (left ring, home row, Layer 0)");
    expect(name(31)).toBe("D (left middle, home row, Layer 0)");
    for (let p = 0; p < board.definition.keyCount; p++) expect(name(p)).not.toMatch(/\bkey \d/);
  });

  test("the Moonlander's red thumb keys by their colour", () => {
    expect(keyPlace(board.definition, 59, board.geometry)).toBe("left red thumb key");
    expect(keyPlace(board.definition, 60, board.geometry)).toBe("right red thumb key");
  });

  test("inner and outer only where a finger has more than one key in the row, and only with geometry", () => {
    expect(keyPlace(board.definition, 28, board.geometry)).toBe("left pinky, home row, outer");
    expect(keyPlace(board.definition, 29, board.geometry)).toBe("left pinky, home row, inner");
    expect(keyPlace(board.definition, 28)).toBe("left pinky, home row");
  });

  test("a layer key's small legend says how without an extra 'hold'; a hold-tap says hold", () => {
    expect(legendWords({ kind: "layer", tap: "Nav", hold: "once" })).toBe("Nav once");
    expect(legendWords({ kind: "holdTap", tap: "S", hold: "⌥" })).toBe("S hold ⌥");
    expect(legendWords({ kind: "none", tap: "" })).toBe("blank");
  });
});
