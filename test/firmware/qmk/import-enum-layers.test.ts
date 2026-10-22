// QMK's own default keymaps name their layers with an enum (`[BASE] = LAYOUT(...)`, `MO(NAV)`); the importer resolves the members to
// indexes and keeps the names (D-375).
import { describe, expect, test } from "bun:test";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { ImportError, importOryxSource, importQmkSource } from "../../../src/firmware/qmk/import.ts";
import { validate } from "../../../src/validation/validate.ts";
import { MOONLANDER_DIR } from "../../helpers/board.ts";
import { templateCopy } from "../../helpers/board-recipes.ts";

const MOONLANDER_DEFAULT = `${import.meta.dir}/../../fixtures/qmk/zsa-moonlander-default`;

const keymap = (head: string, body: string) => `#include QMK_KEYBOARD_H\n${head}\nconst uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {\n${body}\n};\n`;
const layer = (designator: string, a: string, b: string) => `    [${designator}] = LAYOUT(${a}, ${b}, KC_NO, KC_NO),`;

async function template() {
  return (await loadBoardDir(await templateCopy("qmk"))).definition;
}

describe("the Moonlander's own default keymap", () => {
  test("imports with BASE, SYMB and MDIA as its layers and layer keys that point at them", async () => {
    const board = (await loadBoardDir(MOONLANDER_DIR)).definition;
    const { layout, report } = await importOryxSource(MOONLANDER_DEFAULT, board);
    expect(report.layers).toBe(3);
    expect(layout.layers.map((l) => l.name)).toEqual(["BASE", "SYMB", "MDIA"]);
    const kinds = layout.layers[0]?.bindings.map((b) => b.kind) ?? [];
    expect(kinds.filter((k) => k === "layer").length).toBeGreaterThan(0);
    const targets = JSON.stringify(layout.layers[0]?.bindings.filter((b) => b.kind === "layer" || b.kind === "holdTap"));
    expect(targets).toContain('"layerId":"layer-1"');
    expect(targets).toContain('"layerId":"layer-2"');
  });
});

describe("enum layer names", () => {
  test("members are indexes in declaration order, in any order of appearance in keymaps[]", async () => {
    const src = keymap("enum layers { BASE, NAV };", [layer("NAV", "KC_1", "KC_2"), layer("BASE", "MO(NAV)", "LT(NAV, KC_A)")].join("\n"));
    const { layout } = await importQmkSource({ name: "t", keymapC: src }, await template());
    expect(layout.layers.map((l) => l.name)).toEqual(["BASE", "NAV"]);
    expect(layout.layers[0]?.bindings.map((b) => b.kind)).toEqual(["layer", "holdTap", "none", "none"]);
    expect(JSON.stringify(layout.layers[0]?.bindings)).toContain("layer-1");
  });

  test("explicit values, expressions on earlier members and members after an explicit value", async () => {
    const src = keymap("enum layers { _BASE = 0, _SYM = 2, _NAV, _FN = _BASE + 1 };", [
      layer("_BASE", "MO(_SYM)", "TG(_FN)"), layer("_FN", "KC_A", "KC_B"), layer("_SYM", "MO(_NAV)", "KC_C"), layer("_NAV", "KC_D", "KC_E"),
    ].join("\n"));
    const { layout } = await importQmkSource({ name: "t", keymapC: src }, await template());
    // _BASE 0, _FN 1, _SYM 2, _NAV 3; the leading underscore is dropped from the name.
    expect(layout.layers.map((l) => l.name)).toEqual(["BASE", "FN", "SYM", "NAV"]);
    expect(JSON.stringify(layout.layers[0]?.bindings)).toContain("layer-2");
    expect(JSON.stringify(layout.layers[2]?.bindings)).toContain("layer-3");
  });

  test("a kept call receiving an enum layer name refuses a reorder and names its line", async () => {
    const src = `${keymap("enum layers { _BASE, _NAV, _FN };", [layer("_BASE", "KC_A", "KC_B"), layer("_NAV", "KC_C", "KC_D"), layer("_FN", "KC_E", "KC_F")].join("\n"))}\nvoid f(void) {\n  my_fn(_NAV);\n}`;
    const { layout } = await importQmkSource({ name: "t", keymapC: src }, await template());
    const result = validate(await template(), layout, [{ op: "moveLayer", layerId: "layer-2", afterLayerId: "layer-0" }]);
    const issue = result.errors.find((e) => e.code === "passthrough_layer_index");
    expect(layout.passthrough.filter((p) => p.source.includes("my_fn"))).toHaveLength(1);
    expect(issue?.message ?? "").toContain("line 2 (my_fn(_NAV);)");
  });

  test("numbers keep working, and a mix of numbers and names names no layers", async () => {
    const numbers = await importQmkSource({ name: "t", keymapC: keymap("", [layer("0", "MO(1)", "KC_A"), layer("1", "KC_B", "KC_C")].join("\n")) }, await template());
    expect(numbers.layout.layers.map((l) => l.name)).toEqual(["Layer 0", "Layer 1"]);
    const mixed = await importQmkSource({ name: "t", keymapC: keymap("enum layers { A, B };", [layer("A", "KC_A", "KC_B"), layer("1", "KC_C", "KC_D")].join("\n")) }, await template());
    expect(mixed.layout.layers.map((l) => l.name)).toEqual(["Layer 0", "Layer 1"]);
  });

  test("a member with no value, a gap and a repeat are errors that say so", async () => {
    const board = await template();
    const run = (head: string, body: string) => importQmkSource({ name: "t", keymapC: keymap(head, body) }, board);
    await expect(run("enum layers { A = SAFE_RANGE };", layer("A", "KC_A", "KC_B"))).rejects.toThrow(/can't find a value for A/);
    await expect(run("enum layers { A, B = 3 };", [layer("A", "KC_A", "KC_B"), layer("B", "KC_C", "KC_D")].join("\n"))).rejects.toThrow(/no layer 1/);
    await expect(run("enum layers { A, B = 0 };", [layer("A", "KC_A", "KC_B"), layer("B", "KC_C", "KC_D")].join("\n"))).rejects.toThrow(/two layers numbered 0/);
    await expect(run("", layer("MISSING", "KC_A", "KC_B"))).rejects.toThrow(ImportError);
  });
});
