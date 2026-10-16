import { describe, expect, test } from "bun:test";
import { openDatabase } from "../../src/persistence/db.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { MIGRATIONS } from "../../src/persistence/migrations.ts";
import { deleteTypingSession, findTypingSession, insertTypingSession, listTypingSessions, saveAnalysis } from "../../src/persistence/typing-sessions.ts";
import { bkMoonlander } from "../helpers/typing-lab.ts";
import { tempDir } from "../helpers/tmp.ts";

const { layout } = await bkMoonlander();

function fresh() {
  const db = openDatabase(tempDir());
  const created = createLayout(db, { name: "l", layout, summary: "Imported", origin: "import" });
  const input = (over: Partial<Parameters<typeof insertTypingSession>[1]> = {}): Parameters<typeof insertTypingSession>[1] => ({
    layoutId: created.layout.id, revisionId: created.revision.id, boardId: "zsa/moonlander", firmware: "qmk", startedAt: 1000, endedAt: 61_000,
    passage: { id: "starter", title: "Starter", why: "w", steps: [{ kind: "text", text: "sd" }, { kind: "hold", key: "s", then: "j" }] }, typedText: "sd",
    events: [{ at: 0, position: 30, action: "press" }, { at: 40, position: 30, action: "release", source: 255 }], warnings: ["one report never arrived"], ...over,
  });
  return { db, created, input };
}

describe("typing sessions", () => {
  test("a session is stored whole and read back as it was", () => {
    const { db, input, created } = fresh();
    const saved = insertTypingSession(db, input());
    // Read before the matcher: bun's toMatchObject replaces a value it matched against an asymmetric matcher.
    const id = saved.id;
    expect(saved).toMatchObject({
      id: expect.stringMatching(/^typ_[0-9A-Z]{26}$/), layoutId: created.layout.id, revisionId: created.revision.id, boardId: "zsa/moonlander", boardRevision: null,
      firmware: "qmk", startedAt: 1000, endedAt: 61_000, typedText: "sd", warnings: ["one report never arrived"], analysis: null, analysedAt: null,
    });
    expect(saved.events).toEqual([{ at: 0, position: 30, action: "press" }, { at: 40, position: 30, action: "release", source: 255 }]);
    expect(saved.passage.steps[1]).toEqual({ kind: "hold", key: "s", then: "j" });
    expect(findTypingSession(db, id)).toEqual(saved);
  });

  test("a list is newest first, shows how many events and whether it was analysed, and leaves out the trace and the text", () => {
    const { db, input, created } = fresh();
    const a = insertTypingSession(db, input({ startedAt: 1000 }));
    const b = insertTypingSession(db, input({ startedAt: 5000 }));
    saveAnalysis(db, a.id, { schemaVersion: 1 }, 123);
    const list = listTypingSessions(db);
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(list.map((s) => [s.eventCount, s.analysed])).toEqual([[2, false], [2, true]]);
    expect(list[1]?.analysedAt).toBe(123);
    expect(Object.keys(list[0] as object)).not.toContain("events");
    expect(Object.keys(list[0] as object)).not.toContain("typedText");
    expect(listTypingSessions(db, { layoutId: "lay_other" })).toEqual([]);
    expect(listTypingSessions(db, { layoutId: created.layout.id })).toHaveLength(2);
  });

  test("deleting removes the trace, the typed text and the analysis, and says whether there was anything to delete", () => {
    const { db, input } = fresh();
    const s = insertTypingSession(db, input({ typedText: "a secret" }));
    saveAnalysis(db, s.id, { findings: ["x"] });
    expect(deleteTypingSession(db, s.id)).toBe(true);
    expect(findTypingSession(db, s.id)).toBeUndefined();
    expect(deleteTypingSession(db, s.id)).toBe(false);
    // Nothing of it is left in the file, not even as text in another column.
    const rows = db.query("SELECT COUNT(*) AS n FROM typing_sessions").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  test("an event that cannot be right is refused instead of stored", () => {
    const { db, input } = fresh();
    expect(() => insertTypingSession(db, input({ events: [{ at: -1, position: 3, action: "press" }] }))).toThrow();
    expect(() => insertTypingSession(db, input({ events: [{ at: 1, position: 3.5, action: "press" }] }))).toThrow();
    expect(() => insertTypingSession(db, input({ events: [{ at: 1, position: 3, action: "tap" as never }] }))).toThrow();
    expect(listTypingSessions(db)).toEqual([]);
  });

  test("a session for a layout that does not exist is refused by the database", () => {
    const { db, input } = fresh();
    expect(() => insertTypingSession(db, input({ layoutId: "lay_missing" }))).toThrow();
  });

  test("saving an analysis for a session that is gone says so", () => {
    const { db } = fresh();
    expect(() => saveAnalysis(db, "typ_missing", {})).toThrow("there is no typing session typ_missing");
  });

  test("the migration is the ninth, applied once, and a reopened database keeps its sessions", () => {
    expect(MIGRATIONS.at(-1)?.name).toBe("0009_typing_sessions");
    const dir = tempDir();
    const db = openDatabase(dir);
    const { layout: l, revision } = createLayout(db, { name: "l", layout, summary: "s", origin: "import" });
    const s = insertTypingSession(db, { layoutId: l.id, revisionId: revision.id, boardId: "zsa/moonlander", firmware: "qmk", startedAt: 1, endedAt: 2, passage: { id: "p", title: "t", why: "w", steps: [] }, typedText: "", events: [], warnings: [] });
    db.close();
    const again = openDatabase(dir);
    expect(findTypingSession(again, s.id)?.id).toBe(s.id);
    expect(again.query("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: MIGRATIONS.length });
  });
});
