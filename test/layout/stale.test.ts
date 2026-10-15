import { describe, expect, test } from "bun:test";
import type { ChangeOp } from "../../src/layout/change.ts";
import { applyOps } from "../../src/layout/apply-ops.ts";
import { staleConflicts } from "../../src/layout/stale.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { key, tiny } from "../helpers/tiny.ts";

const at = (layerId: string, position: number) => ({ layerId, position });
const head = (base: Layout, ops: ChangeOp[]): Layout => {
  const r = applyOps(base, ops);
  if (!r.ok) throw new Error(r.error.message);
  return r.layout;
};
const set = (layerId: string, position: number, code = "Z"): ChangeOp => ({ op: "setBinding", at: at(layerId, position), binding: key(code) });

describe("staleConflicts", () => {
  const base = tiny();

  test("a head equal to the base has no conflicts", () => {
    expect(staleConflicts(base, base, [set("base", 0)])).toEqual([]);
  });

  test("ops on slots the head did not change are clean", () => {
    const moved = head(base, [set("base", 1), set("num", 3)]);
    expect(staleConflicts(base, moved, [set("base", 0), set("num", 0)])).toEqual([]);
  });

  test("a slot the head changed is a conflict, and names the slot", () => {
    const moved = head(base, [set("base", 0, "Q")]);
    expect(staleConflicts(base, moved, [set("base", 0)])).toEqual([{ label: "base:0", slot: at("base", 0) }]);
  });

  test("moves and swaps conflict on either end", () => {
    const moved = head(base, [set("num", 1, "Q")]);
    expect(staleConflicts(base, moved, [{ op: "moveBinding", from: at("base", 0), to: at("num", 1) }])).toHaveLength(1);
    expect(staleConflicts(base, moved, [{ op: "swapBindings", a: at("num", 1), b: at("base", 0) }])).toHaveLength(1);
    expect(staleConflicts(base, moved, [{ op: "swapBindings", a: at("base", 0), b: at("base", 1) }])).toEqual([]);
  });

  test("a head that wrote back the same binding is not a change", () => {
    const moved = head(base, [set("base", 0, "Q"), set("base", 0, "A")]);
    expect(staleConflicts(base, moved, [set("base", 0)])).toEqual([]);
  });

  test("removing a layer conflicts if any of its slots changed, but not if only another layer did", () => {
    const edited = head(base, [set("num", 0, "Q")]);
    expect(staleConflicts(base, edited, [{ op: "removeLayer", layerId: "num" }]).length).toBeGreaterThan(0);
    const other = head(base, [set("base", 0, "Q")]);
    expect(staleConflicts(base, other, [{ op: "removeLayer", layerId: "num" }])).toEqual([]);
  });

  test("macros, combos and settings conflict only on the same id", () => {
    const edited = head(base, [{ op: "upsertMacro", macro: { id: "m1", name: "New", steps: [{ op: "tap", code: "B" }] } }]);
    expect(staleConflicts(base, edited, [{ op: "removeMacro", macroId: "m1" }])).toHaveLength(1);
    expect(staleConflicts(base, edited, [{ op: "upsertMacro", macro: { id: "m2", name: "Other", steps: [{ op: "tap", code: "B" }] } }])).toEqual([]);
    const setting = head(base, [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "A", value: 1 } }]);
    expect(staleConflicts(base, setting, [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "B", value: 1 } }])).toEqual([]);
    expect(staleConflicts(base, setting, [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "A", value: 2 } }])).toHaveLength(1);
  });

  test("adding a layer conflicts when the head already has that id, not when the anchor was renamed", () => {
    const add: ChangeOp = { op: "addLayer", layer: { id: "fn", name: "Fn" }, afterLayerId: "base" };
    expect(staleConflicts(base, head(base, [add]), [add])).toHaveLength(1);
    expect(staleConflicts(base, head(base, [{ op: "renameLayer", layerId: "base", name: "Main" }]), [add])).toEqual([]);
  });

  test("dropFunction touches nothing", () => {
    const moved = head(base, [set("base", 0, "Q")]);
    expect(staleConflicts(base, moved, [{ op: "dropFunction", function: "key:A", reason: "r" }])).toEqual([]);
  });
});
