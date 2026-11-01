import { describe, expect, test } from "bun:test";
import { evaluateWorkload, compareWorkloadEvidence, SCOPE_WARNINGS, traceCosts } from "../../../src/lab/workload/evaluate.ts";
import { taskGoals, verifyOutput } from "../../../src/lab/workload/host.ts";
import { planTask } from "../../../src/lab/workload/planner.ts";
import { DEFAULT_WORKLOAD_POLICY as policy, WorkloadSuiteSchema, WorkloadPolicySchema, builtinWorkloadSuites } from "../../../src/lab/workload/schema.ts";
import { event, key, none, replayResult, stroke, suiteText, tinyBoard, tinyLayout } from "../../helpers/workload.ts";

const layered = () => tinyLayout(undefined, [{ kind: "transparent" }, none, key("E"), none]);
const plan = (text: string) => planTask(layered(), suiteText(text).tasks[0]!, policy);
describe("bounded physical workload witnesses", () => {
  test("see holds one layer across both e outputs; direct e costs one less activation", async () => {
    const p = plan("see");
    // Independently authored physical trace, not an echo of planner decisions.
    expect(p.events).toEqual([event(0, 0, "press"), event(10, 0, "release"), event(20, 1, "press"), event(30, 2, "press"), event(40, 2, "release"), event(50, 2, "press"), event(60, 2, "release"), event(70, 1, "release")]);
    expect(traceCosts(tinyBoard(), p.events, p.entries)).toMatchObject({ physicalKeydowns: 4, physicalReleases: 4, layerEntries: 1, maxSimultaneousKeys: 2 });
    const direct = tinyLayout([key("S"), key("E"), none, none]);
    const directPlan = planTask(direct, suiteText("see").tasks[0]!, policy);
    expect(traceCosts(tinyBoard(), directPlan.events, directPlan.entries).physicalKeydowns).toBe(3);
    const reports = [...stroke(0, "S"), ...stroke(30, "E"), ...stroke(50, "E")];
    const result = await evaluateWorkload(tinyBoard(), layered(), suiteText("see"), policy, async () => replayResult(reports));
    expect(result.coverage).toEqual({ totalTasks: 1, verifiedTasks: 1, requestedOutputs: 3, verifiedOutputs: 3 });
    expect(result.tasks[0]?.status).toBe("verified");
  });
  test("repeated e amortizes layer entry; mixed ese must leave and re-enter if s is occluded", () => {
    expect(traceCosts(tinyBoard(), plan("eeee").events, plan("eeee").entries)).toMatchObject({ physicalKeydowns: 5, layerEntries: 1 });
    const l = layered(); l.layers[1]!.bindings[0] = none;
    const p = planTask(l, suiteText("ese").tasks[0]!, policy);
    expect(traceCosts(tinyBoard(), p.events, p.entries)).toMatchObject({ physicalKeydowns: 5, layerEntries: 2 });
  });
  test("transparent fallback keeps the layer held, none does not fall through", () => {
    const p = plan("ese");
    expect(traceCosts(tinyBoard(), p.events, p.entries).layerEntries).toBe(1);
    expect(p.events.filter((e) => e.action === "press").map((e) => e.position)).toEqual([1, 2, 0, 2]);
  });
  test("braces use a shared explicit shift or already shifted bindings", () => {
    const layout = tinyLayout([{ kind: "modifier", mods: ["LSFT"] }, key("LEFT_BRACKET"), key("RIGHT_BRACKET"), none]);
    const task = suiteText("{}").tasks[0]!;
    const p = planTask(layout, task, policy);
    expect(p.events).toEqual([event(0, 0, "press"), event(10, 1, "press"), event(20, 1, "release"), event(30, 2, "press"), event(40, 2, "release"), event(50, 0, "release")]);
    expect(traceCosts(tinyBoard(), p.events, p.entries)).toMatchObject({ physicalKeydowns: 3, modifierEntries: 1, maxSimultaneousKeys: 2 });
    layout.layers[0]!.bindings = [{ kind: "key", code: "LEFT_BRACKET", mods: ["LSFT"] }, { kind: "key", code: "RIGHT_BRACKET", mods: ["LSFT"] }, none, none];
    const shifted = planTask(layout, task, policy);
    expect(traceCosts(tinyBoard(), shifted.events, shifted.entries)).toMatchObject({ physicalKeydowns: 2, modifierEntries: 0 });
  });
  test("layer plus shift charges four presses for braces", () => {
    const l = tinyLayout([{ kind: "layer", action: "momentary", layerId: "symbols" }, none, none, none], [none, { kind: "modifier", mods: ["LSFT"] }, key("LEFT_BRACKET"), key("RIGHT_BRACKET")]);
    const p = planTask(l, suiteText("{}").tasks[0]!, policy);
    expect(traceCosts(tinyBoard(), p.events, p.entries)).toMatchObject({ physicalKeydowns: 4, layerEntries: 1, modifierEntries: 1, maxSimultaneousKeys: 3 });
  });
  test("tap-side hold-taps are candidates only; a firmware hold instead fails verification", async () => {
    const l = tinyLayout([{ kind: "holdTap", tap: { code: "E" }, hold: { mods: ["LGUI"] }, profileId: "mt" }, none, none, none]);
    const p = planTask(l, suiteText("e").tasks[0]!, policy);
    expect(p.events).toEqual([event(0, 0, "press"), event(10, 0, "release")]);
    const result = await evaluateWorkload(tinyBoard(), l, suiteText("e"), policy, async () => replayResult([{ at: 0, kind: "keyboard", keys: [], mods: ["LGUI"] }, { at: 10, kind: "keyboard", keys: [], mods: [] }]));
    expect(result.tasks[0]?.status).toBe("output-mismatch");
  });
  test("missing route is not proof of unreachable; opaque and budget gaps remain distinct", () => {
    expect(planTask(tinyLayout([none, none, none, none]), suiteText("e").tasks[0]!, policy).status).toBe("no-route-within-supported-subset");
    expect(planTask(tinyLayout([{ kind: "native", firmware: "qmk", source: "CUSTOM", label: "e" }, none, none, none]), suiteText("e").tasks[0]!, policy).status).toBe("unsupported");
    const limited = { ...policy, maxExpansions: 1 };
    const one = planTask(layered(), suiteText("see").tasks[0]!, limited);
    expect(one.status).toBe("search-limit"); expect(one.search.expansions).toBe(1);
    expect(one).toEqual(planTask(layered(), suiteText("see").tasks[0]!, limited));
    expect(one.events).toEqual([]);
  });
  test("same finger counts require unambiguous metadata and include all physical controls", () => {
    const counts = traceCosts(tinyBoard(), [event(0, 2, "press"), event(1, 2, "release"), event(2, 3, "press"), event(3, 3, "release"), event(4, 3, "press"), event(5, 3, "release")], []);
    expect(counts).toMatchObject({ byHand: { right: 3 }, byFinger: { "right:index": 3 }, sameFingerDifferentKeyTransitions: 1, sameKeyRepeats: 1 });
    const board = tinyBoard(); board.hands.left.push(2); board.fingers = JSON.parse('{"__proto__":"bad"}');
    expect(traceCosts(board, [event(0, 2, "press"), event(1, 2, "release")], null)).toMatchObject({ unknownHand: 1, unknownFinger: 1, layerEntries: null });
    const contradictory = tinyBoard(); contradictory.fingers["2"] = "left-index";
    expect(traceCosts(contradictory, [event(0, 2, "press"), event(1, 2, "release")], null).unknownFinger).toBe(1);
  });
});

describe("independent sequential HID host oracle", () => {
  const goals = () => taskGoals(suiteText("{}").tasks[0]!)!;
  test("shifted symbols accept either shift side but not both or extra modifiers", () => {
    expect(verifyOutput(goals(), [...stroke(0, "LEFT_BRACKET", ["RSFT"]), ...stroke(30, "RIGHT_BRACKET", ["LSFT"])]).ok).toBe(true);
    expect(verifyOutput(goals(), [...stroke(0, "LEFT_BRACKET", ["LSFT", "LALT"]), ...stroke(30, "RIGHT_BRACKET", ["LSFT"])]).ok).toBe(false);
    expect(verifyOutput(goals(), [...stroke(0, "LEFT_BRACKET", ["LSFT", "RSFT"]), ...stroke(30, "RIGHT_BRACKET", ["LSFT"])]).ok).toBe(false);
  });
  test("exact shortcuts enforce modifier side, timing and full key sequence", () => {
    const g = [{ key: "P", modChoices: [["LGUI", "LSFT"]] }];
    expect(verifyOutput(g, [{ at: 0, kind: "keyboard", keys: [], mods: ["LSFT"] }, ...stroke(10, "P", ["LGUI", "LSFT"])]).ok).toBe(true);
    expect(verifyOutput(g, stroke(0, "P", ["RGUI", "LSFT"])).ok).toBe(false);
    expect(verifyOutput(g, stroke(0, "P", ["LGUI", "LSFT", "LALT"])).ok).toBe(false);
    expect(verifyOutput(g, [{ at: 0, kind: "keyboard", keys: [], mods: ["LGUI"] }, { at: 1, kind: "keyboard", keys: [], mods: [] }, ...stroke(10, "P", ["LGUI", "LSFT"])]).ok).toBe(false);
    expect(verifyOutput(g, [{ at: 0, kind: "keyboard", keys: ["P"], mods: ["LGUI", "LSFT"] }, { at: 10, kind: "keyboard", keys: ["P"], mods: [] }, { at: 20, kind: "keyboard", keys: [], mods: [] }]).ok).toBe(false);
  });
  test("wrong, extra, partial, consumer, transient modifiers, residual held and reordered output fail", () => {
    const g = taskGoals(suiteText("e").tasks[0]!)!;
    for (const reports of [
      stroke(0, "S"), [...stroke(0, "E"), ...stroke(20, "E")], [],
      [{ at: 0, kind: "keyboard" as const, keys: ["E"], mods: [] }],
      [...stroke(0, "E"), { at: 20, kind: "keyboard" as const, keys: [], mods: ["LSFT"] }, { at: 30, kind: "keyboard" as const, keys: [], mods: [] }],
      [...stroke(0, "E"), { at: 20, kind: "consumer" as const, usages: ["AUDIO_VOL_UP"] }, { at: 30, kind: "consumer" as const, usages: [] }],
      [...stroke(10, "E"), { at: 0, kind: "keyboard" as const, keys: [], mods: [] }],
    ]) expect(verifyOutput(g, reports).ok).toBe(false);
  });
});

describe("coverage, warnings and comparison", () => {
  test("scope disclosures remain visible; any unknown warning prevents verified costs", async () => {
    const l = tinyLayout([key("E"), none, none, none]);
    for (const warning of SCOPE_WARNINGS) {
      const r = await evaluateWorkload(tinyBoard(), l, suiteText("e"), policy, async () => replayResult(stroke(0, "E"), [warning]));
      expect(r.tasks[0]).toMatchObject({ status: "verified", costsVerified: true, warnings: [warning], scopeWarnings: [warning] });
    }
    for (const warning of ["unknown usage 999", "rules.mk settings that are hardware only were not applied: CUSTOM_ENABLE=yes", "1 binding uses &bt, replaced with &none", "mouse output ignored"]) {
      const r = await evaluateWorkload(tinyBoard(), l, suiteText("e"), policy, async () => replayResult(stroke(0, "E"), [warning]));
      expect(r.tasks[0]).toMatchObject({ status: "warning-tainted", costsVerified: false }); expect(r.coverage.verifiedOutputs).toBe(0);
    }
  });
  test("full denominator survives unsupported Unicode, no route, and execution errors", async () => {
    const suite = WorkloadSuiteSchema.parse({ schemaVersion: 1, id: "mixed", host: "us-ansi", tasks: [{ id: "unicode", kind: "text", text: "é" }, { id: "missing", kind: "text", text: "z" }, { id: "fails", kind: "text", text: "e" }] });
    let calls = 0;
    const r = await evaluateWorkload(tinyBoard(), tinyLayout([key("E"), none, none, none]), suite, policy, async () => { calls++; throw new Error("random/private/path"); });
    expect(calls).toBe(1); expect(r.coverage).toEqual({ totalTasks: 3, verifiedTasks: 0, requestedOutputs: 3, verifiedOutputs: 0 });
    expect(r.tasks.map((t) => t.status)).toEqual(["unsupported", "no-route-within-supported-subset", "execution-error"]);
    expect(JSON.stringify(r)).not.toContain("random/private/path");
  });
  test("kanata remains explicitly unsupported without replay", async () => {
    const l = tinyLayout([key("E"), none, none, none]); l.firmware = "kanata";
    const r = await evaluateWorkload(tinyBoard(), l, suiteText("e"), policy, async () => { throw new Error("must not run"); });
    expect(r.tasks[0]?.status).toBe("unsupported");
  });
  test("lower action cost cannot win with wrong/partial output or warnings", async () => {
    const good = await evaluateWorkload(tinyBoard(), layered(), suiteText("ee"), policy, async () => replayResult([...stroke(0, "E"), ...stroke(20, "E")]));
    const direct = tinyLayout([key("E"), none, none, none]);
    const bad = await evaluateWorkload(tinyBoard(), direct, suiteText("ee"), policy, async () => replayResult(stroke(0, "E")));
    expect(compareWorkloadEvidence(good, bad).verdict).toBe("inconclusive");
    const better = await evaluateWorkload(tinyBoard(), direct, suiteText("ee"), policy, async () => replayResult([...stroke(0, "E"), ...stroke(20, "E")]));
    expect(compareWorkloadEvidence(good, better)).toMatchObject({ verdict: "verified-improvement", deltas: [{ id: "task", physicalKeydowns: -1, maxSimultaneousKeys: -1 }] });
    const wider = structuredClone(better);
    if (wider.tasks[0]?.costs) wider.tasks[0].costs.maxSimultaneousKeys = 3;
    expect(compareWorkloadEvidence(good, wider).verdict).toBe("tradeoff");
  });
});

test("schema rejects empty, oversized, duplicate and prototype-key shapes before replay", () => {
  expect(builtinWorkloadSuites().map((s) => s.id)).toEqual(["prose", "typescript", "python", "json", "shell", "shortcuts"]);
  const valid = suiteText("e");
  for (const raw of [{ ...valid, tasks: [] }, { ...valid, host: "uk" }, { ...valid, schemaVersion: 2 }, { ...valid, tasks: [valid.tasks[0], valid.tasks[0]] }, { ...valid, tasks: [{ id: "long", kind: "text", text: "e".repeat(513) }] }, JSON.parse('{"schemaVersion":1,"id":"tiny","host":"us-ansi","tasks":[{"id":"task","kind":"text","text":"e"}],"__proto__":{"bad":true}}')]) expect(WorkloadSuiteSchema.safeParse(raw).success).toBe(false);
  expect(WorkloadPolicySchema.safeParse({ maxExpansions: 0 }).success).toBe(false);
  expect(WorkloadSuiteSchema.safeParse({ ...valid, tasks: [{ id: "bad", kind: "hid", strokes: [{ key: "constructor", mods: [] }] }] }).success).toBe(false);
  expect(WorkloadSuiteSchema.safeParse({ ...valid, tasks: Array.from({ length: 33 }, (_, i) => ({ id: `task-${i}`, kind: "text", text: "e" })) }).success).toBe(false);
  const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `task-${i}`, kind: "text", text: "e".repeat(512) }));
  expect(WorkloadSuiteSchema.safeParse({ ...valid, tasks }).success).toBe(true);
  expect(WorkloadSuiteSchema.safeParse({ ...valid, tasks: [...tasks, { id: "overflow", kind: "text", text: "e" }] }).success).toBe(false);
});

for (const code of ["SYSTEM_POWER", "SYSTEM_SLEEP", "SYSTEM_WAKE"]) {
  test(`HID stroke schema rejects non-keyboard system usage ${code}`, () => {
    expect(WorkloadSuiteSchema.safeParse({ schemaVersion: 1, id: "system", host: "us-ansi", tasks: [{ id: "key", kind: "hid", strokes: [{ key: code, mods: [] }] }] }).success).toBe(false);
  });
}

for (const overLimit of [false, true]) {
  test(`planner uses the last event timestamp at the duration ${overLimit ? "overflow" : "boundary"}`, () => {
    const mods = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"] as const;
    const layout = tinyLayout([key("E"), ...mods.map((mod) => ({ kind: "modifier" as const, mods: [mod] }))]);
    const strokes = Array.from({ length: 176 }, () => [{ key: "E", mods: [...mods] }, { key: "E", mods: [] }]).flat();
    strokes.push({ key: "E", mods: mods.slice(0, 4) });
    if (overLimit) strokes.push({ key: "E", mods: [] });
    const suite = WorkloadSuiteSchema.parse({ schemaVersion: 1, id: "boundary", host: "us-ansi", tasks: [{ id: "task", kind: "hid", strokes }] });
    const result = planTask(layout, suite.tasks[0]!, { ...policy, eventMs: 34 });
    expect(result.status).toBe(overLimit ? "search-limit" : "planned");
    if (!overLimit) {
      expect(result.events).toHaveLength(3530);
      expect(result.events.at(-1)?.at).toBe(119986);
      expect(result.events.filter((e) => e.action === "press")).toHaveLength(1765);
      expect(result.events.filter((e) => e.action === "release")).toHaveLength(1765);
    } else expect(result.events).toEqual([]);
  });
}

test("task protection is policy, while assessment completeness is separate", async () => {
  const layout = tinyLayout([key("E"), none, none, none]);
  const verified = await evaluateWorkload(tinyBoard(), layout, suiteText("e"), policy, async () => replayResult(stroke(0, "E")));
  const incomplete = await evaluateWorkload(tinyBoard(), layout, suiteText("e"), policy, async () => replayResult([]));
  expect(compareWorkloadEvidence(verified, incomplete)).toMatchObject({ allTasksProtected: true, allTasksAssessed: false, verdict: "inconclusive" });
  const moreCostly = structuredClone(verified);
  moreCostly.tasks[0]!.costs!.physicalKeydowns = 2;
  expect(compareWorkloadEvidence(verified, moreCostly)).toMatchObject({ allTasksProtected: true, allTasksAssessed: true, verdict: "regression" });
  const extra = structuredClone(verified);
  extra.tasks.push({ ...extra.tasks[0]!, id: "extra" });
  expect(compareWorkloadEvidence(verified, extra)).toMatchObject({ allTasksProtected: true, allTasksAssessed: false, verdict: "inconclusive" });
});
