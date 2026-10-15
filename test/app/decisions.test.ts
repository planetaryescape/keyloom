import { describe, expect, test } from "bun:test";
import {
  type App, type ChangeOp, NotFoundError, UsageError, applyChange, checkChange, editDecision, getLayout, importLayout, listDecisions, openApp, proposeChange,
  recordPriority, retireDecision, retirePriority, showDecision,
} from "../../src/app/index.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

async function setup(): Promise<{ app: App; ref: string }> {
  const app = openApp({ dataDir: tempDir() });
  const out = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
  return { app, ref: out.layoutId };
}

const BACKSPACE: Parameters<typeof recordPriority>[2] = { priorityKind: "pinned", statement: "keep Backspace where it is", subject: { functions: ["key:BACKSPACE"] } };
// Replaces Backspace on the base layer, which the fixture also has on layer 1, so nothing is lost.
const replaceBackspace: ChangeOp[] = [{ op: "setBinding", at: { layerId: "layer-0", position: 28 }, binding: { kind: "modifier", mods: ["LGUI", "LSFT"] } }];

describe("recording priorities", () => {
  test("stores BK's words as the goal, the kind in words as the choice, and a default reason", async () => {
    const { app, ref } = await setup();
    const { decision, created } = recordPriority(app, ref, BACKSPACE);
    expect(created).toBe(true);
    expect(decision).toMatchObject({
      kind: "priority", priorityKind: "pinned", goal: "keep Backspace where it is", choice: "Keep it where it is", reason: "stated by BK", status: "hypothesis",
    });
    expect(listDecisions(app, ref, { kind: "priority" }).map((d) => d.id)).toEqual([decision.id]);
  });

  test("the same statement about the same thing is one priority, however the subject is ordered", async () => {
    const { app, ref } = await setup();
    const first = recordPriority(app, ref, { priorityKind: "rarely_used", statement: "I barely use these", subject: { functions: ["key:A", "key:B"] } });
    const again = recordPriority(app, ref, { priorityKind: "rarely_used", statement: "barely use A and B", subject: { functions: ["key:B", "key:A"] } });
    expect(again.created).toBe(false);
    expect(again.decision.id).toBe(first.decision.id);
    // A different kind about the same keys is a different statement.
    expect(recordPriority(app, ref, { priorityKind: "frequent", statement: "I use them", subject: { functions: ["key:A", "key:B"] } }).created).toBe(true);
    expect(listDecisions(app, ref)).toHaveLength(2);
  });

  test("a statement already covered by a remembered priority adds nothing, but one naming more is new", async () => {
    const { app, ref } = await setup();
    const withSlot = { ...BACKSPACE, subject: { slots: [{ layerId: "layer-0", position: 28 }], functions: ["key:BACKSPACE"] } };
    expect(recordPriority(app, ref, withSlot).created).toBe(true);
    // Said again, named by function only or by key only: the same priority.
    expect(recordPriority(app, ref, BACKSPACE).created).toBe(false);
    expect(recordPriority(app, ref, { ...BACKSPACE, subject: { slots: [{ layerId: "layer-0", position: 28 }] } }).created).toBe(false);
    // Backspace and Tab says more than the stored one, so it is stored.
    expect(recordPriority(app, ref, { ...BACKSPACE, subject: { functions: ["key:BACKSPACE", "key:TAB"] } }).created).toBe(true);
    expect(listDecisions(app, ref, { kind: "priority" })).toHaveLength(2);
  });

  test("refuses an empty statement or a subject with nothing in it", async () => {
    const { app, ref } = await setup();
    expect(() => recordPriority(app, ref, { ...BACKSPACE, statement: "  " })).toThrow(UsageError);
    expect(() => recordPriority(app, ref, { ...BACKSPACE, subject: {} })).toThrow(UsageError);
  });

  test("retiring takes it out of the active set but keeps the row, and a retired one can be said again", async () => {
    const { app, ref } = await setup();
    const { decision } = recordPriority(app, ref, BACKSPACE);
    expect(retirePriority(app, decision.id).status).toBe("retired");
    expect(showDecision(app, decision.id).status).toBe("retired");
    expect(listDecisions(app, ref, { status: "retired" })).toHaveLength(1);
    expect(recordPriority(app, ref, BACKSPACE).created).toBe(true);
    expect(() => retirePriority(app, "dec_nope")).toThrow(NotFoundError);
  });

  test("edit changes the words, not the kind; an empty field is refused", async () => {
    const { app, ref } = await setup();
    const { decision } = recordPriority(app, ref, BACKSPACE);
    const edited = editDecision(app, decision.id, { reason: "my pinky knows it" });
    expect(edited).toMatchObject({ reason: "my pinky knows it", goal: "keep Backspace where it is" });
    expect(() => editDecision(app, decision.id, { goal: " " })).toThrow(UsageError);
    expect(retireDecision(app, decision.id).status).toBe("retired");
  });
});

describe("pinned priorities and the validator", () => {
  test("a change that moves a pinned function is valid but carries moved_pinned, and applies", async () => {
    const { app, ref } = await setup();
    const quiet = checkChange(app, ref, { ops: replaceBackspace });
    expect(quiet.warnings.map((w) => w.code)).not.toContain("moved_pinned");

    recordPriority(app, ref, BACKSPACE);
    const warned = checkChange(app, ref, { ops: replaceBackspace });
    expect(warned.ok).toBe(true);
    expect(warned.warnings.find((w) => w.code === "moved_pinned")?.message).toContain("keep Backspace where it is");

    const cs = proposeChange(app, ref, { ops: replaceBackspace, explanation: "x", source: "editor" });
    expect(cs.validation.warnings.map((w) => w.code)).toContain("moved_pinned");
    applyChange(app, cs.id);
    expect(getLayout(app, ref).document.layers[0]?.bindings[28]).toEqual({ kind: "modifier", mods: ["LGUI", "LSFT"] });
  });

  test("a retired priority no longer warns", async () => {
    const { app, ref } = await setup();
    const { decision } = recordPriority(app, ref, BACKSPACE);
    retirePriority(app, decision.id);
    expect(checkChange(app, ref, { ops: replaceBackspace }).warnings.map((w) => w.code)).not.toContain("moved_pinned");
  });

  test("only pinned priorities warn; a rarely-used one does not", async () => {
    const { app, ref } = await setup();
    recordPriority(app, ref, { priorityKind: "rarely_used", statement: "I barely use Backspace", subject: { functions: ["key:BACKSPACE"] } });
    expect(checkChange(app, ref, { ops: replaceBackspace }).warnings.map((w) => w.code)).not.toContain("moved_pinned");
  });
});
