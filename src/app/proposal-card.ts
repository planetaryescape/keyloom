// A change set as the screens show it: the chat's proposal card, and the typing lab's suggestions (D-314). Its own file, so the lab
// and the conversations use it without depending on each other.
import type { DecisionDraft } from "../layout/change.ts";
import type { ChangeSetRow } from "../persistence/change-sets.ts";
import type { ValidationResult } from "../validation/result.ts";
import { ValidationResultSchema } from "../validation/result.ts";

export type ProposalCard = {
  changeSetId: string;
  /** Alternatives from one `propose_changes` call share a group (03). */
  proposalGroup: string | null;
  title: string;
  explanation: string;
  tradeoffs: { gains: string[]; costs: string[] };
  /** What will be remembered if BK applies this (08); null for a change set that carries no reason. */
  decisionDraft: DecisionDraft | null;
  status: ChangeSetRow["status"];
  validation: ValidationResult;
  ops: ChangeSetRow["ops"];
};

export const toCard = (row: ChangeSetRow): ProposalCard => ({
  changeSetId: row.id,
  proposalGroup: row.proposalGroup,
  title: row.title ?? row.explanation.slice(0, 80),
  explanation: row.explanation,
  tradeoffs: row.tradeoffs,
  decisionDraft: row.decisionDraft === null ? null : { goal: row.decisionDraft.goal, choice: row.decisionDraft.choice, reason: row.decisionDraft.reason, scope: row.decisionDraft.scope },
  status: row.status,
  validation: ValidationResultSchema.parse(row.validation),
  ops: row.ops,
});
