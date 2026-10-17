// A keymap's own `enum custom_keycodes` and the process_record_user cases that use them survive import and generation as passthrough
// (D-377), so the generated keymap declares what its keys name.
import { describe, expect, test } from "bun:test";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { GenerateError, generateQmkSource } from "../../../src/firmware/qmk/generate.ts";
import { ImportError, importOryxSource, importQmkSource } from "../../../src/firmware/qmk/import.ts";
import { FIXTURE_DIR, MOONLANDER_DIR } from "../../helpers/board.ts";
import { templateCopy } from "../../helpers/board-recipes.ts";

const MOONLANDER_DEFAULT = `${import.meta.dir}/../../fixtures/qmk/zsa-moonlander-default`;
const keymapC = (m: { head: string; keys: string; after?: string }) =>
  `#include QMK_KEYBOARD_H\n${m.head}\nconst uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {\n    [0] = LAYOUT(${m.keys}),\n};\n${m.after ?? ""}`;
const generated = (layout: Parameters<typeof generateQmkSource>[0]["layout"], board: Parameters<typeof generateQmkSource>[0]["board"]) =>
  generateQmkSource({ layout, board, revisionId: "rev_T" }).files.find((f) => f.path === "keymap.c")?.content ?? "";

describe("the Moonlander's default keymap", () => {
  test("VRSN is declared in the generated enum, and its case runs on a press only", async () => {
    const board = (await loadBoardDir(MOONLANDER_DIR)).definition;
    const { layout } = await importOryxSource(MOONLANDER_DEFAULT, board);
    expect(layout.passthrough.find((p) => p.anchor === "custom-keycodes")?.source).toBe("VRSN");
    const c = generated(layout, board);
    expect(c).toMatch(/enum custom_keycodes \{\n  RGB_SLD = ZSA_SAFE_RANGE,\n  VRSN,\n\};/);
    expect(c).toMatch(/case VRSN: if \(record->event\.pressed\) \{[\s\S]*SEND_STRING[\s\S]*return false;[\s\S]*\}\s*break;/);
    // The enum is declared once, before keymaps[] names VRSN.
    expect(c.indexOf("VRSN,\n};")).toBeLessThan(c.indexOf("const uint16_t PROGMEM keymaps"));
  });

  test("an Oryx export's own enum (RGB_SLD, ST_MACRO_n) is keyloom's, so nothing is carried", async () => {
    const board = (await loadBoardDir(MOONLANDER_DIR)).definition;
    const { layout } = await importOryxSource(FIXTURE_DIR, board);
    expect(layout.passthrough.some((p) => p.anchor === "custom-keycodes")).toBe(false);
  });
});

describe("a hand-written keymap", () => {
  test("keeps explicit values, re-bases the first member on SAFE_RANGE, and leaves a case with no press guard alone", async () => {
    const board = (await loadBoardDir(await templateCopy("qmk"))).definition;
    const src = keymapC({
      head: "enum custom_keycodes { MY_A = SAFE_RANGE, MY_B, MY_C = SAFE_RANGE + 8 };",
      keys: "MY_A, MY_B, MY_C, KC_A",
      after: "bool process_record_user(uint16_t keycode, keyrecord_t *record) {\n  switch (keycode) {\n    case MY_A:\n      return false;\n  }\n  return true;\n}\n",
    });
    const { layout } = await importQmkSource({ name: "t", keymapC: src }, board);
    expect(layout.passthrough.find((p) => p.anchor === "custom-keycodes")?.source).toBe("MY_A\nMY_B\nMY_C = SAFE_RANGE + 8");
    const c = generated(layout, board);
    expect(c).toContain("enum custom_keycodes {\n  MY_A = SAFE_RANGE,\n  MY_B,\n  MY_C = SAFE_RANGE + 8,\n};");
    expect(c).toContain("case MY_A:");
    expect(c).not.toContain("record->event.pressed");
  });

  test("a name keyloom's own enum writes is an error naming it, at import and at generation", async () => {
    const moon = (await loadBoardDir(MOONLANDER_DIR)).definition;
    const clash = keymapC({ head: "enum custom_keycodes { RGB_SLD = SAFE_RANGE + 3 };", keys: Array(72).fill("KC_A").join(",") });
    await expect(importQmkSource({ name: "t", keymapC: clash }, moon)).rejects.toThrow(/RGB_SLD/);
    await expect(importQmkSource({ name: "t", keymapC: clash }, moon)).rejects.toThrow(ImportError);

    // Imported fine, then a macro keyloom adds takes the name a carried keycode already has.
    const { layout } = await importOryxSource(FIXTURE_DIR, moon);
    const withOwn = { ...layout, passthrough: [...layout.passthrough, { firmware: "qmk" as const, file: "keymap.c", anchor: "custom-keycodes", source: "ST_MACRO_0", refersToLayerIndices: false }] };
    expect(() => generated(withOwn, moon)).toThrow(GenerateError);
    expect(() => generated(withOwn, moon)).toThrow(/ST_MACRO_0/);
  });
});
