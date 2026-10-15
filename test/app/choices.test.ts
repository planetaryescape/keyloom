// The decision lifecycle end to end on BK's real Moonlander import (08): a choice is written when a
// change with a reason is applied, a later change to those keys is reminded and then supersedes it,
// undo and redo carry the memory with the document, and outcomes and the 7-day question work.
import { describe, expect, test } from "bun:test";
import {
  type App, type ChangeOp, applyChange, applyOps, checkChange, dismissOutcome, getLayout, listDecisions, outcomeQuestions, proposeChange, recordOutcome,
  recordPriority, retireDecision, showDecision, undo,
} from "../../src/app/index.ts";
import { OUTCOME_QUESTION_DELAY_MS } from "../../src/memory/choices.ts";
import { createBuild, createFlash, finishBuild, finishFlash, newBuildId, newFlashId } from "../../src/persistence/builds.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { draft } from "../helpers/ops.ts";

const at = (position: number) => ({ layerId: "layer-0", position });
const TAB = 42;
const cmdShift: ChangeOp[] = [{ op: "setBinding", at: at(TAB), binding: { kind: "modifier", mods: ["LGUI", "LSFT"] } }];
// Replacing Command-Shift loses it, which the validator only allows with a reason (D-020).
const capsWord: ChangeOp[] = [
  { op: "dropFunction", function: "mod:LSFT+LGUI", reason: "never used" },
  { op: "setBinding", at: at(TAB), binding: { kind: "key", code: "CAPS_LOCK" } },
];
const REASON = "my left hand is free during Command-Shift shortcuts";

/** Proposes as the agent does, with a draft and the message it answers, and applies. */
function agentApply(app: App, ref: string, ops: ChangeOp[], over: Partial<ReturnType<typeof draft>> = {}) {
  const cs = proposeChange(app, ref, {
    ops, explanation: "x", source: "agent", decisionDraft: { ...draft({ goal: "Command-Shift in one press", choice: "Command-Shift on key 43", reason: REASON, ...over }), sourceMessageIds: ["msg_a"] },
  });
  return { cs, applied: applyChange(app, cs.id) };
}

describe("writing a choice on apply", () => {
  test("an agent proposal's draft becomes a hypothesis decision, with its subject from the validator's diff and its link back", async () => {
    const { app, layoutId } = await commandShiftApp();
    const { cs, applied } = agentApply(app, layoutId, cmdShift);
    const d = showDecision(app, applied.decisionId as string);
    expect(d).toMatchObject({
      kind: "choice", priorityKind: null, status: "hypothesis", goal: "Command-Shift in one press", choice: "Command-Shift on key 43", reason: REASON,
      changeSetId: cs.id, sourceMessageIds: ["msg_a"], supersededBy: null, outcomeNote: null,
    });
    expect(d.subject.slots).toEqual(cs.validation.diff.changed);
    expect(d.subject.functions).toContain("mod:LSFT+LGUI");
    expect(listDecisions(app, layoutId, { kind: "choice" }).map((x) => x.id)).toEqual([d.id]);
  });

  test("a proposal without a draft remembers nothing; an editor change remembers only a reason BK typed", async () => {
    const { app, layoutId } = await commandShiftApp();
    const base = getLayout(app, layoutId).revision.id;
    const plain = proposeChange(app, layoutId, { ops: cmdShift, explanation: "x", source: "editor" });
    expect(applyChange(app, plain.id).decisionId).toBeNull();

    const head = getLayout(app, layoutId).revision.id;
    expect(head).not.toBe(base);
    const silent = applyOps(app, layoutId, { baseRevisionId: head, ops: capsWord, summary: "Caps Lock on key 43", reason: "   " });
    expect(silent.decisionId).toBeNull();

    const typed = applyOps(app, layoutId, { baseRevisionId: getLayout(app, layoutId).revision.id, ops: cmdShift, summary: "Command-Shift on key 43", reason: "I kept missing it" });
    expect(showDecision(app, typed.decisionId as string)).toMatchObject({ kind: "choice", goal: "Command-Shift on key 43", choice: "Command-Shift on key 43", reason: "I kept missing it" });
    expect(listDecisions(app, layoutId, { kind: "choice" })).toHaveLength(1);
  });

  test("two alternatives from one question write one decision, for the one applied", async () => {
    const { app, layoutId } = await commandShiftApp();
    const a = proposeChange(app, layoutId, { ops: cmdShift, explanation: "a", source: "agent", proposalGroup: "pg_1", decisionDraft: { ...draft({ choice: "A" }), sourceMessageIds: [] } });
    proposeChange(app, layoutId, { ops: capsWord, explanation: "b", source: "agent", proposalGroup: "pg_1", decisionDraft: { ...draft({ choice: "B" }), sourceMessageIds: [] } });
    applyChange(app, a.id);
    expect(listDecisions(app, layoutId, { kind: "choice" }).map((d) => d.choice)).toEqual(["A"]);
  });
});

describe("reminders and supersession", () => {
  test("changing the key later carries the stored reason; applying anyway supersedes the old decision with the new one", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;

    const preview = checkChange(app, layoutId, { ops: capsWord });
    expect(preview.ok).toBe(true);
    expect(preview.diff.reminders).toMatchObject([{ decisionId: first, reason: REASON, status: "hypothesis", slots: [at(TAB)] }]);
    expect(preview.warnings.find((w) => w.code === "contradicts_decision")?.message).toContain(REASON);

    const second = agentApply(app, layoutId, capsWord, { goal: "I want Caps Lock back", choice: "Caps Lock on key 43", reason: "Command-Shift was never used" });
    expect(second.cs.validation.diff.reminders.map((r) => r.decisionId)).toEqual([first]);
    const old = showDecision(app, first);
    expect(old).toMatchObject({ status: "superseded", supersededBy: second.applied.decisionId as string });
    // Superseded decisions are out of the agent's and the validator's view.
    expect(listDecisions(app, layoutId, { kind: "choice" }).filter((d) => d.status !== "superseded")).toHaveLength(1);
    expect(checkChange(app, layoutId, { ops: cmdShift }).diff.reminders.map((r) => r.decisionId)).toEqual([second.applied.decisionId as string]);
  });

  test("an unrelated change leaves the decision alone", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    const unrelated: ChangeOp[] = [{ op: "renameLayer", layerId: "layer-5", name: "Renamed" }];
    expect(checkChange(app, layoutId, { ops: unrelated }).diff.reminders).toEqual([]);
    agentApply(app, layoutId, unrelated);
    expect(showDecision(app, first).status).toBe("hypothesis");
  });

  test("an editor change with no reason still retires what it overrode, with no successor", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    applyOps(app, layoutId, { baseRevisionId: getLayout(app, layoutId).revision.id, ops: capsWord, summary: "Caps Lock on key 43" });
    expect(showDecision(app, first)).toMatchObject({ status: "superseded", supersededBy: null });
  });

  test("a decision marked unhelpful raises no reminder, and is still superseded by what replaces it", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    recordOutcome(app, first, { status: "tried_unhelpful", note: "I never reached for it" });
    expect(checkChange(app, layoutId, { ops: capsWord }).diff.reminders).toEqual([]);
    const second = agentApply(app, layoutId, capsWord);
    expect(showDecision(app, first)).toMatchObject({ status: "superseded", supersededBy: second.applied.decisionId as string });
  });

  test("a tried_helpful decision says so in its reminder", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    recordOutcome(app, first, { status: "tried_helpful", note: "I use it daily" });
    const r = checkChange(app, layoutId, { ops: capsWord });
    expect(r.diff.reminders[0]).toMatchObject({ decisionId: first, status: "tried_helpful" });
    expect(r.warnings.find((w) => w.code === "contradicts_decision")?.message).toContain("it helped");
  });

  test("a retired decision is forgotten by the validator", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    retireDecision(app, first);
    expect(checkChange(app, layoutId, { ops: capsWord }).diff.reminders).toEqual([]);
  });

  test("priorities do not raise decision reminders; moved_pinned still covers them", async () => {
    const { app, layoutId } = await commandShiftApp();
    recordPriority(app, layoutId, { priorityKind: "rarely_used", statement: "I barely use Tab", subject: { slots: [at(TAB)] } });
    expect(checkChange(app, layoutId, { ops: capsWord }).diff.reminders).toEqual([]);
  });
});

describe("undo and redo carry the memory with the document", () => {
  test("undoing the superseding change retires its decision and brings the old one back as it was; redo reverses both", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    recordOutcome(app, first, { status: "tried_helpful", note: "I use it daily" });
    const second = agentApply(app, layoutId, capsWord).applied.decisionId as string;
    expect(showDecision(app, first).status).toBe("superseded");

    undo(app, layoutId);
    expect(showDecision(app, second).status).toBe("retired");
    expect(showDecision(app, first)).toMatchObject({ status: "tried_helpful", supersededBy: null });
    expect(checkChange(app, layoutId, { ops: capsWord }).diff.reminders.map((r) => r.decisionId)).toEqual([first]);

    undo(app, layoutId); // an undo of the undo: Caps Lock is back
    expect(showDecision(app, second).status).toBe("hypothesis");
    expect(showDecision(app, first)).toMatchObject({ status: "superseded", supersededBy: second });
  });

  test("undoing the first change retires its decision, and a decision BK retired himself stays retired through undo and redo", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    undo(app, layoutId);
    expect(showDecision(app, first).status).toBe("retired");
    undo(app, layoutId);
    expect(showDecision(app, first).status).toBe("hypothesis");

    retireDecision(app, first);
    undo(app, layoutId);
    undo(app, layoutId);
    expect(showDecision(app, first).status).toBe("retired");
  });

  test("a new change after an undo does not resurrect the undone decision", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    undo(app, layoutId);
    agentApply(app, layoutId, capsWord);
    expect(showDecision(app, first).status).toBe("retired");
    // Undoing then redoing the new change leaves the old one as it was.
    undo(app, layoutId);
    undo(app, layoutId);
    expect(showDecision(app, first).status).toBe("retired");
  });
});

describe("outcomes", () => {
  test("record BK's words and the status; refuse a priority, a superseded decision and an empty note", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    expect(recordOutcome(app, first, { status: "tried_unhelpful", note: " feels slow now " })).toMatchObject({ status: "tried_unhelpful", outcomeNote: "feels slow now" });
    expect(() => recordOutcome(app, first, { status: "tried_helpful", note: "  " })).toThrow("note");

    const { decision } = recordPriority(app, layoutId, { priorityKind: "pinned", statement: "keep Backspace", subject: { functions: ["key:BACKSPACE"] } });
    expect(() => recordOutcome(app, decision.id, { status: "tried_helpful", note: "yes" })).toThrow("priority");

    agentApply(app, layoutId, capsWord);
    expect(() => recordOutcome(app, first, { status: "tried_helpful", note: "yes" })).toThrow("no longer applies");
    expect(() => recordOutcome(app, "dec_nope", { status: "tried_helpful", note: "yes" })).toThrow("no decision");
  });
});

describe("the 7-day outcome question (Q6)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const flash = (app: App, layoutId: string, at: number, startedAt = at - 60_000) => {
    const view = getLayout(app, layoutId);
    const build = newBuildId();
    createBuild(app.db, { id: build, revisionId: view.revision.id, layoutId, boardRevision: "reva", logPath: "l", now: startedAt });
    finishBuild(app.db, build, { artifactPath: "a" }, startedAt + 1000);
    const id = newFlashId();
    createFlash(app.db, { id, buildId: build, logPath: "l", now: at - 1000 });
    finishFlash(app.db, id, null, at);
  };

  test("asks about a hypothesis a week after the flash that first carried it, once", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    const created = showDecision(app, first).createdAt;
    expect(outcomeQuestions(app, layoutId, created + 30 * DAY)).toEqual([]); // never flashed

    const flashedAt = created + 1000;
    flash(app, layoutId, flashedAt, created + 500);
    expect(outcomeQuestions(app, layoutId, flashedAt + OUTCOME_QUESTION_DELAY_MS - 1)).toEqual([]);
    const due = outcomeQuestions(app, layoutId, flashedAt + OUTCOME_QUESTION_DELAY_MS);
    expect(due.map((q) => q.decision.id)).toEqual([first]);

    dismissOutcome(app, first);
    expect(outcomeQuestions(app, layoutId, flashedAt + 30 * DAY)).toEqual([]);
    expect(showDecision(app, first).status).toBe("hypothesis");
  });

  test("a later flash does not reset an older decision's clock, a decision applied after a build is not counted, and answering ends the question", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    const firstAt = showDecision(app, first).createdAt;
    flash(app, layoutId, firstAt + 1000, firstAt);
    await Bun.sleep(5);
    // Applied after the first build began, and unrelated to the first decision's key.
    const second = agentApply(app, layoutId, [{ op: "setBinding", at: at(TAB - 1), binding: { kind: "key", code: "F20" } }, { op: "dropFunction", function: "key:F20", reason: "x" }]);
    const secondAt = showDecision(app, second.applied.decisionId as string).createdAt;
    flash(app, layoutId, firstAt + 9 * DAY, firstAt + 9 * DAY - 1000);

    const now = firstAt + 10 * DAY;
    // The first was on the keyboard ten days ago, so it is due even though a flash 1 day ago is newer. The second was
    // carried only by that newer flash, which is less than a week old.
    expect(outcomeQuestions(app, layoutId, now).map((q) => q.decision.id)).toEqual([first]);
    expect(outcomeQuestions(app, layoutId, firstAt + 16 * DAY + 1).map((q) => q.decision.id)).toEqual([first, second.applied.decisionId as string]);
    recordOutcome(app, first, { status: "tried_helpful", note: "good" });
    expect(outcomeQuestions(app, layoutId, firstAt + 40 * DAY).map((q) => q.decision.id)).toEqual([second.applied.decisionId as string]);
    expect(secondAt).toBeGreaterThan(firstAt);
  });

  test("only hypothesis choices are asked about", async () => {
    const { app, layoutId } = await commandShiftApp();
    const first = agentApply(app, layoutId, cmdShift).applied.decisionId as string;
    const created = showDecision(app, first).createdAt;
    flash(app, layoutId, created + 1000, created + 500);
    recordOutcome(app, first, { status: "tried_helpful", note: "yes" });
    recordPriority(app, layoutId, { priorityKind: "pinned", statement: "keep Backspace", subject: { functions: ["key:BACKSPACE"] } });
    expect(outcomeQuestions(app, layoutId, created + 30 * DAY)).toEqual([]);
  });
});
