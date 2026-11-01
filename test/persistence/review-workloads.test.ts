import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { openDatabase } from "../../src/persistence/db.ts";
import { MIGRATIONS } from "../../src/persistence/migrations.ts";
import { databasePath } from "../../src/persistence/paths.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { deleteLayoutCascade, setBoardConfig } from "../../src/persistence/configs.ts";
import { insertReview } from "../../src/persistence/reviews.ts";
import { reviewActivities, reviewWorkload, saveReviewWorkload, setReviewActivities } from "../../src/persistence/review-workloads.ts";
import { transact } from "../../src/persistence/transaction.ts";
import { tempDir } from "../helpers/tmp.ts";
import { key, tinyLayout } from "../helpers/workload.ts";

test("schema 14 upgrades with no assumed profile, preserves layouts and remains idempotent", () => {
  const dir = tempDir();
  const old = new Database(databasePath(dir));
  old.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  for (const migration of MIGRATIONS.filter((m) => m.version <= 14)) {
    old.exec(migration.sql);
    old.query("INSERT INTO schema_migrations VALUES (?, ?, 0)").run(migration.version, migration.name);
  }
  const made = createLayout(old, { name: "Before activity tests", layout: tinyLayout([key("E")]), origin: "import", summary: "Existing config" });
  old.close();
  const db = openDatabase(dir);
  expect(reviewActivities(db, made.layout.id)).toEqual([]);
  expect(db.query("SELECT name, head_revision_id FROM layouts WHERE id = ?").get(made.layout.id)).toEqual({ name: "Before activity tests", head_revision_id: made.revision.id });
  setReviewActivities(db, made.layout.id, ["prose"]);
  db.close();
  const again = openDatabase(dir);
  expect(reviewActivities(again, made.layout.id)).toEqual(["prose"]);
  expect(again.query("SELECT count(*) AS n FROM schema_migrations WHERE version = 15").get()).toEqual({ n: 1 });
  again.close();
});

test("profiles belong to one config, evidence to one review, and both cascade on deletion", () => {
  const db = openDatabase(tempDir());
  try {
    const make = (name: string) => createLayout(db, { name, layout: tinyLayout([key("E")]), origin: "import", summary: "Synthetic" });
    const a = make("A"); const b = make("B");
    setReviewActivities(db, a.layout.id, ["prose"]);
    expect(reviewActivities(db, b.layout.id)).toEqual([]);
    const makeReview = (made: typeof a) => transact(db, () => insertReview(db, { layoutId: made.layout.id, revisionId: made.revision.id, trigger: "manual", checkedAt: 1, summary: { layers: 1, keys: 1, combos: 0 }, items: [], previousReviewId: null, fixed: [] }).review);
    const first = makeReview(a); const other = makeReview(b);
    const evidence = { status: "done" as const, activities: ["prose" as const], reason: null, identity: null, baseline: [], comparisons: [] };
    saveReviewWorkload(db, first.id, evidence);
    expect(reviewWorkload(db, first.id)).toEqual(evidence);
    expect(reviewWorkload(db, other.id)).toBeUndefined();
    setBoardConfig(db, "zsa/moonlander", b.layout.id);
    transact(db, () => deleteLayoutCascade(db, a.layout.id));
    expect(db.query("SELECT count(*) AS n FROM review_workload_profiles").get()).toEqual({ n: 0 });
    expect(db.query("SELECT count(*) AS n FROM review_workloads").get()).toEqual({ n: 0 });
    expect(db.query("SELECT name FROM layouts").all()).toEqual([{ name: "B" }]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { db.close(); }
});
