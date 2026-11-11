import { describe, expect, test } from "bun:test";
import type { BoardChoice } from "../../src/api/http.ts";
import { acceptsFile, guideFor, importCommand, offersStartBlank } from "../../src/web/import/export-steps.ts";

const board = (id: string, importers: string[]): BoardChoice => ({ id, name: id, vendor: "v", firmware: "zmk", keyCount: 42, importers });

describe("the import cards", () => {
  test("each importer says which file to export, and only that kind is taken", () => {
    const oryx = guideFor(board("zsa/moonlander", ["oryx-source"]));
    expect(oryx.steps).toContain("Oryx");
    expect(acceptsFile(oryx, "synchronized_source.zip")).toBe(true);
    expect(acceptsFile(oryx, "glove80.keymap")).toBe(false);
    const layoutEditor = guideFor(board("moergo/glove80", ["zmk-layout-editor-keymap"]));
    expect(acceptsFile(layoutEditor, "My Layout.KEYMAP")).toBe(true);
    expect(acceptsFile(layoutEditor, "export.zip")).toBe(false);
  });

  test("a board whose importers have no guide still gets a card that takes either file", () => {
    const guide = guideFor(board("new/board", ["something-new"]));
    expect(acceptsFile(guide, "a.zip")).toBe(true);
    expect(acceptsFile(guide, "a.keymap")).toBe(true);
    expect(acceptsFile(guide, "a.txt")).toBe(false);
  });

  test("the command under a card names the board", () => {
    expect(importCommand(board("moergo/glove80", ["zmk-layout-editor-keymap"]))).toBe("keyloom import --board moergo/glove80 <file>");
    expect(importCommand(board("moergo/glove80", ["zmk-layout-editor-keymap"]), ["prose", "shortcuts"])).toBe("keyloom import --board moergo/glove80 --activities prose,shortcuts <file>");
  });

  // R1-24: the card opens the editor its steps start in, and reads the Mac's hidden Karabiner file with a button.
  test("Oryx and the Layout Editor are linked, and only Karabiner's card reads from this Mac", () => {
    expect(guideFor(board("zsa/moonlander", ["oryx-source"])).link?.href).toBe("https://configure.zsa.io");
    expect(guideFor(board("moergo/glove80", ["zmk-layout-editor-keymap"])).link?.href).toBe("https://my.glove80.com");
    expect(guideFor(board("apple/macbook", ["karabiner-json"])).readFromMac).toBe(true);
    expect(guideFor(board("foostan/corne", ["zmk-keymap"])).readFromMac).toBeUndefined();
  });

  test("every importer the boards declare has a guide", async () => {
    const { IMPORTER_IDS } = await import("../../src/boards/schema.ts");
    for (const id of IMPORTER_IDS) expect(guideFor(board("x/y", [id])).tool).not.toBe("your editor");
  });
});

test("Read it from this Mac with no Karabiner settings offers Start blank; a settings file it can't read keeps the drop (R3-12)", () => {
  expect(offersStartBlank("karabiner_missing")).toBe(true);
  for (const code of ["karabiner_denied", "karabiner_too_large", "karabiner_not_a_file", "karabiner_unavailable", undefined]) expect(offersStartBlank(code)).toBe(false);
});
