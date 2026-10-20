// Configs and versions as use cases (25, D-300, D-301): making, renaming, archiving and deleting configs, and the version history,
// going back and comparing. The sync engine's side is in configs-sync.test.ts.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  type App, NotFoundError, UsageError, ValidationFailedError, applyOps, archiveConfig, blankDocument, compareRevision, deleteConfig, getLayout, importLayout, listConfigs,
  listRevisions, newConfig, newConfigFromImport, nameVersion, openApp, proposeChange, recordPriority, renameConfig, resolveRevision, restoreConfig, restoreVersion, showConfig, versionHistory,
} from "../../src/app/index.ts";
import { diffLayouts } from "../../src/layout/diff.ts";
import { deepEqual } from "../../src/layout/equal.ts";
import { createBuild, createFlash, finishBuild, finishFlash, newBuildId, newFlashId } from "../../src/persistence/builds.ts";
import { getBoardConfig } from "../../src/persistence/configs.ts";
import { insertConversation } from "../../src/persistence/conversations.ts";
import { findRevision } from "../../src/persistence/layouts.ts";
import { appendRevision } from "../../src/persistence/revisions.ts";
import { claimSync, finishSync, newSyncId } from "../../src/persistence/syncs.ts";
import { listVersionRows } from "../../src/persistence/versions.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { setKey } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";

const BOARD = "zsa/moonlander";

async function setup(): Promise<{ app: App; ref: string; revisions: string[] }> {
  const app = openApp({ dataDir: tempDir() });
  const out = await importLayout(app, { board: BOARD, source: FIXTURE_DIR, name: "QWERTY" });
  const revisions = [out.revisionId];
  for (const code of ["F17", "F18", "F19"]) revisions.push(edit(app, out.layoutId, code));
  return { app, ref: out.layoutId, revisions };
}

function edit(app: App, ref: string, code: string): string {
  const head = getLayout(app, ref).revision.id;
  return applyOps(app, ref, { baseRevisionId: head, ops: setKey(6, code), summary: `Layer 0, key 7: ${code}` }).revisionId;
}

/** A sync of `revisionId` that verified, written the way the engine finishes one. */
function verified(app: App, layoutId: string, revisionId: string, at: number): string {
  const id = newSyncId();
  claimSync(app.db, { id, boardId: BOARD, layoutId, revisionId, boardRevision: "reva", trigger: "manual", logPath: "l", appliedAt: at - 10, owner: "t", now: at - 5 }, () => false);
  finishSync(app.db, id, { status: "succeeded" }, at);
  return id;
}

const key6 = (app: App, ref: string) => getLayout(app, ref).document.layers[0]?.bindings[6];

describe("making a config", () => {
  test("the first config of a board is the one on its keyboard, and the next is not", async () => {
    const { app, ref } = await setup();
    const copy = newConfig(app, { name: "Colemak", from: "config", config: ref });
    expect(getBoardConfig(app.db, BOARD)).toBe(ref);
    expect(copy.onKeyboard).toBe(false);
    expect(listConfigs(app).map((c) => [c.name, c.onKeyboard]).sort()).toEqual([["Colemak", false], ["QWERTY", true]]);
  });

  test("a copy of the current config holds its head document, starts its own history there and links back", async () => {
    const { app, ref, revisions } = await setup();
    const copy = newConfig(app, { name: "Colemak", from: "config", config: ref });
    const view = getLayout(app, copy.id);
    expect(deepEqual(view.document, getLayout(app, ref).document)).toBe(true);
    expect(listRevisions(app, copy.id)).toHaveLength(1);
    expect(view.revision.parentId).toBeNull();
    expect(view.revision.id).not.toBe(revisions[3]);
    expect(copy.copiedFrom).toEqual({ layoutId: ref, layoutName: "QWERTY", revisionId: revisions[3] as string });
    // The copy is its own document: editing it leaves the original alone.
    edit(app, copy.id, "F5");
    expect(key6(app, ref)).toEqual({ kind: "key", code: "F19" });
  });

  test("from any revision, or from a version, copies that revision's document", async () => {
    const { app, ref, revisions } = await setup();
    const fromRevision = newConfig(app, { name: "Old", from: "config", config: ref, revision: revisions[1] as string });
    expect(key6(app, fromRevision.id)).toEqual({ kind: "key", code: "F17" });
    expect(fromRevision.copiedFrom?.revisionId).toBe(revisions[1] as string);

    const named = nameVersion(app, ref, revisions[2] as string, "before the tweak");
    const fromVersion = newConfig(app, { name: "FromVersion", from: "config", config: ref, version: named?.id as string });
    expect(key6(app, fromVersion.id)).toEqual({ kind: "key", code: "F18" });
    expect(fromVersion.copiedFrom?.revisionId).toBe(revisions[2] as string);
  });

  test("a revision or version of another config is not found", async () => {
    const { app, ref, revisions } = await setup();
    const other = newConfig(app, { name: "Other", from: "config", config: ref });
    expect(() => newConfig(app, { name: "x", from: "config", config: other.id, revision: revisions[1] as string })).toThrow(NotFoundError);
    const v = nameVersion(app, ref, revisions[1] as string, "mine");
    expect(() => newConfig(app, { name: "x", from: "config", config: other.id, version: v?.id as string })).toThrow(NotFoundError);
    expect(() => newConfig(app, { name: "x", from: "config", config: ref, revision: revisions[1] as string, version: v?.id as string })).toThrow(UsageError);
  });

  test("from blank is a document the board accepts: one empty Base layer sized to the board", async () => {
    const { app } = await setup();
    const blank = newConfig(app, { name: "Steno", from: "blank", board: BOARD });
    const view = getLayout(app, blank.id);
    expect(view.document.layers).toHaveLength(1);
    expect(view.document.layers[0]?.bindings).toHaveLength(view.board.definition.keyCount);
    expect(view.document.layers[0]?.bindings.every((b) => b.kind === "none")).toBe(true);
    expect(blank.copiedFrom).toBeNull();
    // It can be edited like any config: the rules that check a change accept the first key.
    const head = view.revision.id;
    expect(() => applyOps(app, blank.id, { baseRevisionId: head, ops: [{ op: "setBinding", at: { layerId: "base", position: 0 }, binding: { kind: "key", code: "Q" } }], summary: "Q" })).not.toThrow();
  });

  test("from an import is the import with the config's name, never on the keyboard of a board that has one", async () => {
    const { app, ref } = await setup();
    const made = await newConfigFromImport(app, { name: "Fresh import", board: BOARD, source: FIXTURE_DIR });
    expect(made.config).toMatchObject({ name: "Fresh import", boardId: BOARD, onKeyboard: false, copiedFrom: null });
    expect(made.report.layers).toBeGreaterThan(1);
    expect(getLayout(app, made.config.id).revision.origin).toBe("import");
    expect(getBoardConfig(app.db, BOARD)).toBe(ref);
    await expect(newConfigFromImport(app, { name: "Fresh import", board: BOARD, source: FIXTURE_DIR })).rejects.toThrow(/already exists; pick another name/);
    await expect(newConfigFromImport(app, { name: "lay_x", board: BOARD, source: FIXTURE_DIR })).rejects.toThrow(/lay_/);
    await expect(newConfigFromImport(app, { name: "Gone", board: BOARD, source: "/nope/nothing" })).rejects.toThrow(UsageError);
  });

  test("blank for a software remapper is the identity map, so putting it on doesn't silence the laptop", () => {
    const doc = blankDocument("apple/macbook-ansi");
    expect(doc.firmware).toBe("kanata");
    expect(doc.layers[0]?.bindings.some((b) => b.kind === "none")).toBe(false);
  });

  test("a name must be unique, non-empty and not shaped like an ID", async () => {
    const { app, ref } = await setup();
    expect(() => newConfig(app, { name: "QWERTY", from: "config", config: ref })).toThrow(/already exists/);
    expect(() => newConfig(app, { name: "   ", from: "config", config: ref })).toThrow(UsageError);
    expect(() => newConfig(app, { name: "lay_abc", from: "config", config: ref })).toThrow(UsageError);
    expect(listConfigs(app)).toHaveLength(1);
  });
});

describe("rename, archive and delete", () => {
  test("rename keeps the ID, refuses a name in use and trims", async () => {
    const { app, ref } = await setup();
    const other = newConfig(app, { name: "Colemak", from: "config", config: ref });
    expect(renameConfig(app, ref, "  QWERTY (home)  ").name).toBe("QWERTY (home)");
    expect(showConfig(app, ref).id).toBe(ref);
    expect(() => renameConfig(app, other.id, "QWERTY (home)")).toThrow(UsageError);
    expect(showConfig(app, other.id).name).toBe("Colemak");
  });

  test("archiving hides a config, keeps its history, and restoring brings it back", async () => {
    const { app, ref, revisions } = await setup();
    const other = newConfig(app, { name: "Colemak", from: "config", config: ref });
    edit(app, other.id, "F5");
    archiveConfig(app, other.id);
    expect(listConfigs(app).map((c) => c.name)).toEqual(["QWERTY"]);
    expect(listConfigs(app, { includeArchived: true }).map((c) => c.name).sort()).toEqual(["Colemak", "QWERTY"]);
    expect(listRevisions(app, other.id)).toHaveLength(2);
    restoreConfig(app, other.id);
    expect(listConfigs(app).map((c) => c.name).sort()).toEqual(["Colemak", "QWERTY"]);
    expect(showConfig(app, other.id).archivedAt).toBeNull();
    expect(revisions).toHaveLength(4);
  });

  test("the config on the keyboard can be neither archived nor deleted", async () => {
    const { app, ref } = await setup();
    expect(() => archiveConfig(app, ref)).toThrow(/put another on/);
    expect(() => deleteConfig(app, ref, "QWERTY")).toThrow(/put another on/);
    expect(listConfigs(app)).toHaveLength(1);
  });

  test("delete needs the name typed exactly", async () => {
    const { app, ref } = await setup();
    const other = newConfig(app, { name: "Colemak", from: "config", config: ref });
    expect(() => deleteConfig(app, other.id, "colemak")).toThrow(/type the config's name/);
    expect(() => deleteConfig(app, other.id, "")).toThrow(UsageError);
    expect(showConfig(app, other.id).name).toBe("Colemak");
    expect(deleteConfig(app, "Colemak", "Colemak")).toEqual({ id: other.id, name: "Colemak" });
    expect(() => showConfig(app, other.id)).toThrow(NotFoundError);
  });

  test("delete removes everything that hangs off the config and nothing of the others", async () => {
    const { app, ref, revisions } = await setup();
    const other = newConfig(app, { name: "Colemak", from: "config", config: ref });
    const head = edit(app, other.id, "F5");
    verified(app, ref, revisions[3] as string, 1000);
    // Everything a config can own: a proposal, a remembered priority, a conversation, a build with a flash, a verified sync and a name.
    proposeChange(app, other.id, { ops: setKey(6, "F6"), explanation: "try F6", source: "agent" });
    recordPriority(app, other.id, { priorityKind: "pinned", statement: "keep F5", subject: { functions: ["key:F5"] } });
    insertConversation(app.db, { layoutId: other.id, title: "talk" });
    const build = newBuildId();
    createBuild(app.db, { id: build, revisionId: head, layoutId: other.id, boardRevision: "reva", logPath: "l" });
    finishBuild(app.db, build, { artifactPath: "a" });
    const flash = newFlashId();
    createFlash(app.db, { id: flash, buildId: build, logPath: "l" });
    finishFlash(app.db, flash, null);
    nameVersion(app, other.id, head, "named");
    mkdirSync(join(app.dataDir as string, "builds", other.id), { recursive: true });
    app.db.query("INSERT INTO typing_sessions (id, layout_id, revision_id, board_id, firmware, started_at, ended_at, passage_id, passage, typed_text, events, warnings) VALUES ('sess-1', ?, ?, 'zsa/moonlander', 'qmk', 100, 200, 'p1', 'hello', 'hello', '[]', '[]')").run(other.id, head);

    const tables = ["layouts", "revisions", "change_sets", "decisions", "conversations", "builds", "flashes", "syncs", "versions"] as const;
    const count = (t: string) => (app.db.query(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const before = Object.fromEntries(tables.map((t) => [t, count(t)]));
    deleteConfig(app, other.id, "Colemak");
    const after = Object.fromEntries(tables.map((t) => [t, count(t)]));
    expect(after).toEqual({ ...before, layouts: 1, revisions: 4, change_sets: before.change_sets! - 2, decisions: 0, conversations: 0, builds: 0, flashes: 0, versions: 1 });
    expect(existsSync(join(app.dataDir as string, "builds", other.id))).toBe(false);
    expect(app.db.query("SELECT COUNT(*) AS n FROM typing_sessions WHERE layout_id = ?").get(other.id)).toEqual({ n: 0 });
    expect(app.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(listRevisions(app, ref)).toHaveLength(4);
  });

  test("a copy survives the deletion of the config it came from, and says where it came from", async () => {
    const { app, ref } = await setup();
    const a = newConfig(app, { name: "A", from: "config", config: ref });
    const b = newConfig(app, { name: "B", from: "config", config: a.id });
    deleteConfig(app, a.id, "A");
    expect(showConfig(app, b.id).copiedFrom).toMatchObject({ layoutId: a.id, layoutName: null });
  });

  test("a config a sync is using can't be deleted", async () => {
    const { app, ref, revisions } = await setup();
    const other = newConfig(app, { name: "Colemak", from: "config", config: ref });
    claimSync(app.db, { id: newSyncId(), boardId: BOARD, layoutId: other.id, revisionId: other.headRevisionId, boardRevision: "reva", trigger: "manual", logPath: "l", appliedAt: 1, owner: "t" }, () => true);
    expect(() => deleteConfig(app, other.id, "Colemak")).toThrow(/sync of Colemak is running/);
    expect(revisions).toHaveLength(4);
  });
});

describe("versions", () => {
  test("history folds the revisions between two versions under the later one, with the unsynced ones pending", async () => {
    const { app, ref, revisions } = await setup();
    verified(app, ref, revisions[1] as string, 1000);
    verified(app, ref, revisions[3] as string, 2000);
    const extra = edit(app, ref, "F5");
    const h = versionHistory(app, ref);
    expect(h.pending.map((r) => r.id)).toEqual([extra]);
    expect(h.versions.map((m) => m.version.revisionId)).toEqual([revisions[3] as string, revisions[1] as string]);
    expect(h.versions[0]?.revisions.map((r) => r.id)).toEqual([revisions[2] as string]);
    expect(h.versions[1]?.revisions.map((r) => r.id)).toEqual([revisions[0] as string]);
    expect(h.versions.map((m) => [m.version.putOnAt, m.version.endedAt])).toEqual([[2000, null], [1000, 2000]]);
    expect(h.versions[0]?.version.current).toBe(true);
    expect(h.versions[1]?.version.current).toBe(false);
  });

  test("every revision lands in exactly one place", async () => {
    const { app, ref, revisions } = await setup();
    verified(app, ref, revisions[2] as string, 1000);
    nameVersion(app, ref, revisions[0] as string, "the import");
    const h = versionHistory(app, ref);
    const seen = [...h.pending.map((r) => r.id), ...h.versions.flatMap((m) => [m.version.revisionId, ...m.revisions.map((r) => r.id)])];
    expect(seen.sort()).toEqual([...revisions].sort());
  });

  test("any revision can be named without being put on a keyboard, and the name can be removed", async () => {
    const { app, ref, revisions } = await setup();
    const named = nameVersion(app, ref, revisions[1] as string, "  before the HRM tweak ");
    expect(named).toMatchObject({ name: "before the HRM tweak", putOnAt: null, endedAt: null, current: false });
    expect(resolveRevision(app, getLayout(app, ref).layout, "before the HRM tweak")).toBe(revisions[1] as string);
    expect(nameVersion(app, ref, "before the HRM tweak", "")).toBeNull();
    expect(versionHistory(app, ref).versions).toEqual([]);
  });

  test("naming a version that went on a keyboard keeps when it went on", async () => {
    const { app, ref, revisions } = await setup();
    verified(app, ref, revisions[2] as string, 1000);
    const named = nameVersion(app, ref, revisions[2] as string, "week one");
    expect(named).toMatchObject({ name: "week one", putOnAt: 1000 });
    // Removing the name leaves the version, because it really did go on the keyboard.
    expect(nameVersion(app, ref, revisions[2] as string, "")).toMatchObject({ name: null, putOnAt: 1000 });
  });

  test("a revision put on again moves its put-on time and reopens it, and the name stays", async () => {
    const { app, ref, revisions } = await setup();
    verified(app, ref, revisions[1] as string, 1000);
    nameVersion(app, ref, revisions[1] as string, "keeper");
    verified(app, ref, revisions[2] as string, 2000);
    verified(app, ref, revisions[1] as string, 3000);
    const rows = listVersionRows(app.db, ref);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.revisionId === revisions[1])).toMatchObject({ name: "keeper", putOnAt: 3000, endedAt: null });
    expect(rows.find((r) => r.revisionId === revisions[2])).toMatchObject({ endedAt: 3000 });
  });

  test("a version is the keyboard's, not the config's: putting on another board's layout ends it only on that board", async () => {
    const { app, ref, revisions } = await setup();
    verified(app, ref, revisions[1] as string, 1000);
    const glove = await importGlove(app);
    const id = newSyncId();
    claimSync(app.db, { id, boardId: "moergo/glove80", layoutId: glove.layoutId, revisionId: glove.revisionId, boardRevision: "x", trigger: "manual", logPath: "l", appliedAt: 1, owner: "t", now: 2000 }, () => false);
    finishSync(app.db, id, { status: "succeeded" }, 2100);
    expect(listVersionRows(app.db, ref)[0]?.endedAt).toBeNull();
  });

  test("a version or name that isn't this config's is not found", async () => {
    const { app, ref } = await setup();
    expect(() => compareRevision(app, ref, "ver_nope")).toThrow(NotFoundError);
    expect(() => compareRevision(app, ref, "rev_nope")).toThrow(NotFoundError);
    expect(() => versionHistory(app, "nope")).toThrow(NotFoundError);
  });

  test("two versions with the same name are ambiguous by name and fine by ID", async () => {
    const { app, ref, revisions } = await setup();
    const a = nameVersion(app, ref, revisions[1] as string, "same");
    nameVersion(app, ref, revisions[2] as string, "same");
    expect(() => resolveRevision(app, getLayout(app, ref).layout, "same")).toThrow(/more than one/);
    expect(resolveRevision(app, getLayout(app, ref).layout, a?.id as string)).toBe(revisions[1] as string);
  });
});

const importGlove = (app: App) => importLayout(app, { board: "moergo/glove80", source: `${import.meta.dir}/../fixtures/zmk/glove80-template`, name: "Glove" });

describe("restoring a version", () => {
  test("goes back through D-170: one new revision holding that document, validated like a go-back", async () => {
    const { app, ref, revisions } = await setup();
    const out = restoreVersion(app, ref, revisions[1] as string);
    expect(out.revision).toMatchObject({ origin: "undo", parentId: revisions[3] });
    expect(key6(app, ref)).toEqual({ kind: "key", code: "F17" });
    expect(listRevisions(app, ref)).toHaveLength(5);
  });

  test("by version ID or by name", async () => {
    const { app, ref, revisions } = await setup();
    const v = nameVersion(app, ref, revisions[1] as string, "friday");
    restoreVersion(app, ref, "friday");
    expect(key6(app, ref)).toEqual({ kind: "key", code: "F17" });
    expect(v?.id).toStartWith("ver_");
    restoreVersion(app, ref, revisions[3] as string);
    restoreVersion(app, ref, v?.id as string);
    expect(key6(app, ref)).toEqual({ kind: "key", code: "F17" });
  });

  test("restoring the current head is refused, and writes nothing", async () => {
    const { app, ref, revisions } = await setup();
    expect(() => restoreVersion(app, ref, revisions[3] as string)).toThrow(UsageError);
    expect(listRevisions(app, ref)).toHaveLength(4);
  });

  test("a version with a problem the head doesn't have is refused, as the History go-back refuses it", async () => {
    const { app, ref, revisions } = await setup();
    const view = getLayout(app, ref);
    const broken = structuredClone(view.document);
    broken.layers[0]!.bindings[6] = { kind: "key", code: "NOT_A_KEY" };
    const bad = appendRevision(app.db, { layoutId: ref, expectedHeadId: revisions[3] as string, layout: broken, origin: "editor", summary: "broken on purpose" });
    const fixed = appendRevision(app.db, { layoutId: ref, expectedHeadId: bad.id, layout: view.document, origin: "editor", summary: "fixed again" });
    nameVersion(app, ref, bad.id, "the broken one");
    expect(() => restoreVersion(app, ref, "the broken one")).toThrow(ValidationFailedError);
    expect(listRevisions(app, ref)[0]?.id).toBe(fixed.id);
  });

  test("it is not a sync: no version appears until a sync verifies, and the config on the keyboard is unchanged", async () => {
    const { app, ref, revisions } = await setup();
    restoreVersion(app, ref, revisions[0] as string);
    expect(listVersionRows(app.db, ref)).toEqual([]);
    expect(getBoardConfig(app.db, BOARD)).toBe(ref);
  });
});

describe("comparing a version with now", () => {
  test("draws the keys that differ, with what the caps print", async () => {
    const { app, ref, revisions } = await setup();
    const c = compareRevision(app, ref, revisions[0] as string);
    expect(c.from.id).toBe(revisions[0] as string);
    expect(c.to.id).toBe(revisions[3] as string);
    expect(c.diff.keys).toHaveLength(1);
    expect(c.diff.keys[0]).toMatchObject({ layerId: "layer-0", position: 6, before: { kind: "key", code: "F16" }, after: { kind: "key", code: "F19" } });
    expect(c.diff.keys[0]?.beforeLabel).not.toBe(c.diff.keys[0]?.afterLabel);
    expect(c.diff.same).toBe(false);
  });

  test("a revision equal to the head compares as the same", async () => {
    const { app, ref, revisions } = await setup();
    expect(compareRevision(app, ref, revisions[3] as string).diff).toMatchObject({ same: true, keys: [] });
  });

  test("matches going back: after the go-back the head is the compared document, and the changed keys are the ones compare named", async () => {
    const { app, ref, revisions } = await setup();
    // Change a second key so there is more than one difference to match.
    edit(app, ref, "F20");
    const headBefore = getLayout(app, ref);
    const compared = compareRevision(app, ref, revisions[1] as string);
    const target = findRevision(app.db, ref, revisions[1] as string);

    restoreVersion(app, ref, revisions[1] as string);

    const after = getLayout(app, ref);
    expect(deepEqual(after.document, target?.layout)).toBe(true);
    // What the go-back changed is what compare said: the same keys, with compare's `before` now on the board.
    const changed = diffLayouts(headBefore.document, after.document).keys;
    expect(changed.map((k) => [k.layerId, k.position])).toEqual(compared.diff.keys.map((k) => [k.layerId, k.position]));
    expect(changed.map((k) => k.after)).toEqual(compared.diff.keys.map((k) => k.before));
    // And comparing again says nothing differs from the restored revision.
    expect(compareRevision(app, ref, revisions[1] as string).diff.same).toBe(true);
  });

  test("names what changed outside the keys: layers, macros, settings and lighting", async () => {
    const { app, ref, revisions } = await setup();
    const view = getLayout(app, ref);
    const changed = structuredClone(view.document);
    changed.layers.push({ id: "extra", name: "Extra", bindings: changed.layers[0]!.bindings.map(() => ({ kind: "transparent" as const })) });
    changed.layers[1]!.name = "Renamed";
    changed.macros.push({ id: "mm", name: "Greeting", steps: [{ op: "text", text: "hi" }] });
    changed.settings.push({ firmware: "qmk", key: "tapping-term", value: 180 });
    const rev = appendRevision(app.db, { layoutId: ref, expectedHeadId: revisions[3] as string, layout: changed, origin: "editor", summary: "wide change" });
    const d = compareRevision(app, ref, revisions[3] as string).diff;
    expect(d).toMatchObject({
      layersAdded: [{ id: "extra", name: "Extra" }],
      layersRenamed: [{ from: view.document.layers[1]?.name, to: "Renamed" }],
      macros: { added: ["Greeting"], removed: [], changed: [] },
      settings: [{ key: "tapping-term", before: null, after: 180 }],
      same: false,
    });
    expect(rev.id).toBeTruthy();
  });
});
