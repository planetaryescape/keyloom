// The board switch tells a derived board from a shipped one of the same name (D-336): "Corne (new)".
import { describe, expect, test } from "bun:test";
import type { LayoutSummary } from "../../src/api/http.ts";
import { boardEntries } from "../../src/web/shell/Header.tsx";

const layout = (id: string, boardId: string): LayoutSummary => ({ id, name: id, boardId, createdAt: 0, updatedAt: 0, revisionId: `rev_${id}` });

describe("boardEntries", () => {
  test("archived-only keyboards stay out of the switcher, without hiding a board with a live config", () => {
    const entries = boardEntries([
      { ...layout("old", "foostan/corne"), archivedAt: 1 },
      { ...layout("also-old", "zsa/moonlander"), archivedAt: 1 },
      layout("live", "zsa/moonlander"),
    ]);
    expect(entries.map((e) => e.id)).toEqual(["zsa/moonlander"]);
  });
  test("a derived board named like another reads '(new)'; one with its own name, and the shipped one, read as they are", () => {
    const entries = boardEntries([layout("a", "foostan/corne"), layout("b", "local/corne"), layout("c", "local/sofle")]);
    expect(entries.map((e) => e.name)).toEqual(["Corne", "Corne (new)", "Sofle"]);
  });
});
