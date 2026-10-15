// What the agent needs from keyloom, as an interface (01#modules: agent may not import app or
// persistence). src/app implements it over the real use cases for one layout.
import type { Board } from "../boards/load.ts";
import type { ChangeOp } from "../layout/change.ts";
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
};

export type Proposal = {
  title: string;
  ops: ChangeOp[];
  explanation: string;
  tradeoffs: { gains: string[]; costs: string[] };
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

export interface AgentPorts {
  snapshot(): LayoutSnapshot;
  /** Validates against the head without saving anything. */
  check(ops: ChangeOp[]): ValidationResult;
  /** Validates each alternative and stores the valid ones as proposed change sets sharing one group. */
  propose(alternatives: Proposal[]): ProposalResult[];
  /** The active priorities for the layout, for the prompt (03#what-the-agent-sees). */
  priorities(): PriorityFact[];
  /** Stores a priority BK has just stated (08). */
  recordPriority(input: PriorityInput): RecordedPriority;
}
