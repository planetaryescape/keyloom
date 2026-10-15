import { describe, expect, test } from "bun:test";
import {
  type App, type ChangeOp, NotFoundError, StaleBaseError, UsageError, ValidationFailedError, applyChange, applyOps, checkChange, closeApp,
  getLayout, importLayout, listChanges, openApp, proposeChange, rejectChange, showChange, undo,
} from "../../src/app/index.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

async function setup(): Promise<{ app: App; ref: string; base: string }> {
  const app = openApp({ dataDir: tempDir() });
  const out = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
  return { app, ref: out.layoutId, base: out.revisionId };
}
const setKey = (position: number, code: string, layerId = "layer-0"): ChangeOp => ({
  op: "setBinding", at: { layerId, position }, binding: { kind: "key", code },
});
const binding = (app: App, ref: string, position: number, layerId = "layer-0") =>
  getLayout(app, ref).document.layers.find((l) => l.id === layerId)?.bindings[position];
const count = (app: App, table: string) => (app.db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const attempt = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
};

describe("applyOps (the editor path)", () => {
  test("writes a revision whose parent is the old head, moves the head, and records an applied editor change set", async () => {
    const { app, ref, base } = await setup();
    const out = applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "F17")], summary: "Layer 0, key 6: F17" });
    const view = getLayout(app, ref);
    expect(view.revision).toMatchObject({ id: out.revisionId, parentId: base, origin: "editor", summary: "Layer 0, key 6: F17" });
    expect(view.layout.headRevisionId).toBe(out.revisionId);
    expect(binding(app, ref, 6)).toEqual({ kind: "key", code: "F17" });
    expect(out.validation.diff.changed).toEqual([{ layerId: "layer-0", position: 6 }]);
    const cs = showChange(app, out.changeSetId);
    expect(cs).toMatchObject({ status: "applied", source: "editor", baseRevisionId: base, explanation: "Layer 0, key 6: F17" });
    expect(cs.validation).toEqual(out.validation);
    // The old revision is untouched: history is append-only.
    expect(getLayout(app, ref, base).document.layers[0]?.bindings[6]).toEqual({ kind: "key", code: "F16" });
    closeApp(app);
  });

  test("an invalid change throws ValidationFailedError carrying the result, and writes nothing", async () => {
    const { app, ref, base } = await setup();
    const err = attempt(() => applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "NOT_A_KEY")], summary: "bad" }));
    expect(err).toBeInstanceOf(ValidationFailedError);
    const details = (err as ValidationFailedError).details as { ok: boolean; errors: Array<{ code: string }> };
    expect(details.ok).toBe(false);
    expect(details.errors[0]?.code).toBe("firmware_unsupported");
    expect(count(app, "change_sets")).toBe(0);
    expect(count(app, "revisions")).toBe(1);
    expect(getLayout(app, ref).layout.headRevisionId).toBe(base);
    closeApp(app);
  });

  test("a failure after the change set is written rolls the whole thing back", async () => {
    const { app, ref, base } = await setup();
    app.db.run("CREATE TRIGGER boom BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT, 'boom'); END");
    expect(() => applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "F17")], summary: "s" })).toThrow(/boom/);
    expect(count(app, "change_sets")).toBe(0);
    expect(getLayout(app, ref).layout.headRevisionId).toBe(base);
    closeApp(app);
  });

  test("an empty summary is a usage error", async () => {
    const { app, ref, base } = await setup();
    expect(attempt(() => applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "F17")], summary: "  " }))).toBeInstanceOf(UsageError);
    closeApp(app);
  });
});

describe("stale bases", () => {
  test("ops on slots the head left alone apply cleanly to the new head, and keep the original base on record", async () => {
    const { app, ref, base } = await setup();
    const first = applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "F17")], summary: "one" });
    const second = applyOps(app, ref, { baseRevisionId: base, ops: [setKey(1, "F5")], summary: "two" });
    expect(getLayout(app, ref).revision).toMatchObject({ id: second.revisionId, parentId: first.revisionId });
    expect(binding(app, ref, 6)).toEqual({ kind: "key", code: "F17" });
    expect(binding(app, ref, 1)).toEqual({ kind: "key", code: "F5" });
    expect(showChange(app, second.changeSetId).baseRevisionId).toBe(base);
    expect(second.validation.diff.changed).toEqual([{ layerId: "layer-0", position: 1 }]);
    closeApp(app);
  });

  test("ops on a slot the head changed throw StaleBaseError and write nothing", async () => {
    const { app, ref, base } = await setup();
    applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "F17")], summary: "one" });
    const err = attempt(() => applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "F18")], summary: "two" }));
    expect(err).toBeInstanceOf(StaleBaseError);
    expect((err as StaleBaseError).conflicts).toEqual(["layer-0:6"]);
    expect(count(app, "change_sets")).toBe(1);
    expect(count(app, "revisions")).toBe(2);
    closeApp(app);
  });

  test("a proposed change set goes stale the same way, and stays proposed so it can be rejected", async () => {
    const { app, ref } = await setup();
    const a = proposeChange(app, ref, { ops: [setKey(6, "F17")], explanation: "a", source: "editor" });
    const b = proposeChange(app, ref, { ops: [setKey(6, "F18")], explanation: "b", source: "editor" });
    const c = proposeChange(app, ref, { ops: [setKey(7, "F19")], explanation: "c", source: "editor" });
    applyChange(app, a.id);
    expect(attempt(() => applyChange(app, b.id))).toBeInstanceOf(StaleBaseError);
    expect(showChange(app, b.id).status).toBe("proposed");
    applyChange(app, c.id); // touches a different slot, so it rebases
    expect(binding(app, ref, 6)).toEqual({ kind: "key", code: "F17" });
    expect(binding(app, ref, 7)).toEqual({ kind: "key", code: "F19" });
    expect(rejectChange(app, b.id).status).toBe("rejected");
    closeApp(app);
  });

  test("checkChange reports a stale base as a stale_base error naming the slot, and an unknown base as not found", async () => {
    const { app, ref, base } = await setup();
    applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "F17")], summary: "one" });
    const stale = checkChange(app, ref, { baseRevisionId: base, ops: [setKey(6, "F18")] });
    expect(stale.ok).toBe(false);
    expect(stale.errors).toMatchObject([{ code: "stale_base", slots: [{ layerId: "layer-0", position: 6 }] }]);
    expect(checkChange(app, ref, { baseRevisionId: base, ops: [setKey(1, "F5")] }).ok).toBe(true);
    expect(checkChange(app, ref, { ops: [setKey(6, "F18")] }).ok).toBe(true);
    expect(attempt(() => checkChange(app, ref, { baseRevisionId: "rev_ghost", ops: [setKey(6, "F18")] }))).toBeInstanceOf(NotFoundError);
    closeApp(app);
  });

  test("a rebased change is re-validated against the head it lands on", async () => {
    const { app, ref, base } = await setup();
    // Both are fine alone; together they would put 9 layers under an 8-layer cap.
    const add = (id: string, after: string): ChangeOp => ({ op: "addLayer", layer: { id, name: id }, afterLayerId: after });
    applyOps(app, ref, { baseRevisionId: base, ops: [add("layer-6", "layer-5"), add("layer-7", "layer-6")], summary: "to 8" });
    const err = attempt(() => applyOps(app, ref, { baseRevisionId: base, ops: [add("layer-8", "layer-5")], summary: "to 9" }));
    expect(err).toBeInstanceOf(ValidationFailedError);
    closeApp(app);
  });
});

describe("propose, apply, reject", () => {
  test("propose stores a valid change set without touching the layout; apply makes the revision", async () => {
    const { app, ref, base } = await setup();
    const cs = proposeChange(app, ref, { ops: [setKey(6, "F17")], explanation: "F17 on 6", source: "editor" });
    expect(cs).toMatchObject({ status: "proposed", baseRevisionId: base, source: "editor" });
    expect(getLayout(app, ref).layout.headRevisionId).toBe(base);
    const out = applyChange(app, cs.id);
    expect(getLayout(app, ref).revision).toMatchObject({ id: out.revisionId, origin: "editor", summary: "F17 on 6" });
    expect(showChange(app, cs.id).status).toBe("applied");
    expect(listChanges(app, ref).map((c) => c.id)).toEqual([cs.id]);
    expect(listChanges(app, ref, { status: "proposed" })).toEqual([]);
    closeApp(app);
  });

  test("an agent change set gives its revision the agent origin", async () => {
    const { app, ref } = await setup();
    const cs = proposeChange(app, ref, { ops: [setKey(6, "F17")], explanation: "agent idea", source: "agent" });
    applyChange(app, cs.id);
    expect(getLayout(app, ref).revision.origin).toBe("agent");
    closeApp(app);
  });

  test("invalid ops are refused at propose time and not stored", async () => {
    const { app, ref } = await setup();
    expect(attempt(() => proposeChange(app, ref, { ops: [setKey(6, "NOPE")], explanation: "x", source: "editor" }))).toBeInstanceOf(ValidationFailedError);
    expect(count(app, "change_sets")).toBe(0);
    closeApp(app);
  });

  test("a change set is applied or rejected once", async () => {
    const { app, ref } = await setup();
    const a = proposeChange(app, ref, { ops: [setKey(6, "F17")], explanation: "a", source: "editor" });
    const b = proposeChange(app, ref, { ops: [setKey(7, "F17")], explanation: "b", source: "editor" });
    applyChange(app, a.id);
    expect(attempt(() => applyChange(app, a.id))).toBeInstanceOf(UsageError);
    expect(attempt(() => rejectChange(app, a.id))).toBeInstanceOf(UsageError);
    rejectChange(app, b.id);
    expect(attempt(() => applyChange(app, b.id))).toBeInstanceOf(UsageError);
    expect(attempt(() => applyChange(app, "cs_ghost"))).toBeInstanceOf(NotFoundError);
    expect(attempt(() => showChange(app, "cs_ghost"))).toBeInstanceOf(NotFoundError);
    closeApp(app);
  });

  test("apply re-validates against the head: a change set that was valid at its base can be refused later", async () => {
    const { app, ref, base } = await setup();
    const add = (id: string, after: string): ChangeOp => ({ op: "addLayer", layer: { id, name: id }, afterLayerId: after });
    const cs = proposeChange(app, ref, { ops: [add("layer-6", "layer-5"), add("layer-7", "layer-6")], explanation: "to 8", source: "editor" });
    // A different layer lands first, so the head has 7 and the proposal would make 9 under the 8-layer cap.
    applyOps(app, ref, { baseRevisionId: base, ops: [add("extra", "layer-5")], summary: "extra" });
    const err = attempt(() => applyChange(app, cs.id));
    expect(err).toBeInstanceOf(ValidationFailedError);
    expect(((err as ValidationFailedError).details as { errors: Array<{ code: string }> }).errors[0]?.code).toBe("layer_limit");
    expect(showChange(app, cs.id).status).toBe("proposed");
    expect(getLayout(app, ref).document.layers).toHaveLength(7);
    closeApp(app);
  });
});

describe("undo", () => {
  test("writes a new revision with the parent's document, origin undo, and the revision it undoes", async () => {
    const { app, ref, base } = await setup();
    const one = applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "F17")], summary: "one" });
    const out = undo(app, ref, { revisionId: one.revisionId });
    expect(out.undoesRevisionId).toBe(one.revisionId);
    expect(out.revision).toMatchObject({ origin: "undo", parentId: one.revisionId, summary: "Undo: one" });
    const view = getLayout(app, ref);
    expect(view.layout.headRevisionId).toBe(out.revision.id);
    expect(view.document).toEqual(getLayout(app, ref, base).document);
    expect(app.db.query("SELECT undoes_revision_id FROM revisions WHERE id = ?").get(out.revision.id)).toEqual({ undoes_revision_id: one.revisionId });
    expect(count(app, "revisions")).toBe(3);
    closeApp(app);
  });

  test("undoing an undo brings the change back", async () => {
    const { app, ref, base } = await setup();
    applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "F17")], summary: "one" });
    undo(app, ref);
    undo(app, ref);
    expect(binding(app, ref, 6)).toEqual({ kind: "key", code: "F17" });
    closeApp(app);
  });

  test("a revision that is not the head is a StaleBaseError, and nothing changes", async () => {
    const { app, ref, base } = await setup();
    const one = applyOps(app, ref, { baseRevisionId: base, ops: [setKey(6, "F17")], summary: "one" });
    applyOps(app, ref, { baseRevisionId: one.revisionId, ops: [setKey(7, "F17")], summary: "two" });
    expect(attempt(() => undo(app, ref, { revisionId: one.revisionId }))).toBeInstanceOf(StaleBaseError);
    expect(count(app, "revisions")).toBe(3);
    closeApp(app);
  });

  test("the import revision has nothing to go back to", async () => {
    const { app, ref } = await setup();
    expect(attempt(() => undo(app, ref))).toBeInstanceOf(UsageError);
    expect(count(app, "revisions")).toBe(1);
    closeApp(app);
  });
});
