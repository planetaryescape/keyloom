import { describe, expect, test } from "bun:test";
import type { BoardChoice } from "../../src/api/http.ts";
import { acceptsFile, guideFor, importCommand } from "../../src/web/import/export-steps.ts";

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

  test("every importer the boards declare has a guide", async () => {
    const { IMPORTER_IDS } = await import("../../src/boards/schema.ts");
    for (const id of IMPORTER_IDS) expect(guideFor(board("x/y", [id])).tool).not.toBe("your editor");
  });
});
