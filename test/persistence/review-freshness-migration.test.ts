import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { openApp } from "../../src/app/context.ts";
import { showReview } from "../../src/app/review.ts";
import { getLayout } from "../../src/app/layouts.ts";
import { MIGRATIONS } from "../../src/persistence/migrations.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { findChangeSet, insertChangeSet } from "../../src/persistence/change-sets.ts";
import { groundedLayout } from "../helpers/grounded-review.ts";
import { tempDir } from "../helpers/tmp.ts";

test("upgrading withdraws legacy recommendations without changing configs or unrelated editor proposals", () => {
  const dir = tempDir();
  const db = new Database(join(dir, "keyloom.db"), { strict: true });
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  for (const migration of MIGRATIONS.slice(0, 15)) {
    db.exec(migration.sql);
    db.query("INSERT INTO schema_migrations VALUES (?, ?, 0)").run(migration.version, migration.name);
  }
  const doc = groundedLayout();
  const layout = createLayout(db, { name: "Legacy synthetic", layout: doc, summary: "Fixture", origin: "import" });
  const input = { layoutId: layout.layout.id, baseRevisionId: layout.revision.id, ops: [], explanation: "Synthetic fixture", validation: {}, status: "proposed" as const };
  const suggestion = insertChangeSet(db, { ...input, source: "agent" });
  const editor = insertChangeSet(db, { ...input, source: "editor" });
  db.query("INSERT INTO board_reviews (id, layout_id, revision_id, trigger, checked_at, summary, ai_status) VALUES ('rvw_legacy', ?, ?, 'manual', 0, ?, 'done')")
    .run(layout.layout.id, layout.revision.id, JSON.stringify({ layers: 3, keys: 4, combos: 0 }));
  for (const [position, source, proposalId] of [[0, "check", null], [1, "agent", suggestion.id]] as const) {
    db.query("INSERT INTO review_items (review_id, id, position, source, kind, severity, code, title, body, keys, layers, proposal_id, fixes) VALUES ('rvw_legacy', ?, ?, ?, ?, 'info', 'fixture', 'Fixture', 'Fixture', '[]', '[]', ?, '[]')")
      .run(`legacy-${source}`, position, source, source === "check" ? "hint" : "suggestion", proposalId);
  }
  db.close();
  const app = openApp({ dataDir: dir });
  try {
    const review = showReview(app, layout.layout.id).review!;
    expect(review.freshness?.current).toBe(false);
    expect(review.freshness?.reason).toContain("checks have changed");
    expect(review.items.map((item) => item.id)).toEqual(["legacy-check"]);
    expect(findChangeSet(app.db, suggestion.id)?.status).toBe("rejected");
    expect(findChangeSet(app.db, editor.id)?.status).toBe("proposed");
    expect(getLayout(app, layout.layout.id).document).toEqual(doc);
    expect(getLayout(app, layout.layout.id).revision.id).toBe(layout.revision.id);
    expect(app.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { app.db.close(); }
});
