// What the agent needs from keyloom, as an interface (01#modules: agent may not import app or
// persistence). src/app implements it over the real use cases for one layout.
import type { Board } from "../boards/load.ts";
import type { ChangeOp } from "../layout/change.ts";
import type { Layout } from "../layout/schema.ts";
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

export interface AgentPorts {
  snapshot(): LayoutSnapshot;
  /** Validates against the head without saving anything. */
  check(ops: ChangeOp[]): ValidationResult;
  /** Validates each alternative and stores the valid ones as proposed change sets sharing one group. */
  propose(alternatives: Proposal[]): ProposalResult[];
}
