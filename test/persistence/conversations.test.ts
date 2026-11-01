import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { migrate } from "../../src/persistence/db.ts";
import { findChangeSet, insertChangeSet } from "../../src/persistence/change-sets.ts";
import { findConversation, insertConversation, insertMessage, listConversations, listMessages } from "../../src/persistence/conversations.ts";
import { createLayoutAtOldSchema } from "../helpers/old-schema.ts";
import { MAX_LOG_BYTES, appendLog } from "../../src/persistence/log.ts";
import { MIGRATIONS } from "../../src/persistence/migrations.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);

/** A database as rung 2 left it: migrations 1-3 applied and data in every table that 0004 rebuilds or points at. */
function databaseAtVersion3(): { db: Database; layoutId: string; changeSetId: string; revisionId: string } {
  const db = new Database(":memory:", { strict: true });
  db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  for (const m of MIGRATIONS.slice(0, 3)) {
    db.exec(m.sql);
    db.query("INSERT INTO schema_migrations VALUES (?, ?, 0)").run(m.version, m.name);
  }
  db.run("PRAGMA foreign_keys = ON");
  const created = createLayoutAtOldSchema(db, { name: "old", layout, summary: "import" });
  const changeSetId = "cs_old";
  db.query(
    `INSERT INTO change_sets (id, layout_id, base_revision_id, proposal_group, source, ops, explanation, tradeoffs, validation, status, created_at, decided_at)
     VALUES (?, ?, ?, 'pg_x', 'editor', '[]', 'kept', '{"gains":["g"],"costs":[]}', '{"ok":true}', 'proposed', 5, NULL)`,
  ).run(changeSetId, created.layout.id, created.revision.id);
  // A revision that points at a change set, so the rebuild has an inbound foreign key to keep.
  db.query("UPDATE revisions SET change_set_id = ? WHERE id = ?").run(changeSetId, created.revision.id);
  return { db, layoutId: created.layout.id, changeSetId, revisionId: created.revision.id };
}

describe("migration 0004", () => {
  test("adds conversations and messages and keeps existing change sets, revisions and their links", () => {
    const { db, layoutId, changeSetId, revisionId } = databaseAtVersion3();
    migrate(db);

    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("SELECT MAX(version) AS v FROM schema_migrations").get()).toEqual({ v: MIGRATIONS.length });
    const cs = findChangeSet(db, changeSetId);
    expect(cs).toMatchObject({ id: changeSetId, explanation: "kept", proposalGroup: "pg_x", status: "proposed", conversationId: null, title: null, tradeoffs: { gains: ["g"], costs: [] } });
    expect(db.query("SELECT change_set_id FROM revisions WHERE id = ?").get(revisionId)).toEqual({ change_set_id: changeSetId });

    // The new foreign key is enforced, and the old ones still are.
    db.run("PRAGMA foreign_keys = ON");
    expect(() => insertChangeSet(db, { layoutId, baseRevisionId: revisionId, source: "agent", ops: [], explanation: "e", validation: {}, status: "proposed", conversationId: "conv_missing" })).toThrow();
    const conv = insertConversation(db, { layoutId, title: "t" });
    const linked = insertChangeSet(db, { layoutId, baseRevisionId: revisionId, source: "agent", ops: [], explanation: "e", validation: {}, status: "proposed", conversationId: conv.id, title: "Card" });
    expect(linked).toMatchObject({ conversationId: conv.id, title: "Card" });
    expect(() => db.query("DELETE FROM change_sets WHERE id = ?").run(changeSetId)).toThrow(); // revisions still point at it
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("is idempotent", () => {
    const { db } = databaseAtVersion3();
    migrate(db);
    migrate(db);
    expect(db.query("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: MIGRATIONS.length });
  });
});

describe("conversation repository", () => {
  test("stores content blocks exactly and lists messages in order", () => {
    const { db, layoutId } = databaseAtVersion3();
    migrate(db);
    db.run("PRAGMA foreign_keys = ON");
    const conv = insertConversation(db, { layoutId, title: "t" });
    const thinking = { type: "thinking", thinking: "hm", signature: "sig==" };
    insertMessage(db, { conversationId: conv.id, role: "user", content: [{ type: "text", text: "a" }], selection: { layerId: "layer-0", positions: [1] } });
    insertMessage(db, { conversationId: conv.id, role: "assistant", content: [thinking, { type: "text", text: "b" }] });
    const messages = listMessages(db, conv.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content[0]).toEqual(thinking);
    expect(messages[0]?.selection).toEqual({ layerId: "layer-0", positions: [1] });
    expect(findConversation(db, conv.id)?.title).toBe("t");
    expect(listConversations(db, layoutId)).toHaveLength(1);
    expect(() => insertMessage(db, { conversationId: "conv_missing", role: "user", content: [] })).toThrow();
  });
});

describe("the log file", () => {
  test("rotates at 10 MB and keeps five files", () => {
    const dir = tempDir();
    const logs = join(dir, "logs");
    appendLog(dir, { n: 0 });
    for (let i = 1; i <= 7; i++) {
      writeFileSync(join(logs, "keyloom.log"), "x".repeat(MAX_LOG_BYTES));
      appendLog(dir, { n: i });
    }
    expect(readdirSync(logs).sort()).toEqual(["keyloom.log", "keyloom.log.1", "keyloom.log.2", "keyloom.log.3", "keyloom.log.4"]);
    expect(existsSync(join(logs, "keyloom.log.5"))).toBe(false);
  });
});
