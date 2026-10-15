// The agent's view of keyloom for one layout and conversation, built from the change use cases so
// the agent's validation and storage are exactly the editor's and the CLI's (D-014).
import type { AgentPorts, ChoiceFact, PriorityFact, Proposal, ProposalResult } from "../agent/ports.ts";
import type { DecisionRow } from "../persistence/decisions.ts";
import { newId } from "../persistence/ids.ts";
import type { ValidationResult } from "../validation/result.ts";
import type { SelectionScope } from "../validation/selection-rules.ts";
import { ValidationResultSchema } from "../validation/result.ts";
import { checkChange, proposeChange } from "./changes.ts";
import type { App } from "./context.ts";
import { layoutChoices, layoutPriorities, recordOutcome, recordPriority, showDecision } from "./decisions.ts";
import { ValidationFailedError } from "./errors.ts";
import { getLayout } from "./layouts.ts";

export const toPriorityFact = (d: DecisionRow): PriorityFact => ({
  id: d.id, priorityKind: d.priorityKind ?? "pinned", statement: d.goal, reason: d.reason, subject: d.subject,
});

export const toChoiceFact = (d: DecisionRow): ChoiceFact => ({
  id: d.id, status: d.status as ChoiceFact["status"], goal: d.goal, choice: d.choice, reason: d.reason, scope: d.scope, subject: d.subject, outcomeNote: d.outcomeNote,
});

/**
 * `sourceMessageIds` are BK's messages this turn answers: the link back from a priority to the words it came from (08).
 * `selection` is what he had selected when he sent the message, so a proposal that strays from it is warned about (07).
 */
export function createAgentPorts(app: App, layoutId: string, conversationId: string, sourceMessageIds: string[] = [], selection?: SelectionScope): AgentPorts {
  const scope = selection ? { selection } : {};
  return {
    snapshot() {
      const view = getLayout(app, layoutId);
      return { layoutId: view.layout.id, layoutName: view.layout.name, revisionId: view.revision.id, document: view.document, board: view.board };
    },
    check: (ops) => checkChange(app, layoutId, { ops, ...scope }),
    priorities: () => layoutPriorities(app, layoutId).map(toPriorityFact),
    recordPriority(input) {
      const { decision, created } = recordPriority(app, layoutId, { ...input, conversationId, sourceMessageIds });
      return { ...toPriorityFact(decision), alreadyKnown: !created };
    },
    choices: () => layoutChoices(app, layoutId).map(toChoiceFact),
    recordOutcome(input) {
      // The agent works on one layout; a decision ID from another is as good as a wrong one.
      if (showDecision(app, input.decisionId).layoutId !== layoutId) throw new Error(`"${input.decisionId}" is not a decision on this layout`);
      return toChoiceFact(recordOutcome(app, input.decisionId, { status: input.status, note: input.note }));
    },
    propose(alternatives: Proposal[]): ProposalResult[] {
      // One group for the alternatives of a call, so applying one supersedes the rest.
      const proposalGroup = newId("pg");
      return alternatives.map((alt) => {
        const validation = checkChange(app, layoutId, { ops: alt.ops, ...scope });
        if (!validation.ok) return { title: alt.title, changeSetId: null, validation };
        try {
          const cs = proposeChange(app, layoutId, {
            ops: alt.ops, explanation: alt.explanation, source: "agent", title: alt.title, tradeoffs: alt.tradeoffs, conversationId, proposalGroup, ...scope,
            decisionDraft: { ...alt.decisionDraft, sourceMessageIds },
          });
          return { title: alt.title, changeSetId: cs.id, validation: cs.validation };
        } catch (err) {
          if (err instanceof ValidationFailedError) {
            const parsed: ValidationResult = ValidationResultSchema.parse(err.details);
            return { title: alt.title, changeSetId: null, validation: parsed };
          }
          throw err;
        }
      });
    },
  };
}
