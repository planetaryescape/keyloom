import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import { OPTIONS, baselineOf, currentValue, optionsFor, otherSettings, sourceText } from "../../src/layout/firmware-options.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { settingsChange } from "../../src/layout/settings-ops.ts";
import { moonlander } from "../helpers/board.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";

const board = (await moonlander()).definition;
const layout = (await importOryxSource(FIXTURE_DIR, board)).layout;
const spec = (key: string) => OPTIONS.find((o) => o.firmware === "qmk" && o.key === key) ?? (() => { throw new Error(key); })();

describe("what the page shows", () => {
  test("a QMK board is offered QMK options only, and a ZMK board ZMK ones", () => {
    expect(optionsFor(board).every((o) => o.firmware === "qmk")).toBe(true);
    expect(optionsFor({ firmware: "zmk" }).every((o) => o.firmware === "zmk")).toBe(true);
  });

  test("an option the layout doesn't set shows the firmware default, and Oryx's own settings show what Oryx set", () => {
    expect(currentValue(spec("TAPPING_TERM"), layout, board)).toBe(200);
    expect(currentValue(spec("CHORDAL_HOLD"), layout, board)).toBe(true);
    expect(currentValue(spec("PERMISSIVE_HOLD"), layout, board)).toBe(true);
    expect(currentValue(spec("CAPS_WORD_ENABLE"), layout, board)).toBe(false);
  });

  test("this board's own defaults win over the firmware's: the Moonlander has mouse keys on", () => {
    expect(currentValue(spec("MOUSEKEY_ENABLE"), layout, board)).toBe(true);
  });

  test("a feature switch reads rules.mk as Oryx wrote it", () => {
    const rules = layout.passthrough.map((p) => (p.file === "rules.mk" ? { ...p, source: `${p.source}\nCAPS_WORD_ENABLE = yes\n` } : p));
    expect(currentValue(spec("CAPS_WORD_ENABLE"), { ...layout, passthrough: rules }, board)).toBe(true);
  });

  test("what the options don't cover is listed read only, from the layout's own settings", () => {
    const keys = otherSettings(layout, board).map((s) => s.key);
    expect(keys).toContain("USB_SUSPEND_WAKEUP_DELAY");
    expect(keys).toContain("LAYER_STATE_8BIT");
    expect(keys).toContain("RGB_MATRIX_STARTUP_SPD");
    expect(keys).not.toContain("TAPPING_TERM");
  });
});

describe("an option set to code the page can't show", () => {
  test("is reported as the source text, not read as the default", () => {
    const odd: Layout = { ...layout, settings: [...layout.settings, { firmware: "qmk", key: "TAPPING_TERM", value: "(TAPPING_TERM_BASE + 10)" }] };
    expect(sourceText(spec("TAPPING_TERM"), odd)).toBe("(TAPPING_TERM_BASE + 10)");
    expect(sourceText(spec("TAPPING_TERM"), layout)).toBeUndefined();
  });
});

describe("the change set for edits", () => {
  const apply = (l: Layout, ops: NonNullable<ReturnType<typeof settingsChange>>["ops"]) => {
    const r = applyOps(l, ops);
    if (!r.ok) throw new Error(r.error.message);
    return r.layout;
  };

  test("no edits, or edits to the value already in force, are no change", () => {
    expect(settingsChange(layout, board, [])).toBeNull();
    expect(settingsChange(layout, board, [{ spec: spec("TAPPING_TERM"), value: 200 }])).toBeNull();
  });

  test("Caps Word, combo term and tapping term are one change set with one op each", () => {
    const change = settingsChange(layout, board, [
      { spec: spec("CAPS_WORD_ENABLE"), value: true },
      { spec: spec("COMBO_TERM"), value: 40 },
      { spec: spec("TAPPING_TERM"), value: 180 },
    ]);
    expect(change?.summary).toBe("Settings: Caps Word on, Combo term 40 ms, Tapping term 180 ms");
    const next = apply(layout, change?.ops ?? []);
    const get = (k: string) => next.settings.find((s) => s.key === k)?.value;
    expect([get("CAPS_WORD_ENABLE"), get("COMBO_TERM"), get("TAPPING_TERM")]).toEqual([true, 40, 180]);
  });

  test("going back to the default removes the setting instead of writing the default", () => {
    const set = apply(layout, settingsChange(layout, board, [{ spec: spec("COMBO_TERM"), value: 40 }])?.ops ?? []);
    const back = settingsChange(set, board, [{ spec: spec("COMBO_TERM"), value: 50 }]);
    expect(back?.ops).toEqual([{ op: "removeFirmwareSetting", firmware: "qmk", key: "COMBO_TERM" }]);
    expect(apply(set, back?.ops ?? []).settings.some((s) => s.key === "COMBO_TERM")).toBe(false);
  });

  test("turning off what Oryx's rules.mk turns on is an explicit off, because removing the setting would leave it on", () => {
    const on: Layout = { ...layout, passthrough: layout.passthrough.map((p) => (p.file === "rules.mk" ? { ...p, source: `${p.source}\nCAPS_WORD_ENABLE = yes\n` } : p)) };
    expect(baselineOf(spec("CAPS_WORD_ENABLE"), on, board)).toBe(true);
    const change = settingsChange(on, board, [{ spec: spec("CAPS_WORD_ENABLE"), value: false }]);
    expect(change?.ops).toEqual([{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "CAPS_WORD_ENABLE", value: false } }]);
  });

  test("turning off an option Oryx set removes it (the firmware default is off)", () => {
    const change = settingsChange(layout, board, [{ spec: spec("CHORDAL_HOLD"), value: false }]);
    expect(change?.ops[0]).toEqual({ op: "removeFirmwareSetting", firmware: "qmk", key: "CHORDAL_HOLD" });
  });

  test("a profile that copied the setting follows it, so the hold-taps don't keep the old feel", () => {
    // BK's profiles carry CHORDAL_HOLD and PERMISSIVE_HOLD copies of the settings.
    const change = settingsChange(layout, board, [{ spec: spec("PERMISSIVE_HOLD"), value: false }]);
    const next = apply(layout, change?.ops ?? []);
    for (const profile of next.holdTapProfiles) expect(profile.options.PERMISSIVE_HOLD).toBeUndefined();
    expect(next.holdTapProfiles.length).toBeGreaterThan(0);
  });

  test("two edits to one profile are one upsert, not two that undo each other", () => {
    const change = settingsChange(layout, board, [{ spec: spec("PERMISSIVE_HOLD"), value: false }, { spec: spec("CHORDAL_HOLD"), value: false }]);
    const upserts = change?.ops.filter((o) => o.op === "upsertHoldTapProfile") ?? [];
    expect(upserts.length).toBe(layout.holdTapProfiles.length);
    for (const u of upserts) if (u.op === "upsertHoldTapProfile") expect(u.profile.options).toEqual({});
  });

  test("a profile with its own value for the option keeps it, and the change says so", () => {
    const own: Layout = { ...layout, holdTapProfiles: layout.holdTapProfiles.map((p, i) => (i === 0 ? { ...p, options: { ...p.options, TAPPING_TERM: 170 } } : p)) };
    const change = settingsChange(own, board, [{ spec: spec("TAPPING_TERM"), value: 190 }]);
    expect(change?.keptOwn).toEqual([{ profile: own.holdTapProfiles[0]?.name as string, label: "Tapping term" }]);
    expect(change?.ops.some((o) => o.op === "upsertHoldTapProfile")).toBe(false);
  });
});
