// The key panel's extra slots and the ops they stand for (16, D-086): filling "When double-tapped" makes the key a
// tap dance, clearing it turns the key back, and the entry and the key change in one change set.
import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Binding, Layout, TapDance } from "../../src/layout/schema.ts";
import { validate } from "../../src/validation/validate.ts";
import { bindingFromDraft, draftFromBinding, incompleteReason, type Draft } from "../../src/web/editor/draft.ts";
import { keyChange } from "../../src/web/panel/change-ops.ts";
import { canAddExtraSlot, clearExtraSlot, danceFromDraft, danceName, danceUsers, newDanceId, setExtraSlot, slotFromPick, toggleSlotMod } from "../../src/web/panel/dance.ts";
import { addHold, pickHold, pickTap } from "../../src/web/panel/slots.ts";
import { T, key, tiny, tinyBoard } from "../helpers/tiny.ts";

const here = { layerId: "base", position: 3 };
const layout = (): Layout => tiny();
const empty = (l = layout()): Draft => draftFromBinding({ kind: "transparent" }, l, "base");
const apply = (l: Layout, ops: ChangeOp[]): Layout => {
  const r = applyOps(l, ops);
  if (!r.ok) throw new Error(r.error.message);
  return r.layout;
};
const escCapsDraft = (l = layout()): Draft =>
  setExtraSlot(pickTap(empty(l), { t: "key", code: "ESCAPE" }), "doubleTap", { kind: "key", code: "CAPS_LOCK" }, l, here);
const change = (l: Layout, draft: Draft, original: Binding = T, drops = new Map<string, string>()) => {
  const binding = bindingFromDraft(draft, l);
  if (binding === null) throw new Error(`incomplete: ${incompleteReason(draft, l)}`);
  return keyChange({ layout: l, slot: here, draft, binding, original, placements: [], drops });
};

describe("filling a slot makes the key a tap dance", () => {
  test("an empty key has no tap, so no extra slot can open yet; once it has one it can", () => {
    expect(canAddExtraSlot(empty())).toBe(false);
    expect(canAddExtraSlot(pickTap(empty(), { t: "key", code: "ESCAPE" }))).toBe(true);
    // A blank slot can't be started: nothing to double.
    expect(setExtraSlot(empty(), "doubleTap", { kind: "key", code: "A" }, layout(), here).doubleTap).toBeNull();
  });

  test("Esc tapped and Caps Lock double-tapped is one binding on the key and one entry, in one set of ops", () => {
    const l = layout();
    const d = escCapsDraft(l);
    expect(bindingFromDraft(d, l)).toEqual({ kind: "tapDance", tapDanceId: "td-base-4" });
    const c = change(l, d);
    expect(c.ops).toEqual([
      { op: "upsertTapDance", tapDance: { id: "td-base-4", name: "Esc, Caps Lock on double-tap", tap: { kind: "key", code: "ESCAPE" }, doubleTap: { kind: "key", code: "CAPS_LOCK" } } },
      { op: "setBinding", at: here, binding: { kind: "tapDance", tapDanceId: "td-base-4" } },
    ]);
    expect(c.after?.tapDances).toHaveLength(1);
  });

  test("the ops pass the validator against the layout they were made for", () => {
    const l = layout();
    const r = validate(tinyBoard, l, change(l, escCapsDraft(l), l.layers[0]?.bindings[3] as Binding, new Map([["key:D", "test"]])).ops);
    expect(r.errors).toEqual([]);
  });

  test("tap + hold + double-tap + tap-then-hold keep every slot, and the term", () => {
    const l = layout();
    let d = pickHold(addHold(pickTap(empty(l), { t: "key", code: "A" }), "p"), { t: "mods", mods: ["LCTL"] });
    d = setExtraSlot(d, "doubleTap", { kind: "key", code: "B" }, l, here);
    d = setExtraSlot(d, "tapThenHold", { kind: "layer", action: "momentary", layerId: "num" }, l, here);
    d = { ...d, danceTermMs: 180 };
    expect(danceFromDraft(d, l)).toEqual({
      id: "td-base-4", name: "A, Left Ctrl on hold, B on double-tap, Numbers on tap, then hold",
      tap: { kind: "key", code: "A" }, hold: { kind: "modifier", mods: ["LCTL"] }, doubleTap: { kind: "key", code: "B" },
      tapThenHold: { kind: "layer", action: "momentary", layerId: "num" }, termMs: 180,
    });
  });

  test("adding a double-tap to a hold-tap keeps the tap and the hold, and needs no hold-tap profile", () => {
    const l = tiny({ holdTapProfiles: [] });
    const hold = pickHold(addHold(pickTap(empty(l), { t: "key", code: "A" }), null), { t: "mods", mods: ["LSFT"] });
    expect(incompleteReason(hold, l)).toMatch(/no hold-tap profile/);
    const d = setExtraSlot(hold, "doubleTap", { kind: "key", code: "B" }, l, here);
    expect(incompleteReason(d, l)).toBeNull();
    expect(danceFromDraft(d, l)).toMatchObject({ tap: { kind: "key", code: "A" }, hold: { kind: "modifier", mods: ["LSFT"] } });
  });

  test("modifiers toggled onto a slot go with its key; a lone modifier can't be switched off to nothing", () => {
    expect(toggleSlotMod({ kind: "key", code: "TAB" }, "LGUI")).toEqual({ kind: "key", code: "TAB", mods: ["LGUI"] });
    expect(toggleSlotMod({ kind: "key", code: "TAB", mods: ["LGUI"] }, "LGUI")).toEqual({ kind: "key", code: "TAB" });
    expect(toggleSlotMod({ kind: "modifier", mods: ["LSFT"] }, "LSFT")).toEqual({ kind: "modifier", mods: ["LSFT"] });
    expect(toggleSlotMod({ kind: "layer", action: "toggle", layerId: "num" }, "LSFT")).toEqual({ kind: "layer", action: "toggle", layerId: "num" });
  });

  test("picks become slot actions: a modifier key is a modifier, a blank is no slot", () => {
    expect(slotFromPick({ t: "key", code: "LEFT_SHIFT" })).toEqual({ kind: "modifier", mods: ["LSFT"] });
    expect(slotFromPick({ t: "key", code: "A" })).toEqual({ kind: "key", code: "A" });
    expect(slotFromPick({ t: "transparent" })).toBeNull();
    expect(slotFromPick({ t: "none" })).toBeNull();
  });
});

describe("clearing the slots turns the key back", () => {
  const saved = (): { l: Layout; original: Binding } => {
    const l0 = layout();
    const l = apply(l0, change(l0, escCapsDraft(l0)).ops);
    return { l, original: l.layers[0]?.bindings[3] as Binding };
  };

  test("a dance read back from the layout fills the same slots", () => {
    const { l, original } = saved();
    const d = draftFromBinding(original, l, "base");
    expect(d.kind).toBe("key");
    expect(d.key.code).toBe("ESCAPE");
    expect(d.doubleTap).toEqual({ kind: "key", code: "CAPS_LOCK" });
    expect(d.danceId).toBe("td-base-4");
  });

  test("clearing the double-tap leaves the plain key and removes the entry nothing uses, in the same change set", () => {
    const { l, original } = saved();
    const d = clearExtraSlot(draftFromBinding(original, l, "base"), "doubleTap");
    expect(bindingFromDraft(d, l)).toEqual({ kind: "key", code: "ESCAPE" });
    const c = change(l, d, original);
    expect(c.ops).toEqual([
      { op: "setBinding", at: here, binding: { kind: "key", code: "ESCAPE" } },
      { op: "removeTapDance", tapDanceId: "td-base-4" },
    ]);
    expect(c.after?.tapDances).toEqual([]);
    // Caps Lock was only on the dance, so the validator asks for it to be dropped, as for any replaced key.
    expect(validate(tinyBoard, l, c.ops).errors.map((e) => e.function)).toEqual(["key:CAPS_LOCK"]);
    expect(validate(tinyBoard, l, change(l, d, original, new Map([["key:CAPS_LOCK", "test"]])).ops).ok).toBe(true);
  });

  test("clearing only the double-tap of a dance that has a hold goes back to a hold-tap", () => {
    const l0 = layout();
    let d = pickHold(addHold(pickTap(empty(l0), { t: "key", code: "A" }), "p"), { t: "mods", mods: ["LCTL"] });
    d = setExtraSlot(d, "doubleTap", { kind: "key", code: "B" }, l0, here);
    const l = apply(l0, change(l0, d).ops);
    const back = clearExtraSlot(draftFromBinding(l.layers[0]?.bindings[3] as Binding, l, "base"), "doubleTap");
    expect(bindingFromDraft(back, l)).toEqual({ kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LCTL"] }, profileId: "p" });
  });

  test("with a tap-then-hold left, the key is still a dance", () => {
    const { l, original } = saved();
    let d = setExtraSlot(draftFromBinding(original, l, "base"), "tapThenHold", { kind: "key", code: "TAB" }, l, here);
    d = clearExtraSlot(d, "doubleTap");
    expect(bindingFromDraft(d, l)).toEqual({ kind: "tapDance", tapDanceId: "td-base-4" });
    expect(danceFromDraft(d, l)).toMatchObject({ tapThenHold: { kind: "key", code: "TAB" } });
    expect(danceFromDraft(d, l)?.doubleTap).toBeUndefined();
  });

  test("a dance this key shared with another stays when this key stops using it", () => {
    const { l, original } = saved();
    const shared = apply(l, [{ op: "setBinding", at: { layerId: "num", position: 0 }, binding: original }]);
    const d = clearExtraSlot(draftFromBinding(original, shared, "base"), "doubleTap");
    expect(change(shared, d, original).ops.map((op) => op.op)).toEqual(["setBinding"]);
  });
});

describe("a dance other keys use", () => {
  const sharedLayout = (): { l: Layout; original: Binding } => {
    const l0 = layout();
    const l1 = apply(l0, change(l0, escCapsDraft(l0)).ops);
    const original = l1.layers[0]?.bindings[3] as Binding;
    return { l: apply(l1, [{ op: "setBinding", at: { layerId: "num", position: 0 }, binding: original }]), original };
  };

  test("changing it for this key only saves a copy and points this key at it", () => {
    const { l, original } = sharedLayout();
    const d = setExtraSlot(draftFromBinding(original, l, "base"), "tapThenHold", { kind: "key", code: "TAB" }, l, here);
    const c = change(l, d, original);
    expect(c.danceId).toBe("td-base-4-2");
    expect(c.ops.map((op) => op.op)).toEqual(["upsertTapDance", "setBinding"]);
    const after = c.after as Layout;
    expect(after.tapDances.map((t) => t.id)).toEqual(["td-base-4", "td-base-4-2"]);
    expect(danceUsers(after, "td-base-4")).toEqual([{ layerId: "num", position: 0 }]);
    expect(after.tapDances[0]?.tapThenHold).toBeUndefined();
  });

  test("changing it for every key edits the entry and leaves the bindings", () => {
    const { l, original } = sharedLayout();
    const d = { ...setExtraSlot(draftFromBinding(original, l, "base"), "tapThenHold", { kind: "key", code: "TAB" }, l, here), danceForAll: true };
    const c = change(l, d, original);
    expect(c.danceId).toBe("td-base-4");
    expect((c.after as Layout).tapDances).toHaveLength(1);
    expect((c.after as Layout).tapDances[0]?.tapThenHold).toEqual({ kind: "key", code: "TAB" });
  });

  test("an unchanged dance writes no entry, and a new id skips the ones taken", () => {
    const { l, original } = sharedLayout();
    const same = change(l, draftFromBinding(original, l, "base"), original);
    expect(same.ops.filter((op) => op.op === "upsertTapDance")).toEqual([]);
    expect(newDanceId(l, "base", 3)).toBe("td-base-4-2");
  });
});

describe("macros made in the picker", () => {
  test("a macro the slots point at is saved with the change, one they don't is not", () => {
    const l = layout();
    const used = { id: "macro-2", name: "Copy, paste", steps: [{ op: "tap" as const, code: "C", mods: ["LGUI" as const] }] };
    const unused = { id: "macro-3", name: "Unused", steps: [{ op: "tap" as const, code: "A" }] };
    const d: Draft = { ...pickTap(empty(l), { t: "macro", macroId: "macro-2" }), pendingMacros: [used, unused] };
    expect(change(l, d).ops).toEqual([
      { op: "upsertMacro", macro: used },
      { op: "setBinding", at: here, binding: { kind: "macro", macroId: "macro-2" } },
    ]);
  });

  test("a macro on a double-tap slot counts as used too", () => {
    const l = layout();
    const m = { id: "macro-2", name: "Hi", steps: [{ op: "text" as const, text: "hi" }] };
    const d: Draft = { ...setExtraSlot(pickTap(empty(l), { t: "key", code: "A" }), "doubleTap", { kind: "macro", macroId: "macro-2" }, l, here), pendingMacros: [m] };
    expect(change(l, d).ops.map((op) => op.op)).toEqual(["upsertMacro", "upsertTapDance", "setBinding"]);
  });
});

describe("naming", () => {
  test("a dance is named from its slots and keeps its own name when its slots haven't changed", () => {
    const l = layout();
    expect(danceName({ tap: { kind: "key", code: "ESCAPE" }, doubleTap: { kind: "key", code: "CAPS_LOCK" } }, l)).toBe("Esc, Caps Lock on double-tap");
    const named = tiny({ tapDances: [{ id: "x", name: "My name", tap: { kind: "key", code: "A" }, doubleTap: { kind: "key", code: "B" } } satisfies TapDance] });
    const d = draftFromBinding({ kind: "tapDance", tapDanceId: "x" }, named, "base");
    expect(danceFromDraft(d, named)?.name).toBe("My name");
    expect(danceFromDraft({ ...d, doubleTap: { kind: "key", code: "C" } }, named)?.name).toBe("A, C on double-tap");
  });

  test("a dance whose slots the panel can't show is left as it is, not rebuilt", () => {
    const odd = tiny({ tapDances: [{ id: "x", name: "Odd", tap: { kind: "key", code: "A" }, hold: { kind: "layer", action: "toggle", layerId: "num" }, doubleTap: { kind: "key", code: "B" } } satisfies TapDance] });
    const d = draftFromBinding({ kind: "tapDance", tapDanceId: "x" }, odd, "base");
    expect(d.kind).toBe("tapDance");
    expect(d.doubleTap).toBeNull();
    expect(bindingFromDraft(d, odd)).toEqual({ kind: "tapDance", tapDanceId: "x" });
  });
});
