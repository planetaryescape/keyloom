import { describe, expect, test } from "bun:test";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { rowsOf } from "../../../src/firmware/zmk/emit-keymap.ts";

const BOARDS = `${import.meta.dir}/../../../boards`;

describe("rowsOf", () => {
  test("the Corne's raised thumb keys still give its four physical rows, not lines of ten", async () => {
    const corne = await loadBoardDir(`${BOARDS}/foostan/corne`);
    expect(rowsOf(corne.geometry, corne.definition.keyCount).map((r) => r.length)).toEqual([12, 12, 12, 6]);
  });

  test("a board whose rows group by height keeps that grouping", async () => {
    const glove80 = await loadBoardDir(`${BOARDS}/moergo/glove80`);
    expect(rowsOf(glove80.geometry, glove80.definition.keyCount).map((r) => r.length)).toEqual([10, 12, 12, 12, 18, 16]);
  });

  test("without geometry it falls back to lines of ten", () => {
    expect(rowsOf(undefined, 12)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 11]]);
  });
});
