import { describe, expect, test } from "bun:test";
import type { HoldTapProfile, Layout } from "../../src/layout/schema.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { OPTIONS, optionsFromValues, ownProfileId, tuningOps, tuningSummary, usersOf, valuesFromProfile, type HoldTap } from "../../src/web/editor/tuning.ts";
import { slotName, keysLine, splitByLife, successorOf, kindWords } from "../../src/web/decisions/decision-text.ts";
import type { DecisionCard } from "../../src/api/http.ts";
import { loadFixture } from "../server/fixture.ts";

const { board, document: head } = await loadFixture();

function withHoldTaps(): { layout: Layout; profile: HoldTapProfile; slot: { layerId: string; position: number }; binding: HoldTap } {
  const layout = structuredClone(head);
  const profile: HoldTapProfile = { id: "hrm", name: "Home-row mods", firmware: layout.firmware, options: layout.firmware === "qmk" ? { PERMISSIVE_HOLD: true } : { flavor: "balanced" } };
  layout.holdTapProfiles = [profile];
  const layer = layout.layers[0]!;
  const binding: HoldTap = { kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LGUI"] }, profileId: "hrm" };
  layer.bindings[1] = binding;
  layer.bindings[2] = { ...binding, tap: { code: "J" }, hold: { mods: ["RGUI"] } };
  return { layout, profile, slot: { layerId: layer.id, position: 1 }, binding };
}

describe("tuning a hold-tap from the editor", () => {
  test("the fields shown are the ones the firmware takes per profile", () => {
    expect(OPTIONS.qmk.map((s) => s.key)).toEqual(["TAPPING_TERM", "QUICK_TAP_TERM", "PERMISSIVE_HOLD", "HOLD_ON_OTHER_KEY_PRESS"]);
    expect(OPTIONS.zmk.map((s) => s.key)).toEqual(["flavor", "tapping-term-ms", "quick-tap-ms", "require-prior-idle-ms"]);
  });

  test("an empty number removes the option, a number is whole milliseconds, and unknown options are carried through", () => {
    const { layout, profile } = withHoldTaps();
    const p: HoldTapProfile = { ...profile, options: { ...profile.options, "future-option": "keep" } };
    const values = valuesFromProfile(p, layout);
    const key = OPTIONS[p.firmware].find((s) => s.kind === "number")!.key;
    const set = optionsFromValues(p, { ...values, [key]: "170" }, layout);
    expect(set).toEqual({ ok: true, options: expect.objectContaining({ [key]: 170, "future-option": "keep" }) });
    const cleared = optionsFromValues({ ...p, options: { ...p.options, [key]: 200 } }, { ...values, [key]: "" }, layout);
    expect(cleared.ok && key in cleared.options).toBe(false);
    expect(optionsFromValues(p, { ...values, [key]: "fast" }, layout)).toMatchObject({ ok: false });
    expect(optionsFromValues(p, { ...values, [key]: "12.5" }, layout)).toMatchObject({ ok: false });
  });

  test("a change for one key gives it its own profile, and one for the profile edits it in place; no change is no ops", () => {
    const { layout, profile, slot, binding } = withHoldTaps();
    const key = OPTIONS[profile.firmware].find((s) => s.kind === "number")!.key;
    const options = { ...profile.options, [key]: 170 };
    expect(usersOf(layout, "hrm")).toHaveLength(2);

    const own = tuningOps({ layout, slot, binding, profile, options, scope: "key" });
    expect(own).toHaveLength(2);
    expect(own?.[0]).toMatchObject({ op: "upsertHoldTapProfile", profile: { id: "hrm-key-2", options } });
    expect(own?.[1]).toMatchObject({ op: "setBinding", at: slot, binding: { profileId: "hrm-key-2" } });
    // The ops the editor sends are ones the validator accepts, and they retune only this key.
    const result = evaluate(board, layout, own!).result;
    expect(result.errors).toEqual([]);
    expect(result.diff.changed).toEqual([slot]);

    const shared = tuningOps({ layout, slot, binding, profile, options, scope: "profile" });
    expect(shared).toEqual([{ op: "upsertHoldTapProfile", profile: { ...profile, options } }]);
    const retuned = evaluate(board, layout, shared!).result;
    expect(retuned.errors).toEqual([]);
    expect(retuned.diff.retuned).toEqual([slot, { layerId: slot.layerId, position: 2 }]);

    expect(tuningOps({ layout, slot, binding, profile, options: { ...profile.options }, scope: "key" })).toBeNull();
  });

  test("own profile ids are free and stable, and the summary names the change in the editor's words", () => {
    const { layout, profile, slot } = withHoldTaps();
    layout.holdTapProfiles.push({ ...profile, id: "hrm-key-2" });
    expect(ownProfileId(layout, "hrm", 1)).toBe("hrm-key-2-2");
    expect(ownProfileId(layout, "hrm-key-2", 5)).toBe("hrm-key-6");
    const key = OPTIONS[profile.firmware].find((s) => s.kind === "number")!;
    const text = tuningSummary(layout, slot, profile, { ...profile.options, [key.key]: 170 }, "key");
    expect(text).toBe(`Base, key 2: ${key.label.toLowerCase()} 170 ms`);
  });
});

describe("decision text", () => {
  const card = (over: Partial<DecisionCard>): DecisionCard => ({
    id: "dec_1", kind: "choice", priorityKind: null, status: "hypothesis", goal: "g", choice: "c", reason: "r", scope: { apps: [], habits: [] }, subject: {},
    outcomeNote: null, supersededBy: null, conversationId: null, sourceMessageIds: [], createdAt: 1, updatedAt: 1, ...over,
  });

  test("keys are named the way the editor numbers them, and a long list is counted", () => {
    expect(slotName(head, { layerId: "base", position: 4 })).toBe("Base, key 5");
    const slots = [0, 1, 2, 3, 4, 5].map((position) => ({ layerId: "base", position }));
    expect(keysLine(head, card({ subject: { slots } }))).toBe("Base, key 1; Base, key 2; Base, key 3; Base, key 4 and 2 more");
    expect(keysLine(head, card({ subject: { functions: ["key:BACKSPACE", "key:CAPS_LOCK"] } }))).toBe("Backspace, Caps Lock");
    expect(keysLine(head, card({ subject: { functions: ["mod:LGUI+LSFT"] } }))).toBe("Hold ⌘⇧");
  });

  test("replaced decisions are separated from active ones, and the successor is found", () => {
    const a = card({ id: "dec_a", status: "superseded", supersededBy: "dec_b" });
    const b = card({ id: "dec_b" });
    const split = splitByLife([b, a]);
    expect(split.active.map((d) => d.id)).toEqual(["dec_b"]);
    expect(split.replaced.map((d) => d.id)).toEqual(["dec_a"]);
    expect(successorOf(a, [a, b])?.id).toBe("dec_b");
    expect(successorOf(b, [a, b])).toBeUndefined();
    expect(kindWords(card({ kind: "priority", priorityKind: "pinned" }))).toBe("Keep in place");
    expect(kindWords(b)).toBe("Choice");
  });
});
