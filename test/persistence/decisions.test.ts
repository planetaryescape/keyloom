import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { migrate } from "../../src/persistence/db.ts";
import { findChangeSet, insertChangeSet } from "../../src/persistence/change-sets.ts";
import { insertConversation, insertMessage } from "../../src/persistence/conversations.ts";
import {
  findDecision, insertPriority, listConversationPriorities, listDecisions, updateDecision,
} from "../../src/persistence/decisions.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { MIGRATIONS } from "../../src/persistence/migrations.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const board = await moonlander();
const { layout } = await importOryxSource(FIXTURE_DIR, board.definition);

/** A database as rung 3 left it: migrations 1-4 applied and data in the tables a decision points at. */
function databaseAtVersion4() {
  const db = new Database(":memory:", { strict: true });
  db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  for (const m of MIGRATIONS.slice(0, 4)) {
    db.exec(m.sql);
    db.query("INSERT INTO schema_migrations VALUES (?, ?, 0)").run(m.version, m.name);
  }
  db.run("PRAGMA foreign_keys = ON");
  const created = createLayout(db, { name: "old", layout, summary: "import", origin: "import" });
  const conversation = insertConversation(db, { layoutId: created.layout.id, title: "talk" });
  const message = insertMessage(db, { conversationId: conversation.id, role: "user", content: [{ type: "text", text: "keep Backspace" }] });
  const changeSet = insertChangeSet(db, {
    layoutId: created.layout.id, baseRevisionId: created.revision.id, source: "agent", ops: [], explanation: "kept", validation: { ok: true },
    status: "proposed", conversationId: conversation.id, title: "Card",
  });
  return { db, layoutId: created.layout.id, conversationId: conversation.id, messageId: message.id, changeSetId: changeSet.id, revisionId: created.revision.id };
}

describe("migration 0005", () => {
  test("adds decisions to a database at version 4 and leaves every existing row and foreign key intact", () => {
    const { db, layoutId, conversationId, changeSetId, revisionId } = databaseAtVersion4();
    const before = {
      change: findChangeSet(db, changeSetId),
      revisions: db.query("SELECT * FROM revisions ORDER BY id").all(),
      messages: db.query("SELECT * FROM messages ORDER BY id").all(),
    };

    migrate(db);

    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("SELECT MAX(version) AS v FROM schema_migrations").get()).toEqual({ v: 5 });
    expect(findChangeSet(db, changeSetId)).toEqual(before.change);
    expect(db.query("SELECT * FROM revisions ORDER BY id").all()).toEqual(before.revisions);
    expect(db.query("SELECT * FROM messages ORDER BY id").all()).toEqual(before.messages);

    // The new table enforces its foreign keys and its checks.
    db.run("PRAGMA foreign_keys = ON");
    expect(() => insertPriority(db, { layoutId: "lay_missing", priorityKind: "pinned", subject: { functions: ["key:BACKSPACE"] }, goal: "g", choice: "c", reason: "r" })).toThrow();
    expect(() => insertPriority(db, { layoutId, priorityKind: "pinned", subject: {}, goal: "g", choice: "c", reason: "r", conversationId: "conv_missing" })).toThrow();
    expect(() => db.query("INSERT INTO decisions (id, layout_id, kind, subject, goal, choice, reason, scope, status, source_message_ids, created_at, updated_at) VALUES ('d', ?, 'whim', '{}', 'g', 'c', 'r', '{}', 'hypothesis', '[]', 1, 1)").run(layoutId)).toThrow();
    const ok = insertPriority(db, { layoutId, priorityKind: "pinned", subject: { functions: ["key:BACKSPACE"] }, goal: "keep Backspace", choice: "c", reason: "r", conversationId });
    expect(ok.id).toMatch(/^dec_/);
    expect(db.query("SELECT 1 FROM revisions WHERE id = ?").get(revisionId)).toBeTruthy();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("is idempotent", () => {
    const { db } = databaseAtVersion4();
    migrate(db);
    migrate(db);
    expect(db.query("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: MIGRATIONS.length });
  });
});

describe("decision repository", () => {
  function fresh() {
    const base = databaseAtVersion4();
    migrate(base.db);
    base.db.run("PRAGMA foreign_keys = ON");
    return base;
  }

  test("stores a priority with its subject, the message it came from and a hypothesis status", () => {
    const { db, layoutId, conversationId, messageId } = fresh();
    const row = insertPriority(db, {
      layoutId, priorityKind: "rarely_used", subject: { functions: ["key:CAPS_LOCK"], slots: [{ layerId: "layer-0", position: 28 }] },
      goal: "I barely use Caps Lock", choice: "Rarely used", reason: "stated by BK", conversationId, sourceMessageIds: [messageId],
    });
    expect(findDecision(db, row.id)).toEqual(row);
    expect(row).toMatchObject({
      kind: "priority", priorityKind: "rarely_used", status: "hypothesis", conversationId, sourceMessageIds: [messageId], changeSetId: null,
      scope: { apps: [], habits: [] }, subject: { functions: ["key:CAPS_LOCK"], slots: [{ layerId: "layer-0", position: 28 }] },
    });
  });

  test("lists newest first, filters by kind and status, and hides retired ones from the active view", () => {
    const { db, layoutId, conversationId } = fresh();
    const a = insertPriority(db, { layoutId, priorityKind: "pinned", subject: { functions: ["key:A"] }, goal: "a", choice: "c", reason: "r", conversationId, now: 1 });
    const b = insertPriority(db, { layoutId, priorityKind: "frequent", subject: { functions: ["key:B"] }, goal: "b", choice: "c", reason: "r", conversationId, now: 2 });
    updateDecision(db, a.id, { status: "retired" });

    expect(listDecisions(db, layoutId).map((d) => d.id)).toEqual([b.id, a.id]);
    expect(listDecisions(db, layoutId, { active: true }).map((d) => d.id)).toEqual([b.id]);
    expect(listDecisions(db, layoutId, { status: "retired" }).map((d) => d.id)).toEqual([a.id]);
    expect(listDecisions(db, layoutId, { kind: "choice" })).toEqual([]);
    expect(listConversationPriorities(db, conversationId).map((d) => d.id)).toEqual([b.id]);
  });

  test("edits text fields and stamps updated_at", () => {
    const { db, layoutId } = fresh();
    const row = insertPriority(db, { layoutId, priorityKind: "pinned", subject: { functions: ["key:A"] }, goal: "a", choice: "c", reason: "r", now: 5 });
    updateDecision(db, row.id, { reason: "new reason", goal: "new goal" }, 9);
    expect(findDecision(db, row.id)).toMatchObject({ reason: "new reason", goal: "new goal", choice: "c", createdAt: 5, updatedAt: 9 });
  });
});
