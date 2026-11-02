import { describe, expect, test } from "bun:test";
import { recentBoards, WALL_SIZE } from "../../src/api/recent-boards.ts";

describe("recentBoards", () => {
  test("picks at most WALL_SIZE boards", () => {
    const list = [
      { id: "1", boardId: "b1", updatedAt: 100 },
      { id: "2", boardId: "b2", updatedAt: 200 },
      { id: "3", boardId: "b3", updatedAt: 300 },
      { id: "4", boardId: "b4", updatedAt: 400 },
      { id: "5", boardId: "b5", updatedAt: 500 },
    ];
    const picked = recentBoards(list);
    expect(picked.length).toBe(WALL_SIZE);
    expect(picked.map((b) => b.boardId)).toEqual(["b5", "b4", "b3", "b2"]);
  });

  test("uses openedAt when present over updatedAt", () => {
    const list = [
      { id: "1", boardId: "b1", updatedAt: 1000, openedAt: 100 },
      { id: "2", boardId: "b2", updatedAt: 200, openedAt: 2000 },
    ];
    const picked = recentBoards(list);
    expect(picked.map((b) => b.boardId)).toEqual(["b2", "b1"]);
  });

  test("deduplicates multiple configs of the same board to the latest", () => {
    const list = [
      { id: "1", boardId: "glove80", updatedAt: 100, openedAt: 500 },
      { id: "2", boardId: "glove80", updatedAt: 200, openedAt: 800 },
      { id: "3", boardId: "corne", updatedAt: 300, openedAt: 600 },
    ];
    const picked = recentBoards(list);
    expect(picked.map((b) => b.id)).toEqual(["2", "3"]);
  });

  test("excludes archived configs", () => {
    const list = [
      { id: "1", boardId: "b1", updatedAt: 100, archivedAt: 500 },
      { id: "2", boardId: "b2", updatedAt: 200, archivedAt: null },
    ];
    const picked = recentBoards(list);
    expect(picked.map((b) => b.id)).toEqual(["2"]);
  });
});
