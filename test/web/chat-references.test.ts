import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalCard } from "../../src/api/http.ts";
import type { Reference } from "../../src/layout/references.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { Markdown } from "../../src/web/chat/Markdown.tsx";
import { referableProposals, referenceView, type ReferenceContext } from "../../src/web/chat/reference-view.ts";
import { AssistantMessage } from "../../src/web/chat/Turns.tsx";
import { ChatPanel } from "../../src/web/chat/ChatPanel.tsx";
import type { AssistantTurn, Turn } from "../../src/web/chat/transcript.ts";
import { loadFixture } from "../server/fixture.ts";

const fixture = await loadFixture();
const ops: ChangeOp[] = [{ op: "setBinding", at: { layerId: "base", position: 57 }, binding: { kind: "modifier", mods: ["LALT"] } }];
const validation = evaluate(fixture.board, fixture.document, ops).result;
const card = (id: string, over: Partial<ProposalCard> = {}): ProposalCard => ({
  changeSetId: id, proposalGroup: null, title: `Plain Option ${id}`, explanation: "A plain Option on the free key.",
  tradeoffs: { gains: [], costs: [] }, decisionDraft: null, status: "proposed", validation, ops, ...over,
});
const proposal = card("cs_open");

/** A context as the chat panel builds it, with every action recorded so a chip's effect can be read. */
function context(over: Partial<ReferenceContext> = {}): ReferenceContext & { calls: string[] } {
  const calls: string[] = [];
  return {
    layout: fixture.document,
    currentId: "lay_current",
    configNames: new Map([["lay_current", "Moonlander"], ["lay_copy", "Glove80 copy"]]),
    proposals: new Map([[proposal.changeSetId, proposal]]),
    actions: {
      onOpenConfig: (id) => void calls.push(`open ${id}`),
      onPin: (pinned) => void calls.push(`pin ${pinned.changeSetId}`),
      onShowLayer: (layerId) => void calls.push(`layer ${layerId}`),
      onFoundKey: (position) => void calls.push(`found ${position}`),
    },
    ...over,
    calls,
  };
}

describe("a reply's references on the page (D-468)", () => {
  test("a config marker opens that config with its id", () => {
    const calls: string[] = [];
    const view = referenceView({ kind: "config", id: "lay_copy" }, context({ actions: { onOpenConfig: (id) => void calls.push(`open ${id}`) } }));
    expect(view).toMatchObject({ kind: "chip", label: "Glove80 copy", title: "Open Glove80 copy" });
    if (view.kind !== "chip") throw new Error("expected a chip");
    view.onActivate();
    expect(calls).toEqual(["open lay_copy"]);
  });

  test("a proposal marker pins the matching card, and one that is no longer waiting reads as words with its status", () => {
    const calls: string[] = [];
    const view = referenceView({ kind: "proposal", id: proposal.changeSetId }, context({ actions: { onPin: (pinned) => void calls.push(`pin ${pinned.changeSetId}`) } }));
    expect(view).toMatchObject({ kind: "chip", label: "Plain Option cs_open", title: "Show this proposal on the board" });
    if (view.kind !== "chip") throw new Error("expected a chip");
    view.onActivate();
    expect(calls).toEqual(["pin cs_open"]);
    // Applied, superseded and rejected cards are facts about a change, not something to pin.
    for (const status of ["applied", "superseded", "rejected"] as const) {
      const done = card("cs_done", { status });
      expect(referenceView({ kind: "proposal", id: done.changeSetId }, context({ proposals: new Map([[done.changeSetId, done]]) }))).toEqual({
        kind: "words", text: `Plain Option cs_done (${status})`,
      });
    }
    // A proposal this thread does not hold is not this board's to pin.
    expect(referenceView({ kind: "proposal", id: "cs_other" }, context())).toEqual({ kind: "words", text: "cs_other" });
  });

  test("a layer marker shows that layer; a key marker shows its layer and pulses the key", () => {
    const layerCalls: string[] = [];
    const view = referenceView({ kind: "layer", layerId: "numbers" }, context({ actions: { onShowLayer: (id) => void layerCalls.push(`layer ${id}`) } }));
    expect(view).toMatchObject({ kind: "chip", label: "Numbers", title: "Show Numbers" });
    if (view.kind !== "chip") throw new Error("expected a chip");
    view.onActivate();
    expect(layerCalls).toEqual(["layer numbers"]);

    const keyCalls: string[] = [];
    const key = referenceView({ kind: "key", layerId: "base", position: 60 }, context({
      actions: { onShowLayer: (id) => void keyCalls.push(`layer ${id}`), onFoundKey: (position) => void keyCalls.push(`found ${position}`) },
    }));
    expect(key).toMatchObject({ kind: "chip", title: expect.stringContaining("on Base") });
    if (key.kind !== "chip") throw new Error("expected a chip");
    key.onActivate();
    // The layer first, then the pulse, so the key lights on the layer that holds it.
    expect(keyCalls).toEqual(["layer base", "found 60"]);
  });

  test("a marker that resolves to nothing, or to an action the page does not have, is words and no button", () => {
    const gone = [
      { kind: "config", id: "lay_deleted" },
      { kind: "layer", layerId: "gone" },
      { kind: "key", layerId: "gone", position: 3 },
      { kind: "key", layerId: "base", position: 500 },
    ] as const satisfies readonly Reference[];
    for (const reference of gone) expect(referenceView(reference, context()).kind).toBe("words");
    // The page itself, before the panel hands it a way to draw: a name is not a chip without somewhere to go.
    const noActions = referenceView({ kind: "layer", layerId: "base" }, context({ actions: {} }));
    expect(noActions).toEqual({ kind: "words", text: "Base" });
    expect(referenceView({ kind: "key", layerId: "base", position: 60 }, context({ actions: { onShowLayer: () => {} } })).kind).toBe("words");
  });

  test("the config already on screen reads as its name, so the page is not reloaded onto itself", () => {
    expect(referenceView({ kind: "config", id: "lay_current" }, context())).toEqual({ kind: "words", text: "Moonlander" });
  });

  test("a key whose layer left the head while the reply is on screen reads as words on the next render", () => {
    const head = { ...fixture.document, layers: fixture.document.layers.filter((layer) => layer.id !== "numbers") };
    const after = context({ layout: head });
    expect(referenceView({ kind: "layer", layerId: "numbers" }, after)).toEqual({ kind: "words", text: "numbers" });
    expect(referenceView({ kind: "key", layerId: "numbers", position: 3 }, after)).toEqual({ kind: "words", text: "numbers" });
    // The same markers still resolve on a layer the new head has.
    expect(referenceView({ kind: "layer", layerId: "base" }, after).kind).toBe("chip");
  });

  test("a long config name is still one chip, drawn whole and wrapping inside the prose", () => {
    const long = "Glove80 (42-key-map) moved onto the Moonlander, second attempt";
    const view = referenceView({ kind: "config", id: "lay_copy" }, context({ configNames: new Map([["lay_copy", long]]) }));
    expect(view).toMatchObject({ kind: "chip", label: long });
  });

  test("a carried thread from another config is inert for its layers, keys and proposals, and still opens a config it names", () => {
    const calls: string[] = [];
    const foreign = context({ foreign: true, actions: { onOpenConfig: (id) => void calls.push(`open ${id}`), onShowLayer: (id) => void calls.push(`layer ${id}`), onFoundKey: () => calls.push("found"), onPin: () => calls.push("pin") } });
    // Those layers, keys and proposals belong to a layout that is not on screen: a chip for them would preview another config's change
    // on this board, so they read as what they are, not as ids.
    expect(referenceView({ kind: "layer", layerId: "base" }, foreign)).toEqual({ kind: "words", text: "that layer" });
    expect(referenceView({ kind: "key", layerId: "base", position: 60 }, foreign)).toEqual({ kind: "words", text: "that key" });
    expect(referenceView({ kind: "proposal", id: proposal.changeSetId }, foreign)).toEqual({ kind: "words", text: "that proposal" });
    const opened = referenceView({ kind: "config", id: "lay_copy" }, foreign);
    if (opened.kind !== "chip") throw new Error("a carried thread can still open the config it names");
    opened.onActivate();
    expect(calls).toEqual(["open lay_copy"]);
  });
});

const draw = (reference: Reference) => referenceView(reference, context());
const turn = (text: string): AssistantTurn => ({ kind: "assistant", id: "a", text, activity: null, proposals: [proposal], priorities: [], question: null, phase: "done", failure: null, ending: "complete" });

describe("a reply with all four kinds in it", () => {
  test("sits in the prose as chips, one per marker, and two on one line both render", () => {
    const html = renderToStaticMarkup(createElement(AssistantMessage, {
      turn: turn("I saved it on {config:lay_copy}, on {layer:numbers} at {key:base:60}, and {proposal:cs_open} is waiting. Two on one line: {layer:numbers} {key:base:60}."),
      layout: fixture.document, board: fixture.board, pinnedId: null, reference: draw,
      onPreview: () => {}, onPin: () => {}, onApply: async () => {}, onRemovePriority: async () => {}, onAskAgain: () => {}, onOpenRelease: () => {}, onRetry: () => {}, onAnswer: () => {},
    }));
    expect([...html.matchAll(/<button type="button" class="ref-chip"/g)]).toHaveLength(6);
    expect(html).toContain("Glove80 copy");
    expect(html).toContain("Plain Option cs_open");
    // No marker text reaches the page once the reply can be drawn.
    expect(html).not.toContain("{config:");
    expect(html).not.toContain("{key:");
  });

  test("a reply whose markers resolve to nothing renders as plain words with no interactive element", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      source: "I saved it on {config:lay_deleted} at {key:gone:3}.",
      reference: draw,
    }));
    expect(html).toContain("I saved it on lay_deleted at gone.");
    expect(html).not.toContain("<button");
  });
});

describe("a carried thread handed back to its own config (D-317)", () => {
  const carried = (proposals: ProposalCard[]): Turn[] => [{ kind: "assistant", id: "carried", text: "on it", activity: null, proposals, priorities: [], question: null, phase: "done", failure: null, ending: "complete" }];

  test("keeps its proposal chips: the carried thread's proposals are the thread's own again", () => {
    const carriedCard = card("cs_carried");
    const map = referableProposals([], carried([carriedCard]));
    expect([...map.keys()]).toEqual(["cs_carried"]);
    // A reply in that carried thread resolves its `{proposal:…}` marker to a chip, not to the change-set id.
    const view = referenceView({ kind: "proposal", id: "cs_carried" }, context({ proposals: map }));
    expect(view).toMatchObject({ kind: "chip", label: "Plain Option cs_carried" });
  });

  test("a thread from another config contributes nothing, and the live turn wins on the same id", () => {
    // Foreign: ChatPanel passes no carried turns, so a change set only the carried thread holds stays words.
    expect(referableProposals([], null).size).toBe(0);
    const older = card("cs_open");
    const newer = card("cs_open", { status: "applied" });
    const liveTurn: Turn = { ...turn("live"), proposals: [newer] };
    const map = referableProposals([liveTurn], carried([older]));
    // The status the thread shows now is the live one, so the marker reads as applied rather than offering a pin.
    expect(referenceView({ kind: "proposal", id: "cs_open" }, context({ proposals: map }))).toEqual({ kind: "words", text: "Plain Option cs_open (applied)" });
  });
});

describe("the panel draws a carried thread handed back to its own config", () => {
  const panel = (fromId: string) => renderToStaticMarkup(createElement(ChatPanel, {
    token: "t", layoutRef: "lay_current", layout: fixture.document, board: fixture.board, revisionId: "rev",
    onHighlightDecision: () => {}, selection: null, onRemoveKey: () => {}, onClearSelection: () => {}, onRestoreSelection: () => {},
    pinnedId: null, onPreview: () => {}, onPin: () => {}, onApplied: async () => {}, onOpenRelease: () => {},
    configNames: new Map([["lay_current", "Moonlander"]]), onOpenConfig: () => {},
    carried: { fromName: "Moonlander daily", from: { id: fromId, name: "Moonlander daily" }, turns: [turn("and {proposal:cs_open} is waiting")] },
  }));

  test("keeps the chip: the carried thread's proposal is this config's again", () => {
    const html = panel("lay_current");
    expect(html).toContain('class="ref-chip" data-kind="proposal"');
    expect(html).toContain("Plain Option cs_open");
    expect(html).not.toContain("cs_open is waiting");
  });

  test("and reads as words when the thread still belongs to another config", () => {
    const html = panel("lay_other");
    expect(html).not.toContain('data-kind="proposal"');
    expect(html).toContain("that proposal is waiting");
  });
});
