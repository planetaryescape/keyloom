// Tuning how a key feels goes through hold-tap profiles on both firmwares (D-017): the change is
// validated, remembered as a decision about the keys it retunes, and lands in the generated source.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type ChangeOp, applyChange, checkChange, generateFirmware, getLayout, importLayout, openApp, proposeChange, showDecision,
} from "../../src/app/index.ts";
import type { HoldTapProfile } from "../../src/layout/schema.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { draft } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";
import { TEMPLATE_FIXTURE } from "../helpers/zmk.ts";

const profile = (p: HoldTapProfile): ChangeOp => ({ op: "upsertHoldTapProfile", profile: p });
const at = (layerId: string, position: number) => ({ layerId, position });

async function generated(app: Parameters<typeof generateFirmware>[0], ref: string, file: string): Promise<string> {
  const out = join(tempDir(), "gen");
  await generateFirmware(app, ref, { out });
  return Bun.file(join(out, file)).text();
}

describe("QMK: the Moonlander", () => {
  test("tuning one key through its own profile retunes only that key and reaches keymap.c and config.h", async () => {
    const { app, layoutId } = await commandShiftApp();
    const before = getLayout(app, layoutId).document;
    const f = before.layers[0]?.bindings[32];
    expect(f).toMatchObject({ kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LGUI"] }, profileId: "home-row-mods" });

    // F gets a quicker hold than the rest of the home row, which keeps its own feel.
    const ops: ChangeOp[] = [
      profile({ id: "command-f", name: "Command on F", firmware: "qmk", options: { CHORDAL_HOLD: true, PERMISSIVE_HOLD: true, TAPPING_TERM: 170 } }),
      { op: "setBinding", at: at("layer-0", 32), binding: { ...(f as object), profileId: "command-f" } as never },
    ];
    const cs = proposeChange(app, layoutId, {
      ops, explanation: "Quicker Command on F", source: "agent", decisionDraft: { ...draft({ goal: "holding F for Command feels slow", choice: "TAPPING_TERM 170 on F", reason: "200 ms was too slow" }), sourceMessageIds: [] },
    });
    expect(cs.validation.ok).toBe(true);
    expect(cs.validation.diff.changed).toEqual([at("layer-0", 32)]);
    const applied = applyChange(app, cs.id);
    expect(showDecision(app, applied.decisionId as string).subject.slots).toEqual([at("layer-0", 32)]);

    const keymap = await generated(app, layoutId, "keymap.c");
    expect(keymap).toContain("uint16_t get_tapping_term(uint16_t keycode, keyrecord_t *record) {");
    expect(keymap).toMatch(/case [^\n]*KC_F[^\n]*: return 170;/);
    expect(keymap).toContain("default: return TAPPING_TERM;");
    expect(await generated(app, layoutId, "config.h")).toContain("#define TAPPING_TERM_PER_KEY");
  });

  test("editing the shared profile retunes every key that uses it, which the diff and the decision list", async () => {
    const { app, layoutId } = await commandShiftApp();
    const hrm = getLayout(app, layoutId).document.holdTapProfiles.find((p) => p.id === "home-row-mods") as HoldTapProfile;
    const ops = [profile({ ...hrm, options: { ...hrm.options, TAPPING_TERM: 180 } })];
    const check = checkChange(app, layoutId, { ops });
    expect(check.ok).toBe(true);
    expect(check.diff.changed).toEqual([]);
    expect(check.diff.retuned.map((s) => s.position)).toEqual([30, 32, 33, 36, 37, 39]);
    expect(check.warnings.map((w) => w.code)).not.toContain("homerow_same_hand_mods"); // Chordal Hold is on
  });

  test("an option QMK can't set per key is refused before a build can fail on it", async () => {
    const { app, layoutId } = await commandShiftApp();
    const hrm = getLayout(app, layoutId).document.holdTapProfiles.find((p) => p.id === "home-row-mods") as HoldTapProfile;
    const check = checkChange(app, layoutId, { ops: [profile({ ...hrm, options: { ...hrm.options, FLOW_TAP_TERM: 150 } })] });
    expect(check.ok).toBe(false);
    expect(check.errors[0]?.message).toContain("FLOW_TAP_TERM");
  });

  test("a second tuning of the same keys reminds BK of the first and supersedes it", async () => {
    const { app, layoutId } = await commandShiftApp();
    const hrm = getLayout(app, layoutId).document.holdTapProfiles.find((p) => p.id === "home-row-mods") as HoldTapProfile;
    const tune = (term: number, reason: string) => {
      const cs = proposeChange(app, layoutId, {
        ops: [profile({ ...hrm, options: { ...hrm.options, TAPPING_TERM: term } })], explanation: reason, source: "agent",
        decisionDraft: { ...draft({ goal: "home-row mods feel slow", choice: `TAPPING_TERM ${term}`, reason }), sourceMessageIds: [] },
      });
      return { cs, applied: applyChange(app, cs.id) };
    };
    const first = tune(180, "a little quicker");
    const second = tune(160, "still slow");
    expect(second.cs.validation.diff.reminders.map((r) => r.decisionId)).toEqual([first.applied.decisionId as string]);
    expect(showDecision(app, first.applied.decisionId as string)).toMatchObject({ status: "superseded", supersededBy: second.applied.decisionId });
  });
});

describe("ZMK: the Glove80 template", () => {
  async function glove() {
    const app = openApp({ dataDir: tempDir() });
    const out = await importLayout(app, { board: "moergo/glove80", source: TEMPLATE_FIXTURE, name: "t" });
    return { app, ref: out.layoutId };
  }
  // F on the left home row of the template's base layer, which the home-row mod goes on.
  const F = 38;
  const hm = (options: HoldTapProfile["options"]): HoldTapProfile => ({ id: "hm", name: "Home-row mods", firmware: "zmk", options });

  test("a home-row mod is written with its profile, and a tuning change rewrites the profile in the generated keymap", async () => {
    const { app, ref } = await glove();
    const base = getLayout(app, ref).document.layers[0]!;
    const original = base.bindings[F];
    expect(original).toMatchObject({ kind: "key", code: "F" });
    const holdTap = { kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LGUI"] }, profileId: "hm" } as const;

    const setupOps = [profile(hm({ flavor: "balanced", "tapping-term-ms": 200, "quick-tap-ms": 150 })), { op: "setBinding", at: at(base.id, F), binding: holdTap }] as ChangeOp[];
    const first = checkChange(app, ref, { ops: setupOps });
    expect(first.errors).toEqual([]);
    // No opposite-hand rule yet: the validator says how to add one.
    expect(first.warnings.find((w) => w.code === "homerow_same_hand_mods")?.message).toContain("hold-trigger-key-positions");

    const setup = proposeChange(app, ref, {
      ops: setupOps,
      explanation: "Command on F", source: "agent", decisionDraft: { ...draft({ goal: "Command on the home row" }), sourceMessageIds: [] },
    });
    applyChange(app, setup.id);
    const keymap1 = await generated(app, ref, "glove80.keymap");
    expect(keymap1).toContain('flavor = "balanced";\n            tapping-term-ms = <200>;');

    // "Holding F for Command feels slow": a quicker term and an opposite-hand rule, as one change to the profile.
    const right = getLayout(app, ref).board.definition.hands.right;
    const tuned = hm({ flavor: "balanced", "tapping-term-ms": 160, "quick-tap-ms": 150, "hold-trigger-key-positions": right });
    const check = checkChange(app, ref, { ops: [profile(tuned)] });
    expect(check.ok).toBe(true);
    expect(check.diff.retuned).toEqual([at(base.id, F)]);
    expect(check.diff.reminders.map((r) => r.goal)).toEqual(["Command on the home row"]);
    expect(check.warnings.map((w) => w.code)).not.toContain("homerow_same_hand_mods");
    applyChange(app, proposeChange(app, ref, {
      ops: [profile(tuned)], explanation: "quicker", source: "agent", decisionDraft: { ...draft({ goal: "holding F for Command feels slow" }), sourceMessageIds: [] },
    }).id);

    const keymap2 = await generated(app, ref, "glove80.keymap");
    expect(keymap2).toContain('flavor = "balanced";\n            tapping-term-ms = <160>;');
    expect(keymap2).not.toContain('flavor = "balanced";\n            tapping-term-ms = <200>;');
    expect(keymap2).toContain(`hold-trigger-key-positions = <${right.join(" ")}>;`);
  });

  test("the built-in &mt can be tuned too, and is written as an override of ZMK's own", async () => {
    const { app, ref } = await glove();
    const base = getLayout(app, ref).document.layers[0]!;
    const mt: HoldTapProfile = { id: "mt", name: "Mod-Tap", firmware: "zmk", options: { bindings: "&kp &kp", flavor: "hold-preferred", "tapping-term-ms": 150 } };
    const ops = [profile(mt), { op: "setBinding", at: at(base.id, F), binding: { kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LGUI"] }, profileId: "mt" } }] as ChangeOp[];
    expect(checkChange(app, ref, { ops }).ok).toBe(true);
    applyChange(app, proposeChange(app, ref, { ops, explanation: "mt", source: "editor" }).id);
    expect(await generated(app, ref, "glove80.keymap")).toContain("&mt {\n    tapping-term-ms = <150>;\n};");
  });

  test("a flavor ZMK doesn't have is an error in the preview, not a failed build", async () => {
    const { app, ref } = await glove();
    const check = checkChange(app, ref, { ops: [profile(hm({ flavor: "quick" }))] });
    expect(check.ok).toBe(false);
    expect(check.errors[0]?.message).toContain("flavor");
  });
});
