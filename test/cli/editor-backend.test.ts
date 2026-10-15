// The adapter behind the editor's write routes, over a real database with BK's imported layout.
import { afterEach, describe, expect, test } from "bun:test";
import { type App, closeApp, getLayout, importLayout, openApp } from "../../src/app/index.ts";
import { appEditorBackend } from "../../src/cli/editor-backend.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { EditorError } from "../../src/server/editor-backend.ts";
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
});
