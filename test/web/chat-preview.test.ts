import { describe, expect, test } from "bun:test";
import type { ProposalCard } from "../../src/api/http.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { marksOn, otherMarkedLayers, previewProposal, rememberedOn } from "../../src/web/chat/preview.ts";
import { keyLabel, replacedNatives, slotName } from "../../src/web/chat/proposal-facts.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { loadFixture } from "../server/fixture.ts";

const { board, document: head } = await loadFixture();

function proposal(ops: ChangeOp[]): ProposalCard {
  return { changeSetId: "cs", proposalGroup: null, title: "t", explanation: "e", tradeoffs: { gains: [], costs: [] }, decisionDraft: null, status: "proposed", validation: evaluate(board, head, ops).result, ops };
}
const optionOn = (layerId: string, position: number): ChangeOp => ({ op: "setBinding", at: { layerId, position }, binding: { kind: "modifier", mods: ["LALT"] } });

describe("previewProposal", () => {
  test("draws the layout with the change in it and marks the changed key", () => {
    const preview = previewProposal(board, head, proposal([optionOn("base", 57)]), "base");
    expect(preview.layerId).toBe("base");
    expect(preview.layout.layers[0]?.bindings[57]).toEqual({ kind: "modifier", mods: ["LALT"] });
    expect(head.layers[0]?.bindings[57]).toEqual({ kind: "none" });
    expect([...marksOn(preview, "base")]).toEqual([[57, "changed"]]);
  });

  test("goes to the layer that has the change when the person is on another", () => {
    const preview = previewProposal(board, head, proposal([optionOn("nav", 32)]), "base");
    expect(preview.layerId).toBe("nav");
    expect(marksOn(preview, "nav").get(32)).toBe("changed");
    expect(marksOn(preview, "base").size).toBe(0);
  });

  test("stays on the current layer when it has a change too", () => {
    const preview = previewProposal(board, head, proposal([optionOn("nav", 32), optionOn("numbers", 32)]), "numbers");
    expect(preview.layerId).toBe("numbers");
  });

  test("a proposal that no longer applies shows the head, with the keys it meant marked", () => {
    const ok = proposal([optionOn("base", 57)]);
    const broken: ProposalCard = { ...ok, ops: [optionOn("gone", 1)] };
    const preview = previewProposal(board, head, broken, "base");
    expect(preview.layout).toBe(head);
    expect(preview.changed).toEqual([{ layerId: "base", position: 57 }]);
  });

  test("a displaced function's new home comes from the diff, and a changed key outranks a home", () => {
    const move = proposal([{ op: "moveBinding", from: { layerId: "base", position: 36 }, to: { layerId: "base", position: 57 } }]);
    const preview = previewProposal(board, head, move, "base");
    expect(preview.homes).toEqual([{ layerId: "base", position: 57 }]);
    // The moved function lands on a key that also changed, so that key reads as changed.
    expect(marksOn(preview, "base").get(57)).toBe("changed");
    expect(marksOn({ ...preview, changed: [] }, "base").get(57)).toBe("home");
  });
});

describe("proposal facts", () => {
  test("names a key by its layer and one-based position, and labels it by what it prints", () => {
    expect(slotName(head, { layerId: "nav", position: 32 })).toBe("Nav, key 33");
    expect(keyLabel(head, { layerId: "base", position: 32 })).toBe("S");
    expect(keyLabel(head, { layerId: "base", position: 57 })).toBe("empty");
    expect(keyLabel(head, { layerId: "missing", position: 0 })).toBe("?");
  });

  test("replacedNatives finds the native bindings a change would overwrite, and nothing else", () => {
    const withNative = structuredClone(head);
    withNative.layers[0]!.bindings[57] = { kind: "native", firmware: "qmk", source: "RGB_TOG", label: "RGB" };
    const card = proposal([optionOn("base", 57)]);
    expect(replacedNatives(head, card)).toEqual([]);
    expect(replacedNatives(withNative, card)).toEqual([{ slot: { layerId: "base", position: 57 }, binding: { kind: "native", firmware: "qmk", source: "RGB_TOG", label: "RGB" } }]);
  });

  test("a native binding the proposal moves to another key keeps its code, so it needs no confirmation", () => {
    const withNative = structuredClone(head);
    withNative.layers[0]!.bindings[57] = { kind: "native", firmware: "qmk", source: "RGB_TOG", label: "RGB" };
    const card = proposal([optionOn("base", 57)]);
    card.validation.diff.displaced = [{ function: "native:qmk:RGB_TOG", from: { layerId: "base", position: 57 }, to: { layerId: "base", position: 58 } }];
    expect(replacedNatives(withNative, card)).toEqual([]);
  });
});

describe("remembered reasons on the board (rung 6)", () => {
  test("a proposal that touches a remembered key marks it, using the reminders stored with the proposal", () => {
    const card = proposal([optionOn("base", 57)]);
    card.validation.diff.reminders = [{ decisionId: "dec_1", goal: "g", choice: "c", reason: "r", status: "hypothesis", slots: [{ layerId: "base", position: 57 }, { layerId: "nav", position: 3 }] }];
    const preview = previewProposal(board, head, card, "base");
    expect(preview.reminded).toEqual([{ layerId: "base", position: 57 }, { layerId: "nav", position: 3 }]);
    expect([...rememberedOn(preview, null, "base")]).toEqual([57]);
    expect([...rememberedOn(preview, null, "nav")]).toEqual([3]);
    expect(otherMarkedLayers(preview, "base")).toEqual(new Set(["nav"]));
  });

  test("a decision being pointed at marks its keys on the layer on screen, with or without a preview", () => {
    expect([...rememberedOn(null, [{ layerId: "base", position: 4 }, { layerId: "nav", position: 9 }], "base")]).toEqual([4]);
    expect(rememberedOn(null, null, "base").size).toBe(0);
  });
});

describe("retuned keys in a preview (rung 6)", () => {
  test("a hold-tap whose profile changes is marked like a changed key, and its layer is shown", () => {
    const layout = structuredClone(head);
    layout.layers[1]!.bindings[5] = { kind: "holdTap", tap: { code: "F" }, hold: { mods: ["LGUI"] }, profileId: "hrm" };
    layout.holdTapProfiles = [{ id: "hrm", name: "H", firmware: layout.firmware, options: {} }];
    const ops: ChangeOp[] = [{ op: "upsertHoldTapProfile", profile: { id: "hrm", name: "H", firmware: layout.firmware, options: layout.firmware === "qmk" ? { TAPPING_TERM: 170 } : { "tapping-term-ms": 170 } } }];
    const card = { ...proposal(ops), validation: evaluate(board, layout, ops).result };
    const preview = previewProposal(board, layout, card, layout.layers[0]!.id);
    expect(preview.layerId).toBe(layout.layers[1]!.id);
    expect(marksOn(preview, layout.layers[1]!.id).get(5)).toBe("changed");
  });
});
