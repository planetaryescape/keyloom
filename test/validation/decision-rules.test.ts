import { describe, expect, test } from "bun:test";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Binding } from "../../src/layout/schema.ts";
import type { DecisionFact } from "../../src/validation/decision-rules.ts";
import { validate } from "../../src/validation/validate.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { T, key, tiny, tinyBoard } from "../helpers/tiny.ts";

const at = (layerId: string, position: number) => ({ layerId, position });
const set = (layerId: string, position: number, binding: Binding): ChangeOp => ({ op: "setBinding", at: at(layerId, position), binding });
const fact = (over: Partial<DecisionFact> = {}): DecisionFact => ({
  decisionId: "dec_1", goal: "Command-Shift shortcuts", choice: "Command-Shift on key 2", reason: "my left hand is free during shortcuts",
  status: "hypothesis", slots: [at("base", 1)], functions: [], ...over,
});
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe("contradicts_decision (07, 08)", () => {
  test("a change to a key a decision placed carries the reason as a reminder and a warning, and does not block", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 1, key("Q"))], { decisions: [fact()] });
    expect(r.ok).toBe(true);
    expect(r.diff.reminders).toEqual([
      { decisionId: "dec_1", goal: "Command-Shift shortcuts", choice: "Command-Shift on key 2", reason: "my left hand is free during shortcuts", status: "hypothesis", slots: [at("base", 1)] },
    ]);
    const warning = r.warnings.find((w) => w.code === "contradicts_decision");
    expect(warning?.slots).toEqual([at("base", 1)]);
    expect(warning?.message).toContain("my left hand is free during shortcuts");
    expect(warning?.message).toContain("Base, key 2");
    expect(warning?.message).toContain("haven't tested");
  });

  test("a tried_helpful decision says so and asks for a stated reason; the reminder carries the status", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 1, key("Q"))], { decisions: [fact({ status: "tried_helpful" })] });
    expect(r.diff.reminders[0]?.status).toBe("tried_helpful");
    expect(r.warnings.find((w) => w.code === "contradicts_decision")?.message).toContain("it helped");
  });

  test("a tried_unhelpful decision raises no reminder, but evaluate still reports it as touched so apply can supersede it", () => {
    const e = evaluate(tinyBoard, tiny(), [set("base", 1, key("Q"))], { decisions: [fact({ status: "tried_unhelpful" })] });
    expect(e.result.diff.reminders).toEqual([]);
    expect(codes(e.result.warnings)).not.toContain("contradicts_decision");
    expect(e.touched).toEqual([{ decisionId: "dec_1", slots: [at("base", 1)] }]);
  });

  test("stays quiet when the change leaves the decision's keys alone", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 0, key("Q"))], { decisions: [fact()] });
    expect(r.diff.reminders).toEqual([]);
    expect(codes(r.warnings)).toEqual([]);
  });

  test("one reminder per decision however many of its keys change, naming every touched key", () => {
    const r = validate(tinyBoard, tiny(), [set("base", 0, key("Q")), set("base", 1, key("W"))], { decisions: [fact({ slots: [at("base", 0), at("base", 1), at("base", 3)] })] });
    expect(r.diff.reminders).toHaveLength(1);
    expect(r.diff.reminders[0]?.slots).toEqual([at("base", 0), at("base", 1)]);
  });

  test("a decision with no slots is touched when its function leaves the key it was on", () => {
    const by = fact({ slots: [], functions: ["key:B"] });
    expect(validate(tinyBoard, tiny(), [{ op: "moveBinding", from: at("base", 1), to: at("base", 3) }], { decisions: [by] }).diff.reminders).toHaveLength(1);
    expect(validate(tinyBoard, tiny(), [set("base", 0, key("Q"))], { decisions: [by] }).diff.reminders).toEqual([]);
  });

  test("a decision with slots ignores an unrelated copy of its function going away", () => {
    // key:B is on base 1 and nav 1; removing the nav copy does not contradict a decision about base 1.
    const r = validate(tinyBoard, tiny(), [set("nav", 1, T)], { decisions: [fact({ functions: ["key:B"] })] });
    expect(r.diff.reminders).toEqual([]);
  });

  test("removing the layer a decision placed keys on touches it", () => {
    const r = validate(tinyBoard, tiny(), [{ op: "removeLayer", layerId: "nav" }], { decisions: [fact({ slots: [at("nav", 0)] })] });
    expect(r.diff.reminders.map((x) => x.decisionId)).toEqual(["dec_1"]);
  });
});

describe("retuned keys (D-017)", () => {
  const ht = (profileId: string, code = "A"): Binding => ({ kind: "holdTap", tap: { code }, hold: { mods: ["LGUI"] }, profileId });
  const withHoldTap = () => {
    const layout = tiny();
    layout.layers[0]!.bindings[0] = ht("p");
    layout.layers[0]!.bindings[3] = ht("q", "D");
    layout.holdTapProfiles = [{ id: "p", name: "P", firmware: "qmk", options: {} }, { id: "q", name: "Q", firmware: "qmk", options: {} }];
    return layout;
  };

  test("changing a profile's options lists the keys that use it, and only those, as retuned", () => {
    const r = validate(tinyBoard, withHoldTap(), [{ op: "upsertHoldTapProfile", profile: { id: "p", name: "P", firmware: "qmk", options: { TAPPING_TERM: 150 } } }]);
    expect(r.ok).toBe(true);
    expect(r.diff.retuned).toEqual([at("base", 0)]);
    expect(r.diff.changed).toEqual([]);
  });

  test("a retuned key touches a decision about that key, so a second tuning reminds BK of the first", () => {
    const first = fact({ decisionId: "dec_tune", goal: "F held for Command felt slow", reason: "lowered the term to 150", slots: [at("base", 0)] });
    const r = validate(tinyBoard, withHoldTap(), [{ op: "upsertHoldTapProfile", profile: { id: "p", name: "P", firmware: "qmk", options: { TAPPING_TERM: 150 } } }], { decisions: [first] });
    expect(r.diff.reminders.map((x) => x.decisionId)).toEqual(["dec_tune"]);
  });

  test("a tap-hold setting retunes every hold-tap whose profile does not set the option itself", () => {
    const layout = withHoldTap();
    layout.holdTapProfiles[1] = { id: "q", name: "Q", firmware: "qmk", options: { TAPPING_TERM: 190 } };
    const r = validate(tinyBoard, layout, [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "TAPPING_TERM", value: 170 } }]);
    // q pins TAPPING_TERM, so the global setting does not change its feel; p follows the setting.
    expect(r.diff.retuned).toEqual([at("base", 0)]);
  });

  test("an unrelated setting retunes nothing", () => {
    const r = validate(tinyBoard, withHoldTap(), [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "RGB_MATRIX_STARTUP_SPD", value: 60 } }]);
    expect(r.diff.retuned).toEqual([]);
  });
});
