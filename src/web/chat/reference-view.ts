// What a reply's typed reference draws as on the page (D-468): a chip that goes to the thing it names, or the words it stands for when
// nothing live answers to it. Pure: the panel hands in the layout on screen, the config names the page can open, this thread's
// proposals and the four actions. Nothing here builds an anchor or writes HTML; the component renders a button (D-404).
import type { ProposalCard } from "../../api/http.ts";
import { type Reference, type ReferenceWorld, readReference } from "../../layout/references.ts";
import { legendWords } from "../../boards/key-names.ts";
import { bindingLegend } from "../../layout/legend.ts";
import type { Layout } from "../../layout/schema.ts";
import { layerName } from "./proposal-facts.ts";
import type { Turn } from "./transcript.ts";

/** What a chip can do, each through a seam the page already has. A missing one leaves the reference as words, never a dead chip. */
export type ReferenceActions = {
  /** Opens a config, carrying the thread (D-317). */
  onOpenConfig?: (id: string) => void;
  /** Pins a proposal on the board beside the reply (D-452). */
  onPin?: (proposal: ProposalCard) => void;
  /** Shows a layer of the layout on screen. */
  onShowLayer?: (layerId: string) => void;
  /** Pulses one key on the board, so it can be found. */
  onFoundKey?: (position: number) => void;
};

export type ReferenceView =
  | { kind: "chip"; reference: Reference; label: string; title: string; onActivate: () => void }
  | { kind: "words"; text: string };

export type ReferenceContext = {
  /** The layout the reply is about. */
  layout: Layout;
  /** The config on screen, which a marker for it reads as words: opening it again would reload the page onto itself. */
  currentId: string;
  /** The names of the configs this page can open, by id. */
  configNames: ReadonlyMap<string, string>;
  /** The proposals this thread holds, by change set id: a reply's own, and the ones before it in the conversation. */
  proposals: ReadonlyMap<string, ProposalCard>;
  /**
   * A reply carried from another config (D-317). Only a config it names can be opened from here: its layers, keys and proposals
   * belong to a layout that is not on screen, so pinning one would preview another config's change on this board.
   */
  foreign?: boolean;
  actions: ReferenceActions;
};

// What this page knows, in the shape `readReference` reads. A reference the page cannot draw never gets here: `referenceView` decides
// that first, so this only answers for things that exist.
function worldOf(context: ReferenceContext): ReferenceWorld {
  const { layout } = context;
  return {
    layer: (layerId) => {
      const layer = layout.layers.find((candidate) => candidate.id === layerId);
      return layer === undefined ? undefined : { name: layerName(layout, layerId), keyCount: layer.bindings.length };
    },
    keyTap: (layerId, position) => {
      const binding = layout.layers.find((candidate) => candidate.id === layerId)?.bindings[position];
      // The same words the review and the cards use for a key: what its cap prints, "blank" for a key that does nothing.
      return binding === undefined ? undefined : legendWords(bindingLegend(binding, { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances }));
    },
    config: (id) => context.configNames.get(id),
    proposal: (id) => {
      const card = context.proposals.get(id);
      return card === undefined ? undefined : { title: card.title, status: card.status };
    },
  };
}

/**
 * The proposals a reply's `{proposal:…}` marker can pin, by change set id.
 *
 * The thread on screen is always read. A thread carried from another config (D-317) is added only when it is about this very config
 * again: then its proposals are this config's, and a reply that came back to its own config keeps its chips live instead of falling
 * back to the change-set id. The live turns are read last, so a later status (applied, superseded) wins over the carried copy of the
 * same card.
 */
export function referableProposals(live: readonly Turn[], carried: readonly Turn[] | null): ReadonlyMap<string, ProposalCard> {
  const byId = new Map<string, ProposalCard>();
  for (const turn of [...(carried ?? []), ...live]) {
    if (turn.kind !== "assistant") continue;
    for (const card of turn.proposals) byId.set(card.changeSetId, card);
  }
  return byId;
}

/** One marker as the page draws it: a chip with the name the page resolved, or words when it resolves to nothing live. */
export function referenceView(reference: Reference, context: ReferenceContext): ReferenceView {
  // A thread carried from another config: its layers, keys and proposals exist, but this page has no layout to draw them on, so they
  // read as what they are rather than as ids. Its config marker still opens that config (see `worldOf`).
  if (context.foreign === true && reference.kind !== "config") {
    return { kind: "words", text: reference.kind === "layer" ? "that layer" : reference.kind === "key" ? "that key" : "that proposal" };
  }
  const read = readReference(reference, worldOf(context));
  if (read.kind === "words") return read;
  const target = read.target;
  const { actions } = context;
  switch (target.kind) {
    case "config": {
      const open = actions.onOpenConfig;
      if (open === undefined || target.id === context.currentId) return { kind: "words", text: target.label };
      return { kind: "chip", reference, label: target.label, title: `Open ${target.label}`, onActivate: () => open(target.id) };
    }
    case "proposal": {
      const pin = actions.onPin;
      const card = context.proposals.get(target.id);
      if (pin === undefined || card === undefined) return { kind: "words", text: target.label };
      return { kind: "chip", reference, label: target.label, title: "Show this proposal on the board", onActivate: () => pin(card) };
    }
    case "layer": {
      const show = actions.onShowLayer;
      if (show === undefined) return { kind: "words", text: target.label };
      return { kind: "chip", reference, label: target.label, title: `Show ${target.label}`, onActivate: () => show(target.layerId) };
    }
    case "key": {
      const show = actions.onShowLayer;
      const pulse = actions.onFoundKey;
      if (show === undefined || pulse === undefined) return { kind: "words", text: target.label };
      // The same layer switch the board uses, then the pulse the keyboard's own key press uses, so the key itself is the answer.
      return {
        kind: "chip", reference, label: target.label, title: `${target.label} on ${target.layerName}`,
        onActivate: () => { show(target.layerId); pulse(target.position); },
      };
    }
  }
}
