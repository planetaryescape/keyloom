// The adapter behind the editor's write routes, over a real database with BK's imported layout.
import { afterEach, describe, expect, test } from "bun:test";
import { type App, closeApp, getLayout, importLayout, layoutExportDocument, listChanges, openApp, proposeChange, removeKeyboard } from "../../src/app/index.ts";
import { appEditorBackend } from "../../src/cli/editor-backend.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { deepEqual } from "../../src/layout/equal.ts";
import { EditorError } from "../../src/server/editor-backend.ts";
import { createBuild, finishBuild, newBuildId } from "../../src/persistence/builds.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { setKey } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";

const F17: ChangeOp[] = setKey(6, "F17");
// QMK can't tap a modified key from a mod-tap (07 qmk_modtap_basic).
const MODDED_TAP: ChangeOp[] = [{
  op: "setBinding",
  at: { layerId: "layer-0", position: 6 },
  binding: { kind: "holdTap", tap: { code: "A", mods: ["LSFT"] }, hold: { mods: ["LCTL"] }, profileId: "mod-tap" },
}];

let app: App | undefined;
afterEach(() => {
  if (app) closeApp(app);
  app = undefined;
});

async function setup() {
  app = openApp({ dataDir: tempDir() });
  const imported = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
  return { app, backend: appEditorBackend(app), head: imported.revisionId };
}

async function editorError(promise: Promise<unknown>): Promise<EditorError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(EditorError);
  return err as EditorError;
}

describe("appEditorBackend", () => {
  test("a build that fails the same way every time carries lastBuilt to the page, so Go back shows in the real app (R5-02, PR #297 review)", async () => {
    const { app, backend, head } = await setup();
    const layoutId = getLayout(app, "synchronized").layout.id;
    const built = newBuildId();
    createBuild(app.db, { id: built, revisionId: head, layoutId, boardRevision: "revb", logPath: `logs/build-${built}.log` });
    finishBuild(app.db, built, { artifactPath: `artifacts/${built}.bin` });
    const applied = await backend.apply("synchronized", { baseRevisionId: head, ops: F17, summary: "Layer 0, key 7: F17" });
    const failed = newBuildId();
    createBuild(app.db, { id: failed, revisionId: applied.revisionId, layoutId, boardRevision: "revb", logPath: `logs/build-${failed}.log` });
    finishBuild(app.db, failed, { error: "keymap.c: error", errorCode: "compile_error" });
    const view = await backend.getBuild(failed);
    expect(view?.lastBuilt).toEqual({ revisionId: head, summary: getLayout(app, "synchronized", head).revision.summary });
    // restartEngine is only looked up for an engine code, so a compile error carries null without asking Docker.
    expect(view?.restartEngine).toBeNull();
  });

  test("check, apply and undo a one-key change", async () => {
    const { app, backend, head } = await setup();
    expect((await backend.check("synchronized", { baseRevisionId: head, ops: F17 })).ok).toBe(true);

    const applied = await backend.apply("synchronized", { baseRevisionId: head, ops: F17, summary: "Layer 0, key 7: F17" });
    expect(getLayout(app, "synchronized").document.layers[0]?.bindings[6]).toEqual({ kind: "key", code: "F17" });

    const undone = await backend.undo("synchronized", { revisionId: applied.revisionId });
    expect(undone.revisionId).not.toBe(applied.revisionId);
    expect(getLayout(app, "synchronized").document.layers[0]?.bindings[6]).toEqual({ kind: "key", code: "F16" });
  });

  test("invalid ops are a 409 that carries the validation result", async () => {
    const { backend, head } = await setup();
    const err = await editorError(backend.apply("synchronized", { baseRevisionId: head, ops: MODDED_TAP, summary: "bad" }));
    expect(err.status).toBe(409);
    expect(err.code).toBe("validation_failed");
    expect(err.validation?.errors.map((e) => e.code)).toContain("qmk_modtap_basic");
  });

  test("undoing a revision that is no longer the head is a 409 stale_base", async () => {
    const { backend, head } = await setup();
    await backend.apply("synchronized", { baseRevisionId: head, ops: F17, summary: "Layer 0, key 7: F17" });
    const err = await editorError(backend.undo("synchronized", { revisionId: head }));
    expect([err.status, err.code]).toEqual([409, "stale_base"]);
  });

  test("an unknown layout is a 404 for writes and null for build and flash reads", async () => {
    const { backend, head } = await setup();
    const err = await editorError(backend.check("nope", { baseRevisionId: head, ops: F17 }));
    expect([err.status, err.code]).toEqual([404, "not_found"]);
    expect(await backend.getBuild("bld_nope")).toBeNull();
    expect(await backend.getFlash("fl_nope")).toBeNull();
  });

  test("exportLayout returns the portable document, and an unknown layout is a 404", async () => {
    const { app, backend, head } = await setup();
    const document = await backend.exportLayout("synchronized");
    expect(document).toMatchObject({ kind: "keyloom-layout", schema_version: 1, board_id: "zsa/moonlander", layout_name: "synchronized", revision_id: head });
    expect(deepEqual(document.layout, getLayout(app, "synchronized").document)).toBe(true);
    const err = await editorError(backend.exportLayout("nope"));
    expect([err.status, err.code]).toEqual([404, "not_found"]);
  });
});

describe("applyChangeSet", () => {
  test("applies a stored proposal as an agent revision and supersedes its siblings", async () => {
    const { app, backend, head } = await setup();
    const group = "turn-1";
    const a = proposeChange(app, "synchronized", { ops: F17, explanation: "F17 on key 7", source: "agent", proposalGroup: group });
    const b = proposeChange(app, "synchronized", { ops: setKey(6, "F18"), explanation: "F18 on key 7", source: "agent", proposalGroup: group });

    const applied = await backend.applyChangeSet(a.id);
    expect(applied.changeSetId).toBe(a.id);
    expect(applied.revisionId).not.toBe(head);
    expect(getLayout(app, "synchronized").document.layers[0]?.bindings[6]).toEqual({ kind: "key", code: "F17" });
    expect(Object.fromEntries(listChanges(app, "synchronized").map((c) => [c.id, c.status]))).toMatchObject({ [a.id]: "applied", [b.id]: "superseded" });
  });

  test("maps the app's errors: unknown 404, already applied 400, moved-on head 409 stale_base", async () => {
    const { app, backend } = await setup();
    expect((await editorError(backend.applyChangeSet("cs_nope"))).status).toBe(404);

    const a = proposeChange(app, "synchronized", { ops: F17, explanation: "F17", source: "agent" });
    const other = proposeChange(app, "synchronized", { ops: setKey(8, "F18"), explanation: "F18", source: "agent" });
    await backend.applyChangeSet(a.id);
    const again = await editorError(backend.applyChangeSet(a.id));
    // Its own code, so the page reads only this refusal as "no longer open" (R6-06).
    expect([again.status, again.code]).toEqual([400, "not_open"]);

    // `other` shares no slot with `a`, so it still applies; a proposal on a's slot does not.
    await backend.applyChangeSet(other.id);
    const clash = proposeChange(app, "synchronized", { ops: setKey(6, "F19"), explanation: "F19", source: "agent" });
    await backend.apply("synchronized", { baseRevisionId: getLayout(app, "synchronized").revision.id, ops: setKey(6, "F20"), summary: "meanwhile" });
    const stale = await editorError(backend.applyChangeSet(clash.id));
    expect([stale.status, stale.code]).toEqual([409, "stale_base"]);
  });
});

// R6-08, R6-18: an import refused for a keyboard reason keeps its code and the board it names, so the import card offers Restore, or
// Import it as that board's config, instead of the CLI's sentence.
describe("import refusals the page acts on", () => {
  test("a keyloom export for another board names that board", async () => {
    const { app, backend } = await setup();
    const document = new TextEncoder().encode(JSON.stringify(layoutExportDocument(app, getLayout(app, "synchronized").layout.id)));
    const refused = await backend.importUpload({ board: "moergo/glove80", filename: "layout.json", bytes: document }).then(() => null, (err: unknown) => err);
    expect(refused).toBeInstanceOf(EditorError);
    expect(refused).toMatchObject({ status: 400, code: "layout_for_other_board", board: "zsa/moonlander" });
  });

  test("a removed keyboard's import is refused with keyboard_removed", async () => {
    const { app, backend } = await setup();
    const document = new TextEncoder().encode(JSON.stringify(layoutExportDocument(app, getLayout(app, "synchronized").layout.id)));
    removeKeyboard(app, "zsa/moonlander");
    const refused = await backend.importUpload({ board: "zsa/moonlander", filename: "layout.json", bytes: document }).then(() => null, (err: unknown) => err);
    expect(refused).toMatchObject({ status: 400, code: "keyboard_removed", board: "zsa/moonlander" });
  });
});

// R11-01: the page shows the Karabiner edit and the warnings the CLI prints, so the import answer carries them.
describe("a Karabiner import's answer", () => {
  test("carries the edit that frees the built-in keyboard and the importer's warnings", async () => {
    const { backend } = await setup();
    const bytes = new Uint8Array(await Bun.file(new URL("../fixtures/karabiner/synthetic-karabiner.json", import.meta.url)).arrayBuffer());
    const answer = await backend.importUpload({ board: "apple/macbook-ansi", filename: "karabiner.json", bytes });
    expect(answer.karabinerEdit?.entry).toBe('{ "identifiers": { "is_keyboard": true, "product_id": 0, "vendor_id": 0 }, "ignore": true }');
    expect(answer.karabinerEdit?.unimported).toBeGreaterThanOrEqual(0);
    expect(answer.warnings.length).toBeGreaterThan(0);
    // The entry is valid JSON, so it pastes into karabiner.json as it is.
    expect(JSON.parse(answer.karabinerEdit?.entry ?? "")).toEqual({ identifiers: { is_keyboard: true, product_id: 0, vendor_id: 0 }, ignore: true });
  });

  // R12-07: the note offers Open Karabiner-Elements only where the app is installed.
  test("says whether Karabiner-Elements is installed, so the note's Open button opens something", async () => {
    const bytes = new Uint8Array(await Bun.file(new URL("../fixtures/karabiner/synthetic-karabiner.json", import.meta.url)).arrayBuffer());
    for (const installed of [true, false]) {
      app = openApp({ dataDir: tempDir() });
      const answer = await appEditorBackend(app, {}, undefined, {}, () => installed).importUpload({ board: "apple/macbook-ansi", filename: "karabiner.json", bytes });
      expect(answer.karabinerEdit?.appInstalled).toBe(installed);
    }
  });

  test("another board's import carries no Karabiner edit", async () => {
    const { app, backend } = await setup();
    const document = new TextEncoder().encode(JSON.stringify(layoutExportDocument(app, getLayout(app, "synchronized").layout.id)));
    const answer = await backend.importUpload({ board: "zsa/moonlander", filename: "layout.json", bytes: document });
    expect(answer.karabinerEdit).toBeUndefined();
  });
});
