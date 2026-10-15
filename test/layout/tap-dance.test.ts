// The tap dance model: ops, the text-step keys, and how a tap dance reads in grids, caps and sentences (16, D-150..D-157).
import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { describeKey } from "../../src/layout/describe.ts";
import { bindingLegend } from "../../src/layout/legend.ts";
import { bindingLabel, renderLayout, tapDanceLegend } from "../../src/layout/render-grid.ts";
import { type Layout, LayoutSchema, type TapDance } from "../../src/layout/schema.ts";
import { staleConflicts } from "../../src/layout/stale.ts";
import { textKeys } from "../../src/layout/text-keys.ts";
import { tiny } from "../helpers/tiny.ts";

const escCaps: TapDance = { id: "esc-caps", name: "Esc and Caps", tap: { kind: "key", code: "ESCAPE" }, doubleTap: { kind: "key", code: "CAPS_LOCK" } };
const full: TapDance = {
  id: "full", name: "Everything", tap: { kind: "key", code: "A", mods: ["LSFT"] }, hold: { kind: "modifier", mods: ["LCTL", "LSFT"] },
  doubleTap: { kind: "layer", action: "toggle", layerId: "num" }, tapThenHold: { kind: "macro", macroId: "m1" }, termMs: 180,
};
const withDances = (...tapDances: TapDance[]): Layout => ({ ...tiny(), tapDances, layers: tiny().layers.map((l, i) => (i === 0 ? { ...l, bindings: tapDances.map((t): Layout["layers"][number]["bindings"][number] => ({ kind: "tapDance", tapDanceId: t.id })).concat(l.bindings).slice(0, 4) } : l)) });

describe("ops", () => {
  test("upsertTapDance adds, then replaces in place; removeTapDance removes; the input is not changed", () => {
    const base = tiny();
    const add = applyOps(base, [{ op: "upsertTapDance", tapDance: escCaps }]);
    expect(add.ok && add.layout.tapDances).toEqual([escCaps]);
    expect(base.tapDances).toEqual([]);
    const edit = applyOps(add.ok ? add.layout : base, [{ op: "upsertTapDance", tapDance: { ...escCaps, name: "Renamed" } }, { op: "upsertTapDance", tapDance: full }]);
    expect(edit.ok && edit.layout.tapDances.map((t) => t.name)).toEqual(["Renamed", "Everything"]);
    const gone = applyOps(edit.ok ? edit.layout : base, [{ op: "removeTapDance", tapDanceId: "esc-caps" }]);
    expect(gone.ok && gone.layout.tapDances.map((t) => t.id)).toEqual(["full"]);
  });

  test("removing a tap dance that isn't there stops the run with unknown_ref and names it", () => {
    const r = applyOps(tiny(), [{ op: "removeTapDance", tapDanceId: "ghost" }]);
    expect(r).toMatchObject({ ok: false, error: { index: 0, code: "unknown_ref", message: 'no tap dance "ghost"' } });
  });

  test("the schema rejects a slot that nests, a zero term and an empty id", () => {
    const parse = (tapDance: unknown) => LayoutSchema.safeParse({ ...tiny(), tapDances: [tapDance] }).success;
    expect(parse(escCaps)).toBe(true);
    expect(parse({ ...escCaps, doubleTap: { kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LSFT"] }, profileId: "p" } })).toBe(false);
    expect(parse({ ...escCaps, doubleTap: { kind: "tapDance", tapDanceId: "x" } })).toBe(false);
    expect(parse({ ...escCaps, termMs: 0 })).toBe(false);
    expect(parse({ ...escCaps, termMs: 150.5 })).toBe(false);
    expect(parse({ ...escCaps, id: "" })).toBe(false);
    expect(parse({ ...escCaps, tap: undefined })).toBe(false);
  });

  test("a stale change set is told which tap dance moved under it", () => {
    const base = withDances(escCaps);
    const head = withDances({ ...escCaps, doubleTap: { kind: "key", code: "TAB" } });
    const ops: ChangeOp[] = [{ op: "upsertTapDance", tapDance: { ...escCaps, name: "x" } }];
    expect(staleConflicts(base, head, ops)).toEqual([{ label: "tap dance esc-caps" }]);
    expect(staleConflicts(base, base, ops)).toEqual([]);
  });
});

describe("text steps", () => {
  test("every printable ASCII character can be typed, with Shift only where the character needs it", () => {
    for (let c = 0x20; c <= 0x7e; c++) {
      const ch = String.fromCharCode(c);
      const typed = textKeys(ch);
      expect(typed.ok).toBe(true);
    }
    const hi = textKeys("Hi!");
    expect(hi).toEqual({ ok: true, keys: [{ code: "H", shift: true }, { code: "I", shift: false }, { code: "N1", shift: true }] });
    expect(textKeys("a\tb\n")).toMatchObject({ ok: true });
  });

  test("a character outside the US layout, or a control character, names itself", () => {
    expect(textKeys("naïve")).toEqual({ ok: false, char: "ï" });
    expect(textKeys("\u0007")).toEqual({ ok: false, char: "\u0007" });
    expect(textKeys("日本")).toEqual({ ok: false, char: "日" });
  });
});

describe("reading a tap dance", () => {
  const l = withDances(escCaps, full);
  const ctx = { layers: l.layers, macros: l.macros, tapDances: l.tapDances };

  test("a grid cell is TD and the dance's number, and the legend under the grids says what each slot does", () => {
    expect(bindingLabel({ kind: "tapDance", tapDanceId: "full" }, ctx)).toBe("TD1");
    expect(bindingLabel({ kind: "tapDance", tapDanceId: "ghost" }, ctx)).toBe("TD?");
    expect(bindingLabel({ kind: "tapDance", tapDanceId: "full" }, { layers: l.layers, macros: l.macros })).toBe("TD?");
    expect(tapDanceLegend(l.tapDances, ctx)).toEqual([
      "TD0  Esc and Caps: Esc tap, CAPS double-tap",
      "TD1  Everything: ⇧A tap, ⌃⇧ hold, TG1 double-tap, M0 tap then hold, term 180 ms",
    ]);
    const text = renderLayout(Array.from({ length: 4 }, (_, i) => ({ x: i, y: 0, w: 1, h: 1 })), l);
    expect(text).toContain("TD0");
    expect(text.endsWith("TD1  Everything: ⇧A tap, ⌃⇧ hold, TG1 double-tap, M0 tap then hold, term 180 ms")).toBe(true);
  });

  test("a layout with no tap dances prints no legend", () => {
    expect(renderLayout([{ x: 0, y: 0, w: 1, h: 1 }, { x: 1, y: 0, w: 1, h: 1 }, { x: 2, y: 0, w: 1, h: 1 }, { x: 3, y: 0, w: 1, h: 1 }], tiny())).not.toContain("Tap dances");
  });

  test("a cap shows the tap large and the other slots small", () => {
    expect(bindingLegend({ kind: "tapDance", tapDanceId: "esc-caps" }, ctx)).toEqual({ kind: "tapDance", tap: "Esc", hold: "2×CAPS" });
    expect(bindingLegend({ kind: "tapDance", tapDanceId: "full" }, ctx).hold).toBe("⌃⇧ 2×TG1 2×hold M0");
    expect(bindingLegend({ kind: "tapDance", tapDanceId: "ghost" }, ctx)).toEqual({ kind: "tapDance", tap: "TD?" });
  });

  test("the inspector's sentence lists every filled slot in words, and opens the layer a slot goes to", () => {
    const d = describeKey(l, 0, 1);
    expect(d?.headline).toBe("Tap dance Everything. Tapped: Left Shift + A; held: Left Ctrl + Left Shift; double-tapped: toggle Numbers; tapped, then held: macro Macro");
    expect(d?.fields).toEqual([
      { label: "Tapped", value: "Left Shift + A" }, { label: "Held", value: "Left Ctrl + Left Shift" }, { label: "Double-tapped", value: "toggle Numbers" },
      { label: "Tapped, then held", value: "macro Macro" }, { label: "Term", value: "180 ms" },
    ]);
    expect(d?.targetLayerId).toBe("num");
    expect(describeKey(l, 0, 0)?.fields).toEqual([{ label: "Tapped", value: "Esc" }, { label: "Double-tapped", value: "Caps Lock" }]);
  });
});
