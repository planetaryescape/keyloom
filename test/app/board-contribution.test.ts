import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { exportBoardContribution, prepareBoardContribution } from "../../src/app/index.ts";
import { parseBoard } from "../../src/boards/load.ts";
import { tempDir } from "../helpers/tmp.ts";

describe("a private-data-free contribution handoff", () => {
  test("the package is a loadable board with the requested upstream identity and a usable handoff", () => {
    const out = prepareBoardContribution("foostan/corne", "example/test-keyboard");
    const board = parseBoard(out.files["boards/example/test-keyboard/board.json"]!, out.files["boards/example/test-keyboard/geometry.json"]!);
    expect(board.definition.id).toBe("example/test-keyboard");
    expect(board.geometry.keys).toHaveLength(42);
    expect(Object.keys(out.files).sort()).toEqual(["CONTRIBUTION.md", "boards/example/test-keyboard/board.json", "boards/example/test-keyboard/geometry.json"]);
    expect(out.files["CONTRIBUTION.md"]).toContain("/add-keyboard");
    expect(out.files["CONTRIBUTION.md"]).toContain("unflashed PR");
  });
  test("bad IDs and existing output directories are refused before touching files", () => {
    const root = tempDir();
    expect(() => prepareBoardContribution("foostan/corne", "../../outside")).toThrow();
    expect(() => exportBoardContribution("foostan/corne", root)).toThrow(/already exists/);
    expect(existsSync(join(root, "CONTRIBUTION.md"))).toBe(false);
    const dir = join(root, "new");
    expect(exportBoardContribution("foostan/corne", dir).files).toHaveLength(3);
    expect(existsSync(join(dir, "boards/foostan/corne/geometry.json"))).toBe(true);
  });
});
