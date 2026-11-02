import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
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
    expect(readdirSync(root)).toEqual([]);
    const dir = join(root, "new");
    expect(exportBoardContribution("foostan/corne", dir).files).toHaveLength(3);
    expect(existsSync(join(dir, "boards/foostan/corne/geometry.json"))).toBe(true);
  });
  test("a filesystem failure removes only this export's partial output so it can be retried", () => {
    const root = tempDir();
    const out = join(root, "retry");
    const longId = `example/${"x".repeat(300)}`;
    expect(prepareBoardContribution("foostan/corne", longId).boardId).toBe(longId);
    expect(() => exportBoardContribution("foostan/corne", out, longId)).toThrow();
    expect(existsSync(out)).toBe(false);
    expect(exportBoardContribution("foostan/corne", out).files).toHaveLength(3);
  });
});
