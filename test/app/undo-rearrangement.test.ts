// Rung 4's promise: applying a multi-key rearrangement and undoing it puts every key back in one step.
// It runs on BK's real Moonlander import (the Oryx fixture), not a toy layout.
import { describe, expect, test } from "bun:test";
import {
  type App, type ChangeOp, applyChange, getLayout, importLayout, listChanges, openApp, proposeChange, undo,
} from "../../src/app/index.ts";
import { deepEqual } from "../../src/layout/equal.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

async function setup(): Promise<{ app: App; ref: string; base: string }> {
  const app = openApp({ dataDir: tempDir() });
  const out = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
  return { app, ref: out.layoutId, base: out.revisionId };
}

const at = (position: number) => ({ layerId: "layer-0", position });

// Command-Shift replaces Tab at key 43 (Tab is still on the hold-tap at key 68, so nothing is lost),
// and the X, C, V keys beside it rotate one place so the row stays together: four functions move.
const REARRANGE: ChangeOp[] = [
  { op: "setBinding", at: at(42), binding: { kind: "modifier", mods: ["LGUI", "LSFT"] } },
  { op: "swapBindings", a: at(44), b: at(45) },
  { op: "swapBindings", a: at(45), b: at(46) },
];

describe("undo after a multi-key rearrangement", () => {
  test("moves at least three keys in one revision and one undo restores every one of them", async () => {
    const { app, ref, base } = await setup();
    const original = getLayout(app, ref).document;

    const cs = proposeChange(app, ref, { ops: REARRANGE, explanation: "Command-Shift on key 43", source: "agent" });
    expect(cs.validation.ok).toBe(true);
    expect(cs.validation.diff.changed.length).toBeGreaterThanOrEqual(3);
    expect(cs.validation.diff.relearnCount).toBeGreaterThanOrEqual(3);

    const applied = applyChange(app, cs.id);
    const after = getLayout(app, ref);
    expect(after.revision).toMatchObject({ id: applied.revisionId, parentId: base });
    const row = after.document.layers[0]?.bindings;
    expect(row?.[42]).toEqual({ kind: "modifier", mods: ["LGUI", "LSFT"] });
    expect([44, 45, 46].map((p) => (row?.[p] as { code?: string }).code)).toEqual(["C", "V", "X"]);
    expect(deepEqual(after.document, original)).toBe(false);

    // One undo, one new revision, and the document is the original again.
    const undone = undo(app, ref, { revisionId: applied.revisionId });
    const restored = getLayout(app, ref);
    expect(restored.revision).toMatchObject({ id: undone.revision.id, origin: "undo", parentId: applied.revisionId });
    expect(deepEqual(restored.document, original)).toBe(true);
    expect(restored.document.layers[0]?.bindings[42]).toEqual({ kind: "key", code: "TAB" });
    expect(listChanges(app, ref, { status: "applied" })).toHaveLength(1);
  });
});
