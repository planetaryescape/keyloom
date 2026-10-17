// The QMK to kanata rows that spike S33 settled against the simulator (docs/research/spikes/S33.md).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { generateKanataSource } from "../../src/firmware/kanata/generate.ts";
import { readKanataProfile, translateHoldTapProfile } from "../../src/layout/kanata/profiles.ts";
import type { FirmwareSetting, HoldTapProfile } from "../../src/layout/schema.ts";
import { kanataBinary, kanataCheck } from "../helpers/kanata-bin.ts";
import { at, macbook, richLayout } from "../helpers/macbook.ts";
import { tempDir } from "../helpers/tmp.ts";

const qmk: HoldTapProfile = { id: "hrm", name: "Home row", firmware: "qmk", options: {} };
const setting = (key: string, value: boolean | number): FirmwareSetting => ({ firmware: "qmk", key, value });
const variantOf = (...s: FirmwareSetting[]) => translateHoldTapProfile(qmk, s).profile.options;

describe("QMK CHORDAL_HOLD on kanata (S33)", () => {
  test("alone it is a tap on the same hand's keys only, not tap-hold-opposite-hand", () => {
    expect(variantOf(setting("CHORDAL_HOLD", true))).toMatchObject({ variant: "tap-hold-tap-keys", "tap-keys": "same-hand" });
  });
  test("with HOLD_ON_OTHER_KEY_PRESS the opposite hand's press holds at once", () => {
    expect(variantOf(setting("CHORDAL_HOLD", true), setting("HOLD_ON_OTHER_KEY_PRESS", true)).variant).toBe("tap-hold-opposite-hand");
  });
  test("with PERMISSIVE_HOLD the opposite hand's release holds", () => {
    expect(variantOf(setting("CHORDAL_HOLD", true), setting("PERMISSIVE_HOLD", true)).variant).toBe("tap-hold-opposite-hand-release");
  });
  test("tap-keys only goes with tap-hold-tap-keys", () => {
    const bad = readKanataProfile({ ...qmk, firmware: "kanata", options: { variant: "tap-hold", "tap-keys": "same-hand" } });
    expect(bad).toMatchObject({ ok: false });
  });
});

describe("QUICK_TAP_TERM on kanata (S33)", () => {
  test("says kanata counts from the press where QMK counts from the release", () => {
    const { notes } = translateHoldTapProfile(qmk, [setting("QUICK_TAP_TERM", 120)]);
    expect(notes.join(" ")).toMatch(/runs from the first tap's release in QMK.*runs from its press/);
  });
  test("is silent when QMK's default (the tapping term) applies", () => {
    expect(translateHoldTapProfile(qmk, []).notes).toEqual([]);
  });
});

describe("the same-hand tap-hold-tap-keys file", () => {
  const profile = translateHoldTapProfile(qmk, [setting("CHORDAL_HOLD", true)]).profile;
  const layout = richLayout();
  const withProfile = { ...layout, holdTapProfiles: layout.holdTapProfiles.map((p) => (p.id === "hrm" ? profile : p)) };
  const src = generateKanataSource({ layout: withProfile, board: macbook(), layoutId: "lay_T", revisionId: "rev_T" });
  const kbd = src.files.find((f) => f.path === "keyloom.kbd")!.content;

  test("each hand's keys are listed once and a key uses its own hand's list", () => {
    expect(kbd).toMatch(/left-keys \(.*\bq\b.*\)/);
    expect(kbd).toMatch(/right-keys \(.*\bp\b.*\)/);
    expect(kbd).toContain("(tap-hold-tap-keys 200 200 a lmeta $left-keys)");
  });

  test.skipIf(!kanataBinary())("kanata --check accepts it", async () => {
    const r = await kanataCheck(kanataBinary()!, kbd, tempDir(), join("same-hand.kbd"));
    expect(r.output).toContain("config file is valid");
  });
});

describe("a same-hand profile on a key with no hand", () => {
  test("is refused, not written as something else", () => {
    const profile = translateHoldTapProfile(qmk, [setting("CHORDAL_HOLD", true)]).profile;
    const layout = richLayout();
    const board = macbook();
    const handless = { ...board, hands: { left: board.hands.left.filter((p) => p !== at("A")), right: board.hands.right } };
    const withProfile = { ...layout, holdTapProfiles: layout.holdTapProfiles.map((p) => (p.id === "hrm" ? profile : p)) };
    expect(() => generateKanataSource({ layout: withProfile, board: handless, layoutId: "lay_T", revisionId: "rev_T" })).toThrow(/has no hand/);
  });
});
