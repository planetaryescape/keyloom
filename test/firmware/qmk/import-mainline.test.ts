// A keymap.c as QMK's own repository and its users write it: no Oryx, hand-drawn comments inside LAYOUT(...).
import { describe, expect, test } from "bun:test";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { importQmkSource } from "../../../src/firmware/qmk/import.ts";
import { generateQmkSource } from "../../../src/firmware/qmk/generate.ts";
import { templateCopy } from "../../helpers/board-recipes.ts";

const KEYMAP = `#include QMK_KEYBOARD_H

const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {
    [0] = LAYOUT(
  //,--------+--------.
       KC_A,    KC_B,
  //|--------+--------|
       KC_C,    MO(1)
  //\`--------+--------'
    ),
    [1] = LAYOUT(
       KC_1, KC_2, // a trailing comment
       /* block */ KC_3, _______
    ),
};
`;

describe("importing a hand-written QMK keymap", () => {
  test("comments inside LAYOUT(...) are not keys", async () => {
    const board = await loadBoardDir(await templateCopy("qmk"));
    const { layout, report } = await importQmkSource({ name: "mine", keymapC: KEYMAP }, board.definition);
    expect(report).toMatchObject({ layers: 2, keysPerLayer: 4 });
    expect(layout.layers[0]?.bindings.map((b) => b.kind)).toEqual(["key", "key", "key", "layer"]);
    expect(layout.layers[1]?.bindings.map((b) => b.kind)).toEqual(["key", "key", "key", "transparent"]);
  });

  test("it generates with the board's own layout macro and no ZSA scaffolding", async () => {
    const board = await qmkTemplate();
    const { layout } = await importQmkSource({ name: "mine", keymapC: KEYMAP }, board.definition);
    const source = generateQmkSource({ layout, board: board.definition, revisionId: "rev_T" });
    const c = source.files.find((f) => f.path === "keymap.c")?.content ?? "";
    expect(c).toContain("[0] = LAYOUT(");
    expect(c).not.toContain("ZSA");
    expect(source.files.map((f) => f.path)).not.toContain("keymap.json");
  });
});

async function qmkTemplate() {
  return loadBoardDir(await templateCopy("qmk"));
}
