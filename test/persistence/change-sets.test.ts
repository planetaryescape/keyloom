import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { type ChangeSetRow, findChangeSet, insertChangeSet, listChangeSets, markApplied, markRejected } from "../../src/persistence/change-sets.ts";
import { migrate, openDatabase } from "../../src/persistence/db.ts";
import { createLayout, findRevision } from "../../src/persistence/layouts.ts";
import { MIGRATIONS } from "../../src/persistence/migrations.ts";
import { HeadMovedError, appendRevision } from "../../src/persistence/revisions.ts";
import { transact } from "../../src/persistence/transaction.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
const ops: ChangeOp[] = [{ op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "key", code: "F17" } }];

function fresh() {
  const db = openDatabase(tempDir());
  const created = createLayout(db, { name: "l", layout, summary: "Imported", origin: "import" });
  return { db, ...created };
}

describe("migration 0002", () => {
  test("rebuilds revisions with its foreign key and keeps the data, on a database that is at version 1", () => {
    const db = new Database(":memory:", { strict: true });
    db.run("PRAGMA foreign_keys = ON");
    db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
    const first = MIGRATIONS[0];
    if (!first) throw new Error("no migrations");
    db.exec(first.sql);
    db.query("INSERT INTO schema_migrations VALUES (1, ?, 0)").run(first.name);
    // Two revisions in a chain, written the way version 1 wrote them.
    db.transaction(() => {
      db.run("PRAGMA defer_foreign_keys = ON");
      db.query("INSERT INTO layouts VALUES ('lay_a', 'zsa/moonlander', 'a', 'rev_2', 1, 2)").run();
      db.query("INSERT INTO revisions VALUES ('rev_1', 'lay_a', NULL, '{\"n\":1}', 'import', NULL, NULL, 'one', 1)").run();
      db.query("INSERT INTO revisions VALUES ('rev_2', 'lay_a', 'rev_1', '{\"n\":2}', 'undo', NULL, 'rev_1', 'two', 2)").run();
    })();

    migrate(db);

    expect(db.query("SELECT id, parent_id, document, origin, undoes_revision_id, summary FROM revisions ORDER BY id").all()).toEqual([
      { id: "rev_1", parent_id: null, document: '{"n":1}', origin: "import", undoes_revision_id: null, summary: "one" },
      { id: "rev_2", parent_id: "rev_1", document: '{"n":2}', origin: "undo", undoes_revision_id: "rev_1", summary: "two" },
    ]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect((db.query("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number }).n).toBe(MIGRATIONS.length);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'revisions_layout'").all()).toHaveLength(1);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'revisions_new'").all()).toHaveLength(0);
    // The new table enforces what the old one only documented.
    expect(() => db.query("INSERT INTO revisions VALUES ('rev_3', 'lay_a', 'rev_2', '{}', 'editor', 'cs_missing', NULL, 'x', 3)").run()).toThrow(/FOREIGN KEY/);
    // And the tables that reference revisions still resolve to the rebuilt one.
    expect(() => db.query("UPDATE layouts SET head_revision_id = 'rev_missing'").run()).toThrow(/FOREIGN KEY/);
    db.close();
  });

  test("a migration that leaves a foreign key violation is rolled back, and keys come back on", () => {
    const db = new Database(":memory:", { strict: true });
    db.run("PRAGMA foreign_keys = ON");
    db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
    const first = MIGRATIONS[0];
    if (!first) throw new Error("no migrations");
    db.exec(first.sql);
    db.query("INSERT INTO schema_migrations VALUES (1, ?, 0)").run(first.name);
    db.run("PRAGMA foreign_keys = OFF");
    db.query("INSERT INTO revisions VALUES ('rev_1', 'lay_missing', NULL, '{}', 'import', NULL, NULL, 'one', 1)").run();
    db.run("PRAGMA foreign_keys = ON");
    expect(() => migrate(db)).toThrow(/foreign key violations/);
    expect(db.query("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: 1 });
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'change_sets'").all()).toHaveLength(0);
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });
});

describe("appendRevision", () => {
  test("writes a child of the head and moves the head, in a way a later read sees", () => {
    const { db, layout: row, revision } = fresh();
    const next = transact(db, () => appendRevision(db, { layoutId: row.id, expectedHeadId: revision.id, layout, origin: "editor", summary: "s" }));
    expect(next).toMatchObject({ parentId: revision.id, origin: "editor", summary: "s" });
    expect(db.query("SELECT head_revision_id FROM layouts WHERE id = ?").get(row.id)).toEqual({ head_revision_id: next.id });
    expect(findRevision(db, row.id, next.id)?.layout).toEqual(layout);
    db.close();
  });

  test("refuses to extend a head that is not the one the caller read, and writes nothing", () => {
    const { db, layout: row, revision } = fresh();
    expect(() => transact(db, () => appendRevision(db, { layoutId: row.id, expectedHeadId: "rev_other", layout, origin: "editor", summary: "s" }))).toThrow(HeadMovedError);
    expect(db.query("SELECT COUNT(*) AS n FROM revisions").get()).toEqual({ n: 1 });
    expect(db.query("SELECT head_revision_id FROM layouts").get()).toEqual({ head_revision_id: revision.id });
    db.close();
  });

  test("a change set can be referenced by the revision it produced", () => {
    const { db, layout: row, revision } = fresh();
    const cs = insertChangeSet(db, { layoutId: row.id, baseRevisionId: revision.id, source: "editor", ops, explanation: "e", validation: { ok: true }, status: "applied" });
    const next = transact(db, () => appendRevision(db, { layoutId: row.id, expectedHeadId: revision.id, layout, origin: "editor", summary: "s", changeSetId: cs.id }));
    expect(db.query("SELECT change_set_id FROM revisions WHERE id = ?").get(next.id)).toEqual({ change_set_id: cs.id });
    expect(() => transact(db, () => appendRevision(db, { layoutId: row.id, expectedHeadId: next.id, layout, origin: "editor", summary: "s", changeSetId: "cs_ghost" }))).toThrow(/FOREIGN KEY/);
    db.close();
  });
});

describe("change set repository", () => {
  const make = (db: Database, layoutId: string, baseRevisionId: string, extra: Partial<Parameters<typeof insertChangeSet>[1]> = {}): ChangeSetRow =>
    insertChangeSet(db, { layoutId, baseRevisionId, source: "editor", ops, explanation: "e", validation: { ok: true }, status: "proposed", ...extra });

  test("round-trips ops, tradeoffs and validation", () => {
    const { db, layout: row, revision } = fresh();
    const cs = make(db, row.id, revision.id);
    expect(cs).toMatchObject({ status: "proposed", source: "editor", ops, tradeoffs: { gains: [], costs: [] }, validation: { ok: true }, conversationId: null, decidedAt: null });
    expect(cs.id).toMatch(/^cs_[0-9A-Z]{26}$/);
    expect(findChangeSet(db, cs.id)).toEqual(cs);
    expect(findChangeSet(db, "cs_none")).toBeUndefined();
    db.close();
  });

  test("lists newest first and filters by status", () => {
    const { db, layout: row, revision } = fresh();
    const a = make(db, row.id, revision.id);
    const b = make(db, row.id, revision.id);
    markRejected(db, a.id);
    expect(listChangeSets(db, row.id).map((c) => c.id)).toEqual([b.id, a.id]);
    expect(listChangeSets(db, row.id, { status: "rejected" }).map((c) => c.id)).toEqual([a.id]);
    expect(findChangeSet(db, a.id)?.decidedAt).not.toBeNull();
    db.close();
  });

  test("applying one member of a proposal group supersedes the others, and only the proposed ones", () => {
    const { db, layout: row, revision } = fresh();
    const [a, b, c, other] = [
      make(db, row.id, revision.id, { proposalGroup: "g" }), make(db, row.id, revision.id, { proposalGroup: "g" }),
      make(db, row.id, revision.id, { proposalGroup: "g" }), make(db, row.id, revision.id, { proposalGroup: "h" }),
    ] as [ChangeSetRow, ChangeSetRow, ChangeSetRow, ChangeSetRow];
    markRejected(db, c.id);
    markApplied(db, a, { ok: true, again: true });
    expect(findChangeSet(db, a.id)).toMatchObject({ status: "applied", validation: { ok: true, again: true } });
    expect(findChangeSet(db, b.id)?.status).toBe("superseded");
    expect(findChangeSet(db, c.id)?.status).toBe("rejected");
    expect(findChangeSet(db, other.id)?.status).toBe("proposed");
    db.close();
  });

  test("a stored op that no longer parses fails loudly instead of being coerced", () => {
    const { db, layout: row, revision } = fresh();
    const cs = make(db, row.id, revision.id);
    db.query("UPDATE change_sets SET ops = ? WHERE id = ?").run('[{"op":"teleport"}]', cs.id);
    expect(() => findChangeSet(db, cs.id)).toThrow();
    db.close();
  });
});
