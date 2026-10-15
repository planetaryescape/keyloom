import { describe, expect, test } from "bun:test";
import type { PriorityCard, ProposalCard } from "../../src/api/http.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Binding } from "../../src/layout/schema.ts";
import { validate } from "../../src/validation/validate.ts";
import { compareRows, groupProposals, movesOf, summaryOf } from "../../src/web/chat/compare.ts";
import { priorityChipText } from "../../src/web/chat/priorities.ts";
import { arrowsOn, otherMarkedLayers, previewProposal } from "../../src/web/chat/preview.ts";
import { FIXTURE_DIR, moonlander } from "../helpers/board.ts";

const board = await moonlander();
const { layout: head } = await importOryxSource(FIXTURE_DIR, board.definition);

const cmdShift: Binding = { kind: "modifier", mods: ["LGUI", "LSFT"] };
const base = (position: number) => ({ layerId: "layer-0", position });

/** A card for ops against BK's real layout, with the validator's real answer. */
function card(id: string, group: string | null, ops: ChangeOp[], over: Partial<ProposalCard> = {}): ProposalCard {
  return { changeSetId: id, proposalGroup: group, title: id, explanation: "why", tradeoffs: { gains: [], costs: [] }, status: "proposed", validation: validate(board.definition, head, ops), ops, ...over };
}

const onTab = card("tab", "g1", [{ op: "setBinding", at: base(42), binding: cmdShift }]);
const onF16 = card("f16", "g1", [
  { op: "dropFunction", function: "key:F16", reason: "never used" },
  { op: "setBinding", at: base(6), binding: cmdShift },
]);

describe("groupProposals", () => {
  test("alternatives from one call share a group; a second call, or a proposal with none, stands apart", () => {
    const lone = card("lone", null, [{ op: "setBinding", at: base(6), binding: cmdShift }]);
    const later = card("later", "g2", [{ op: "setBinding", at: base(6), binding: cmdShift }]);
    expect(groupProposals([onTab, onF16, later, lone, lone].map((c, i) => ({ ...c, changeSetId: `${c.changeSetId}${i}` })))
      .map((g) => g.map((c) => c.changeSetId))).toEqual([["tab0", "f161"], ["later2"], ["lone3"], ["lone4"]]);
    expect(groupProposals([])).toEqual([]);
  });
});

describe("compareRows and moves", () => {
  test("a displaced function with a new home reads as a move; one with none reads as dropped", () => {
    const [tab, f16] = compareRows([onTab, onF16], head);
    expect(tab).toMatchObject({ number: 1, relearn: 1, dropped: 0, warnings: 0, summary: "Moves Tab", movesPinned: false });
    expect(f16).toMatchObject({ number: 2, relearn: 0, dropped: 1, warnings: 0, summary: "Drops F16" });
    expect(movesOf(onTab)).toEqual([{ key: "key:TAB:layer-0:42", function: "key:TAB", from: base(42), to: base(67) }]);
    expect(movesOf(onF16)).toEqual([]);
  });

  test("a change that moves a pinned key says so in its row", () => {
    const warned = card("bs", "g1", [{ op: "setBinding", at: base(28), binding: cmdShift }], {
      validation: validate(board.definition, head, [{ op: "setBinding", at: base(28), binding: cmdShift }], {
        pinned: [{ decisionId: "dec_1", statement: "keep Backspace", slots: [], functions: ["key:BACKSPACE"] }],
      }),
    });
    expect(compareRows([warned], head)[0]).toMatchObject({ warnings: 1, movesPinned: true });
  });

  test("a long list of moved functions is shortened", () => {
    const many = card("many", "g1", [{ op: "setBinding", at: base(42), binding: cmdShift }]);
    const names = ["a", "b", "c", "d"].map((code) => ({ function: `key:${code.toUpperCase()}`, from: base(1), to: base(2) }));
    const forged = { ...many, validation: { ...many.validation, diff: { ...many.validation.diff, displaced: names } } };
    expect(summaryOf(forged, head)).toBe("Moves A, B and 2 more");
  });

  test("a change that moves nothing says so", () => {
    const quiet = card("q", "g1", [{ op: "setBinding", at: base(6), binding: { kind: "key", code: "F16" } }]);
    expect(summaryOf(quiet, head)).toBe("Nothing else moves");
  });
});

describe("arrows on the board", () => {
  test("a move inside the shown layer is an arrow; the other layers are marked instead", () => {
    const preview = previewProposal(board.definition, head, onTab, "layer-0");
    expect(arrowsOn(preview, "layer-0")).toEqual([{ from: 42, to: 67 }]);
    expect(arrowsOn(preview, "layer-1")).toEqual([]);
    expect(arrowsOn(null, "layer-0")).toEqual([]);
    expect([...otherMarkedLayers(preview, "layer-1")]).toEqual(["layer-0"]);
    expect([...otherMarkedLayers(preview, "layer-0")]).toEqual([]);
  });

  test("a move across layers draws no arrow but marks the other layer", () => {
    const across: ProposalCard = card("x", "g1", [{ op: "setBinding", at: base(42), binding: cmdShift }]);
    const preview = previewProposal(board.definition, head, across, "layer-0");
    const forged = { ...preview, moves: [{ from: base(42), to: { layerId: "layer-2", position: 3 } }], homes: [{ layerId: "layer-2", position: 3 }] };
    expect(arrowsOn(forged, "layer-0")).toEqual([]);
    expect([...otherMarkedLayers(forged, "layer-0")]).toEqual(["layer-2"]);
  });
});

describe("priority chips", () => {
  const chip = (priorityKind: PriorityCard["priorityKind"], subject: PriorityCard["subject"]): PriorityCard => ({
    id: "dec_1", priorityKind, statement: "said", reason: "stated by BK", subject, sourceMessageIds: [], createdAt: 1,
  });

  test("each kind reads as a short sentence in the editor's words", () => {
    const bs = { functions: ["key:BACKSPACE"] };
    expect(priorityChipText(chip("pinned", bs), head)).toBe("Backspace stays where it is");
    expect(priorityChipText(chip("rarely_used", { functions: ["key:F16"] }), head)).toBe("F16: rarely used");
    expect(priorityChipText(chip("frequent", { functions: ["key:A", "key:B"] }), head)).toBe("A, B: used often");
    expect(priorityChipText(chip("willing_to_relearn", { slots: [base(29)] }), head)).toBe("Happy to relearn Layer 0, key 30");
  });
});
