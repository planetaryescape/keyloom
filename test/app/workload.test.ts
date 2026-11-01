import { expect, test } from "bun:test";
import { compareStoredWorkload, evaluateStoredWorkload, readWorkloadSuite, workloadHash, type WorkloadDeps } from "../../src/app/workload.ts";
import { getLayout } from "../../src/app/layouts.ts";
import { recordPriority } from "../../src/app/decisions.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { event, key, none, replayResult, stroke, suiteText, tinyLayout, workloadApp } from "../helpers/workload.ts";
import { tempDir } from "../helpers/tmp.ts";

const directPatch: ChangeOp[] = [{ op: "setBinding", at: { layerId: "base", position: 3 }, binding: { kind: "key", code: "E" } }, { op: "dropFunction", function: "key:V", reason: "synthetic test" }];
const reports = [...stroke(0, "S"), ...stroke(30, "E"), ...stroke(50, "E")];

test("stored evaluation is deterministic, includes hashes and never changes storage; replay cache is off", async () => {
  const { app, layoutId } = workloadApp();
  try {
    const before = getLayout(app, layoutId);
    const changes = app.db.query("SELECT count(*) AS n FROM change_sets").get();
    let calls = 0;
    const deps: WorkloadDeps = { replay: async (_app, view, events, opts) => {
      calls++; expect(view.document).toEqual(before.document);
      expect(events).toEqual([event(0, 0, "press"), event(10, 0, "release"), event(20, 1, "press"), event(30, 2, "press"), event(40, 2, "release"), event(50, 2, "press"), event(60, 2, "release"), event(70, 1, "release")]);
      expect(opts).toMatchObject({ cache: false, leadMs: 1000, boardRevision: "reva" });
      return replayResult(reports);
    } };
    const first = await evaluateStoredWorkload(app, layoutId, { suite: suiteText("see") }, deps);
    const second = await evaluateStoredWorkload(app, layoutId, { suite: suiteText("see") }, deps);
    expect(first).toEqual(second); expect(calls).toBe(2);
    expect(first.identity.layoutHash).toHaveLength(64); expect(first.identity.sourceHash).toHaveLength(64);
    expect(JSON.stringify(first)).not.toMatch(/logPath|emulate-[a-z0-9]+\.log|createdAt/);
    expect(getLayout(app, layoutId)).toEqual(before);
    expect(app.db.query("SELECT count(*) AS n FROM change_sets").get()).toEqual(changes);
  } finally { app.db.close(); }
});

test("supplied patch is validated and evaluated independently without saving; full union is replayed", async () => {
  const { app, layoutId } = workloadApp();
  try {
    const before = getLayout(app, layoutId);
    const seen: number[][] = [];
    const result = await compareStoredWorkload(app, layoutId, directPatch, { suite: suiteText("see") }, { replay: async (_app, view, events) => {
      seen.push(events.filter((e) => e.action === "press").map((e) => e.position));
      expect(view.document.layers[0]?.bindings[3]).toEqual(seen.length === 1 ? key("V") : key("E"));
      return replayResult(reports);
    } });
    expect(seen).toEqual([[0, 1, 2, 2], [0, 3, 3]]);
    expect(result.comparison.verdict).toBe("verified-improvement");
    expect(result.baseline.identity.layoutHash).not.toBe(result.candidate.identity.layoutHash);
    expect(result.baseline.identity.suiteHash).toBe(result.candidate.identity.suiteHash);
    expect(result.saved).toBe(false); expect(result.applied).toBe(false);
    expect(getLayout(app, layoutId)).toEqual(before);
  } finally { app.db.close(); }
});

test("interacting patch union, not additive individual gains, decides comparison", async () => {
  const { app, layoutId } = workloadApp();
  try {
    // First add E, then swap that same slot: the union's final E is at position 0 and S at 3.
    const ops: ChangeOp[] = [...directPatch, { op: "swapBindings", a: { layerId: "base", position: 0 }, b: { layerId: "base", position: 3 } }];
    let calls = 0;
    const r = await compareStoredWorkload(app, layoutId, ops, { suite: suiteText("see") }, { replay: async (_app, _view, events) => {
      calls++;
      if (calls === 2) expect(events.filter((e) => e.action === "press").map((e) => e.position)).toEqual([3, 0, 0]);
      return replayResult(calls === 1 ? reports : [...stroke(0, "S"), ...stroke(20, "E")]);
    } });
    expect(calls).toBe(2); expect(r.comparison.verdict).toBe("inconclusive");
    expect(r.candidate.tasks[0]?.status).toBe("output-mismatch");
  } finally { app.db.close(); }
});

test("pins on slots or functions are hard before any replay; invalid ops also fail before replay", async () => {
  for (const subject of [{ slots: [{ layerId: "base", position: 3 }] }, { functions: ["key:V"] }]) {
    const { app, layoutId } = workloadApp();
    try {
      recordPriority(app, layoutId, { priorityKind: "pinned", statement: "Keep V", subject });
      const deps: WorkloadDeps = { replay: async () => { throw new Error("must not replay"); } };
      await expect(compareStoredWorkload(app, layoutId, directPatch, { suite: suiteText("see") }, deps)).rejects.toThrow("pinned");
      await expect(compareStoredWorkload(app, layoutId, [{ op: "setBinding", at: { layerId: "missing", position: 0 }, binding: key("E") }], {}, deps)).rejects.toThrow("invalid workload comparison patch");
      await expect(compareStoredWorkload(app, layoutId, [], {}, deps)).rejects.toThrow("1 to 256");
    } finally { app.db.close(); }
  }
});

test("task witnesses enable opaque routes without assigning invented control counts", async () => {
  const { app, layoutId } = workloadApp(tinyLayout([{ kind: "native", firmware: "qmk", source: "KC_E", label: "opaque" }, none, none, none]));
  try {
    const suite = suiteText("e"); suite.tasks[0]!.witness = [event(0, 0, "press"), event(40, 0, "release")];
    const r = await evaluateStoredWorkload(app, layoutId, { suite }, { replay: async (_app, _view, events) => {
      expect(events).toEqual([event(0, 0, "press"), event(40, 0, "release")]); return replayResult(stroke(0, "E"));
    } });
    expect(r.tasks[0]).toMatchObject({ status: "verified", search: { strategy: "supplied-witness" }, costs: { physicalKeydowns: 1, layerEntries: null, modifierEntries: null } });
  } finally { app.db.close(); }
});

test("invalid suite/policy/revision/witness fails before replay", async () => {
  const { app, layoutId } = workloadApp();
  let calls = 0;
  const deps: WorkloadDeps = { replay: async () => { calls++; return replayResult([]); } };
  try {
    for (const witness of [
      [event(0, 999, "press"), event(1, 999, "release")],
      [event(0, 0, "press"), event(1, 0, "press")],
      [event(0, 0, "release"), event(1, 0, "release")],
      [event(1, 0, "press"), event(0, 0, "release")],
      [event(0, 0, "press"), event(1, 1, "press")],
    ]) {
      const suite = suiteText("e"); suite.tasks[0]!.witness = witness;
      await expect(evaluateStoredWorkload(app, layoutId, { suite }, deps)).rejects.toThrow("task task:");
    }
    await expect(evaluateStoredWorkload(app, layoutId, { suite: { tasks: [] } }, deps)).rejects.toThrow("invalid workload suite");
    await expect(evaluateStoredWorkload(app, layoutId, { policy: { maxStates: 0 } }, deps)).rejects.toThrow("invalid workload policy");
    await expect(evaluateStoredWorkload(app, layoutId, { boardRevision: "typo" }, deps)).rejects.toThrow("unknown board revision");
    expect(calls).toBe(0);
  } finally { app.db.close(); }
});

test("suite file resource limits and hashes preserve all own keys and passthrough", async () => {
  const dir = tempDir();
  await Bun.write(`${dir}/large.json`, " ".repeat(65_537));
  await expect(readWorkloadSuite(`${dir}/large.json`)).rejects.toThrow("exceeds");
  await Bun.write(`${dir}/broken.json`, "{");
  await expect(readWorkloadSuite(`${dir}/broken.json`)).rejects.toThrow("valid JSON");
  expect(workloadHash({ b: 2, a: 1 })).toBe(workloadHash({ a: 1, b: 2 }));
  expect(workloadHash(JSON.parse('{"__proto__":"a"}'))).not.toBe(workloadHash(JSON.parse('{"__proto__":"b"}')));
  expect(workloadHash({ passthrough: ["a"] })).not.toBe(workloadHash({ passthrough: ["b"] }));
});
