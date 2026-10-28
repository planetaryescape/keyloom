import { describe, expect, test } from "bun:test";
import { identityLayout } from "../../src/firmware/kanata/identity.ts";
import type { Binding, Layout } from "../../src/layout/schema.ts";
import { homerowSameHandMods } from "../../src/validation/hold-tap-rules.ts";
import { documentRules } from "../../src/validation/rules.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { at, macbook, richLayout } from "../helpers/macbook.ts";

const board = macbook();
// The document rules, not `validate` with no ops: that reports a flaw that was already there as a warning, and these layouts are the flaw.
const issues = (layout: Layout) => documentRules(board, layout);
const codes = (layout: Layout) => issues(layout).map((e) => e.code);

const without = (layout: Layout, code: string): Layout => ({
  ...layout,
  layers: layout.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p) => (p === at(code) ? ({ kind: "none" } as Binding) : b)) } : l)),
});

describe("the MacBook's layouts", () => {
  test("the identity and the rich layout are valid", () => {
    expect(issues(identityLayout(board))).toEqual([]);
    expect(issues(richLayout())).toEqual([]);
  });

  test("Escape must stay reachable, whatever else changes", () => {
    const errors = issues(without(identityLayout(board), "ESCAPE"));
    expect(errors.map((e) => e.code)).toContain("remapper_lockout");
    expect(errors.find((e) => e.code === "remapper_lockout")?.plain).toContain("Escape");
  });

  test("a Control key must stay reachable; the MacBook has only a left one", () => {
    const gone = without(identityLayout(board), "LEFT_CTRL");
    expect(issues(gone).some((e) => e.code === "remapper_lockout" && e.plain?.includes("Control"))).toBe(true);
    expect(codes(identityLayout(board))).not.toContain("remapper_lockout");
  });

  test("Control as the hold of a home-row key counts, so the imported layout is allowed to move it", () => {
    const base = without(identityLayout(board), "LEFT_CTRL");
    const held: Layout = { ...base, holdTapProfiles: [{ id: "p", name: "p", firmware: "kanata", options: { variant: "tap-hold", "hold-ms": 200 } }],
      layers: base.layers.map((l) => ({ ...l, bindings: l.bindings.map((b, p) => (p === at("Z") ? ({ kind: "holdTap", tap: { code: "Z" }, hold: { mods: ["LCTL"] }, profileId: "p" } as Binding) : b)) })) };
    expect(codes(held)).not.toContain("remapper_lockout");
  });

  test("Escape on a layer you can't reach doesn't count", () => {
    const base = without(identityLayout(board), "ESCAPE");
    const hidden: Layout = { ...base, layers: [...base.layers, { id: "hidden", name: "Hidden", bindings: base.layers[0]!.bindings.map((_, p) => (p === 0 ? ({ kind: "key", code: "ESCAPE" } as Binding) : ({ kind: "transparent" } as Binding))) }] };
    expect(codes(hidden)).toContain("remapper_lockout");
  });

  test("an edit that would remove Escape is refused with the same rule", () => {
    const layout = identityLayout(board);
    const result = evaluate(board, layout, [
      { op: "dropFunction", function: "key:ESCAPE", reason: "test" },
      { op: "setBinding", at: { layerId: "base", position: at("ESCAPE") }, binding: { kind: "key", code: "F13" } },
    ]).result;
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("remapper_lockout");
  });
});

describe("what kanata can't write is refused before Apply", () => {
  const withDance = (td: object): Layout => ({ ...identityLayout(board), tapDances: [td as never] });

  test("a tap dance with a hold slot is written now (nested tap-hold), so it is not refused", () => {
    const layout = withDance({ id: "t", name: "Tab", tap: { kind: "key", code: "TAB" }, hold: { kind: "key", code: "ESCAPE" } });
    expect(issues(layout).some((e) => e.code === "firmware_unsupported")).toBe(false);
  });

  test("a kept kanata binding that runs a command, whatever it is called", () => {
    for (const source of ["(cmd rm -rf /)", "(cmd-log info error ls)", "(multi a (cmd x))"]) {
      const layout = identityLayout(board);
      layout.layers[0]!.bindings[at("Q")] = { kind: "native", firmware: "kanata", source, label: "x" };
      expect(issues(layout).some((e) => e.message.includes("runs a command as root")), source).toBe(true);
    }
  });

  test("a kept binding that would reshape the file", () => {
    const layout = identityLayout(board);
    layout.layers[0]!.bindings[at("Q")] = { kind: "native", firmware: "kanata", source: "a) (defsrc b", label: "x" };
    expect(issues(layout).length).toBeGreaterThan(0);
  });

  test("a hold-tap profile with options kanata doesn't have, or a bad time", () => {
    const layout = richLayout();
    const bad: Layout = { ...layout, holdTapProfiles: [{ id: "hrm", name: "HRM", firmware: "kanata", options: { variant: "nonsense", "hold-ms": -5, TAPPING_TERM: 200 } }, layout.holdTapProfiles[1]!] };
    const messages = issues(bad).map((e) => e.message).join("\n");
    expect(messages).toContain("variant must be one of");
    expect(messages).toContain("hold-ms must be a whole number");
    expect(messages).toContain('"TAPPING_TERM" is not a kanata hold-tap option');
  });

  test("a macro that holds a key that isn't a modifier", () => {
    const layout = { ...richLayout(), macros: [{ id: "m", name: "M", steps: [{ op: "press" as const, code: "A" as const }, { op: "tap" as const, code: "B" as const }] }] };
    expect(issues(layout).some((e) => e.message.includes("only modifiers can be held"))).toBe(true);
  });

  test("a key kanata can't send on macOS is refused on a layer, under a hold-tap, in a combo and in a tap dance, and a change that sets one is refused", () => {
    const unsendable = (layout: Layout) => issues(layout).filter((e) => e.code === "firmware_unsupported" && e.message.includes("Print Screen"));
    const onLayer = identityLayout(board);
    onLayer.layers[0]!.bindings[at("Q")] = { kind: "key", code: "PRINT_SCREEN" };
    expect(unsendable(onLayer).map((e) => e.slots)).toEqual([[{ layerId: "base", position: at("Q") }]]);
    expect(unsendable(onLayer)[0]?.plain).toContain("Print Screen");

    const underHold = identityLayout(board);
    underHold.layers[0]!.bindings[at("Q")] = { kind: "holdTap", tap: { code: "PRINT_SCREEN" }, hold: { mods: ["LSFT"] }, profileId: "p" };
    expect(unsendable(underHold)).toHaveLength(1);

    const inCombo: Layout = { ...identityLayout(board), combos: [{ id: "c", name: "Combo", positions: [at("A"), at("S")], layerIds: "all", output: { kind: "key", code: "PRINT_SCREEN" } }] };
    expect(unsendable(inCombo).map((e) => e.plain)).toEqual([expect.stringContaining('Combo "Combo"')]);
    const holdTapCombo: Layout = { ...identityLayout(board), combos: [{ id: "c", name: "Combo", positions: [at("A"), at("S")], layerIds: "all", output: { kind: "holdTap", tap: { code: "PRINT_SCREEN" }, hold: { mods: ["LSFT"] }, profileId: "p" } }] };
    expect(unsendable(holdTapCombo).map((e) => e.plain)).toEqual([expect.stringContaining('Combo "Combo"')]);

    const dance = withDance({ id: "t", name: "Tab", tap: { kind: "key", code: "PRINT_SCREEN" } });
    expect(unsendable(dance).map((e) => e.plain)).toEqual([expect.stringContaining('Tap dance "Tab"')]);

    const result = evaluate(board, identityLayout(board), [{ op: "setBinding", at: { layerId: "base", position: at("Q") }, binding: { kind: "key", code: "PRINT_SCREEN" } }]).result;
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("firmware_unsupported");
  });

  test("QMK and ZMK profiles on a kanata layout are refused until translated", () => {
    const layout = richLayout();
    const foreign: Layout = { ...layout, holdTapProfiles: [{ id: "hrm", name: "HRM", firmware: "qmk", options: { TAPPING_TERM: 200 } }, layout.holdTapProfiles[1]!] };
    expect(issues(foreign).some((e) => e.code === "firmware_unsupported" && e.message.includes("is for qmk"))).toBe(true);
  });

  test("a home-row modifier that holds without the other hand is warned about, and the opposite-hand variant clears it", () => {
    const rich = (variant: string) => homerowSameHandMods(board, richLayout(variant)).map((w) => w.code);
    expect(rich("tap-hold-release")).toContain("homerow_same_hand_mods");
    expect(rich("tap-hold-opposite-hand")).not.toContain("homerow_same_hand_mods");
  });
});
