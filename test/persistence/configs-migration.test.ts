// Migration 0010 (25, D-300, D-301): it must pick the config the engine was already keeping on each keyboard, so the first run after
// an upgrade flashes nothing new, and it turns past verified syncs into versions.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { migrate } from "../../src/persistence/db.ts";
import { MIGRATIONS } from "../../src/persistence/migrations.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { createLayoutAtOldSchema } from "../helpers/old-schema.ts";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);
const glove = { ...layout, boardId: "moergo/glove80" };

function atVersion8(): Database {
  const db = new Database(":memory:", { strict: true });
  db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  for (const m of MIGRATIONS.slice(0, 8)) {
    db.exec(m.sql);
    db.query("INSERT INTO schema_migrations VALUES (?, ?, 0)").run(m.version, m.name);
  }
  db.run("PRAGMA foreign_keys = ON");
  return db;
}

function layoutAt(db: Database, name: string, doc: typeof layout, updatedAt: number): { id: string; rev: string } {
  const made = createLayoutAtOldSchema(db, { name, layout: doc, summary: "import" });
  db.query("UPDATE layouts SET updated_at = ?, created_at = ? WHERE id = ?").run(updatedAt, updatedAt, made.layout.id);
  return { id: made.layout.id, rev: made.revision.id };
}

function syncAt(db: Database, id: string, boardId: string, l: { id: string; rev: string }, finishedAt: number, status = "succeeded"): void {
  db.query(
    `INSERT INTO syncs (id, board_id, layout_id, revision_id, board_revision, trigger, status, step, log_path, pid, owner, applied_at, started_at, finished_at)
     VALUES (?, ?, ?, ?, 'reva', 'auto', ?, 'done', 'l', 1, 'o', ?, ?, ?)`,
  ).run(id, boardId, l.id, l.rev, status, finishedAt - 10, finishedAt - 5, finishedAt);
}

const configOf = (db: Database, boardId: string) => (db.query("SELECT layout_id FROM board_config WHERE board_id = ?").get(boardId) as { layout_id: string } | null)?.layout_id;

describe("migration 0010", () => {
  test("a board's config is the layout its last verified sync put on, even when another was edited since", () => {
    const db = atVersion8();
    const synced = layoutAt(db, "synced", layout, 100);
    const edited = layoutAt(db, "edited-since", layout, 900);
    syncAt(db, "syn_a", "zsa/moonlander", synced, 500);
    migrate(db);
    expect(configOf(db, "zsa/moonlander")).toBe(synced.id);
    expect(edited.id).not.toBe(synced.id);
  });

  test("a failed or cancelled sync does not decide it", () => {
    const db = atVersion8();
    const older = layoutAt(db, "older", layout, 100);
    const newer = layoutAt(db, "newer", layout, 900);
    syncAt(db, "syn_a", "zsa/moonlander", older, 500, "failed");
    migrate(db);
    expect(configOf(db, "zsa/moonlander")).toBe(newer.id);
  });

  test("a board that was never synced gets its newest layout, the highest ID on a tie, and boards are independent", () => {
    const db = atVersion8();
    layoutAt(db, "old", layout, 100);
    const a = layoutAt(db, "tie-a", layout, 900);
    const b = layoutAt(db, "tie-b", layout, 900);
    const g = layoutAt(db, "glove", glove, 50);
    migrate(db);
    expect(configOf(db, "zsa/moonlander")).toBe(a.id < b.id ? b.id : a.id);
    expect(configOf(db, "moergo/glove80")).toBe(g.id);
  });

  test("a sync on one board does not decide another board's config", () => {
    const db = atVersion8();
    const m = layoutAt(db, "m", layout, 100);
    const g = layoutAt(db, "g", glove, 100);
    syncAt(db, "syn_a", "moergo/glove80", m, 500); // a row that names a layout of the wrong board is ignored
    migrate(db);
    expect(configOf(db, "moergo/glove80")).toBe(g.id);
  });

  test("an empty database migrates, and existing layouts are not archived or marked as copies", () => {
    const empty = atVersion8();
    migrate(empty);
    expect(empty.query("SELECT COUNT(*) AS n FROM board_config").get()).toEqual({ n: 0 });
    const db = atVersion8();
    layoutAt(db, "x", layout, 1);
    migrate(db);
    expect(db.query("SELECT archived_at, copied_from_layout_id, copied_from_revision_id FROM layouts").get()).toEqual({ archived_at: null, copied_from_layout_id: null, copied_from_revision_id: null });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("past verified syncs become versions, each ended by the next verified sync of something else", () => {
    const db = atVersion8();
    const l = layoutAt(db, "mine", layout, 100);
    const second = { id: l.id, rev: l.rev };
    syncAt(db, "syn_1", "zsa/moonlander", l, 500);
    // Same revision again (a re-flash): still one version, with the later put-on time.
    syncAt(db, "syn_2", "zsa/moonlander", l, 600);
    db.query("INSERT INTO revisions (id, layout_id, parent_id, document, origin, summary, created_at) VALUES ('rev_2', ?, ?, '{}', 'editor', 's', 700)").run(l.id, l.rev);
    second.rev = "rev_2";
    syncAt(db, "syn_3", "zsa/moonlander", second, 800);
    syncAt(db, "syn_4", "zsa/moonlander", l, 900, "failed");
    migrate(db);
    const rows = db.query("SELECT revision_id, put_on_at, ended_at FROM versions ORDER BY put_on_at").all();
    expect(rows).toEqual([
      { revision_id: l.rev, put_on_at: 600, ended_at: 800 },
      { revision_id: "rev_2", put_on_at: 800, ended_at: null },
    ]);
  });
});
