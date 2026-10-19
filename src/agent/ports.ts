// What the agent needs from keyloom, as an interface (01#modules: agent may not import app or
// persistence). src/app implements it over the real use cases for one layout.
import type { Board } from "../boards/load.ts";
import type { ChangeOp, DecisionDraft } from "../layout/change.ts";
import type { Layout } from "../layout/schema.ts";
import type { PriorityKind, Subject } from "../memory/priorities.ts";
import type { ValidationResult } from "../validation/result.ts";

/** The head of the layout at the moment of the call; tools read it fresh so an edit mid-conversation is seen. */
export type LayoutSnapshot = {
  layoutId: string;
  layoutName: string;
  revisionId: string;
  document: Layout;
  board: Board;
  /** This layout (a config, 25) is the one on its board's keyboard: the one the sync engine keeps there (D-300). */
  onKeyboard: boolean;
  archived: boolean;
};

export type Proposal = {
  title: string;
  ops: ChangeOp[];
  explanation: string;
  tradeoffs: { gains: string[]; costs: string[] };
  /** Written from the conversation; becomes a `choice` decision when BK applies it (08). */
  decisionDraft: DecisionDraft;
};

/** `changeSetId` is null when the alternative was invalid and so was not stored. */
export type ProposalResult = { title: string; changeSetId: string | null; validation: ValidationResult };

/** What a priority is about: a place, a thing, or both (08). */
export type PrioritySubject = Subject;

/** A priority BK has stated and keyloom remembers, as the agent reads it. `statement` is BK's own words. */
export type PriorityFact = { id: string; priorityKind: PriorityKind; statement: string; reason: string; subject: PrioritySubject };

export type PriorityInput = { priorityKind: PriorityKind; statement: string; reason?: string; subject: PrioritySubject };

/** `alreadyKnown` is true when an active priority said the same, so nothing new was stored. */
export type RecordedPriority = PriorityFact & { alreadyKnown: boolean };

/** A choice keyloom made earlier and remembers, as the agent reads it. */
export type ChoiceFact = {
  id: string;
  status: "hypothesis" | "tried_helpful" | "tried_unhelpful";
  goal: string;
  choice: string;
  reason: string;
  scope: { apps: string[]; habits: string[] };
  subject: Subject;
  /** BK's own words about how it turned out, once he has said. */
  outcomeNote: string | null;
};

export type OutcomeInput = { decisionId: string; status: "tried_helpful" | "tried_unhelpful"; note: string };

/**
 * What the typing lab found, aggregated and anonymised (D-280, 24-typing-lab.md#privacy): counts, per-finger numbers, the findings in words and
 * the suggestions with their evidence. A key is named by the key it is; the passage, the typed text and the trace never appear here.
 */
export type TypingFindings = {
  sessions: number;
  analysed: number;
  latest?: {
    sessionId: string;
    recordedAt: number;
    seconds: number;
    presses: number;
    counts: { misfireHold: number; misfireTap: number; typo: number; missed: number; double: number };
    findings: Array<{ kind: string; sentence: string }>;
    fingers: Array<{ finger: string; keys: number; errors: number; medianMsBetweenKeys: number }>;
    suggestions: Array<{
      title: string;
      /** The proposal to show BK; null when it could not be stored (the layout changed since). */
      changeSetId: string | null;
      before: number;
      after: number;
      removed: number;
      introduced: number;
      examples: Array<{ kind: string; keys: string[]; heldMs: number; overlapMs: number }>;
    }>;
    notes: string[];
  };
};

export type PlacementCandidate = { target: number; name: string; replaces?: string };
export type PlacementProposal = {
  /** Set when no candidate can take the key: the validator would refuse it (a layer it enters has no way back on the new board). */
  blocked?: string;
  /** The key on the source layout and the layer it is on. */
  layerId: string;
  layerName: string;
  source: number;
  sourceName: string;
  /** Free keys on the same hand that could take it, best first. */
  candidates: PlacementCandidate[];
};

export type NotCarried = { layerName: string; source: number; sourceName: string; why: string };

export type LayerReport = { source: string; target: string; carried: number; guessed: number; notCarried: number };

export type PutInput = {
  /** The layout (config) to copy from: its id or name. */
  from: string;
  /** The board to put it on, such as `local/corne`. */
  board: string;
  name?: string;
  /** For a layer key with no counterpart, by its source position: the target key chosen among the candidates. */
  placements?: Record<string, number>;
  /** Source layers to carry, by id or name; omitted, every layer except factory and test ones. */
  layers?: string[];
};

/** A put (22#putting-bks-config-on-it): a new config on the other board and its proposals. Nothing is applied and nothing reaches a keyboard. */
export type PutResult = {
  config: { id: string; name: string; boardName: string };
  proposals: Array<{ changeSetId: string; title: string; summary: string; warnings: number; changedKeys: number }>;
  placements: PlacementProposal[];
  layers: LayerReport[];
  notCarried: NotCarried[];
  combos: { copied: string[]; skipped: Array<{ id: string; why: string }> };
  notes: string[];
};

export interface AgentPorts {
  snapshot(): LayoutSnapshot;
  /** The head of every layout keyloom holds, this conversation's included. Read-only: a proposal can only target `snapshot()` (D-014, D-220). */
  layouts(): LayoutSnapshot[];
  /** The head of another layout by id or name. Throws a readable Error when no layout is called that, or the name is ambiguous. */
  layout(ref: string): LayoutSnapshot;
  /**
   * Maps another layout onto a board that has none of BK's config yet: makes a new config there and stores the mapping as proposals on it
   * (D-372). Nothing is applied, and this conversation's layout is untouched. Throws a readable Error for an unknown layout or board, or a name already taken.
   */
  put(input: PutInput): PutResult;
  /**
   * Makes a new config on this conversation's board: a copy of this one, or the board's blank start. It is never put on the keyboard, and
   * this conversation's layout is untouched. Throws a readable Error for a name already taken.
   */
  newConfig(input: { name: string; from: "this" | "blank" }): Promise<{ id: string; name: string; boardName: string }> | { id: string; name: string; boardName: string };
  /** Validates against the head without saving anything. */
  check(ops: ChangeOp[]): ValidationResult;
  /** Validates each alternative and stores the valid ones as proposed change sets sharing one group. */
  propose(alternatives: Proposal[]): ProposalResult[];
  /** The active priorities for the layout, for the prompt (03#what-the-agent-sees). */
  priorities(): PriorityFact[];
  /** Stores a priority BK has just stated (08). */
  recordPriority(input: PriorityInput): RecordedPriority;
  /** The choices still in force for the layout, for the prompt (08). */
  choices(): ChoiceFact[];
  /** Records how a choice turned out in BK's words; throws a readable Error for a priority or a decision that no longer applies. */
  recordOutcome(input: OutcomeInput): ChoiceFact;
  /** What BK's recorded typing sessions on this layout found. Aggregated: no text and no trace. */
  typingFindings(): TypingFindings;
}
