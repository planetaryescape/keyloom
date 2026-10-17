// The agent's view of keyloom for one layout and conversation, built from the change use cases so
// the agent's validation and storage are exactly the editor's and the CLI's (D-014).
import type { AgentPorts, ChoiceFact, LayoutSnapshot, PriorityFact, Proposal, ProposalResult } from "../agent/ports.ts";
import { upgradeStoredOryx } from "../firmware/qmk/upgrade.ts";
import { getBoardConfig } from "../persistence/configs.ts";
import type { DecisionRow } from "../persistence/decisions.ts";
import { newId } from "../persistence/ids.ts";
import type { ValidationResult } from "../validation/result.ts";
import type { SelectionScope } from "../validation/selection-rules.ts";
import { ValidationResultSchema } from "../validation/result.ts";
import { checkChange, proposeChange } from "./changes.ts";
import type { App } from "./context.ts";
import { layoutChoices, layoutPriorities, recordOutcome, recordPriority, showDecision } from "./decisions.ts";
import { ValidationFailedError } from "./errors.ts";
import { putConfig } from "./keyboard-put.ts";
import { getLayout, listLayouts } from "./layouts.ts";
import { typingFindings } from "./lab.ts";

export const toPriorityFact = (d: DecisionRow): PriorityFact => ({
  id: d.id, priorityKind: d.priorityKind ?? "pinned", statement: d.goal, reason: d.reason, subject: d.subject,
});

export const toChoiceFact = (d: DecisionRow): ChoiceFact => ({
  id: d.id, status: d.status as ChoiceFact["status"], goal: d.goal, choice: d.choice, reason: d.reason, scope: d.scope, subject: d.subject, outcomeNote: d.outcomeNote,
});

/**
 * `sourceMessageIds` are BK's messages this turn answers: the link back from a priority to the words it came from (08).
 * `selection` is what he had selected when he sent the message, so a proposal that strays from it is warned about (07).
 * A null `conversationId` is a board review (D-340): its proposals belong to no conversation, so they show in the config's open proposals.
 */
export function createAgentPorts(app: App, layoutId: string, conversationId: string | null, sourceMessageIds: string[] = [], selection?: SelectionScope): AgentPorts {
  const scope = selection ? { selection } : {};
  const snapshotOf = (ref: string): LayoutSnapshot => {
    const view = getLayout(app, ref);
    return {
      layoutId: view.layout.id, layoutName: view.layout.name, revisionId: view.revision.id, document: view.document, board: view.board,
      onKeyboard: getBoardConfig(app.db, view.layout.boardId) === view.layout.id, archived: view.layout.archivedAt !== null,
    };
  };
  // Another layout is shown as a fresh import would read it: a stored Oryx layout still holds its colours and tap dances as code, and the
  // agent can only copy what it can see. This is a view in memory; nothing is saved, so D-193 (never upgrade on read) stands.
  const viewOf = (ref: string): LayoutSnapshot => {
    const s = snapshotOf(ref);
    if (s.layoutId === layoutId) return s;
    const upgraded = upgradeStoredOryx(s.document, s.board.definition);
    return upgraded === null ? s : { ...s, document: upgraded.layout };
  };
  return {
    snapshot: () => snapshotOf(layoutId),
    layouts: () => listLayouts(app).map((row) => viewOf(row.id)),
    // getLayout reports a name that no layout has as "no layout"; the agent reads that and goes back to list_layouts.
    layout: (ref) => viewOf(ref),
    put(input) {
      // The new config belongs to no conversation, so its proposals are found in the config's open proposals (D-336), not in this chat.
      const out = putConfig(app, { ...input, source: "agent" });
      return {
        config: { id: out.config.id, name: out.config.name, boardName: out.config.boardName }, proposals: out.proposals, placements: out.placements, layers: out.layers,
        notCarried: out.notCarried, combos: out.combos, notes: out.notes,
      };
    },
    check: (ops) => checkChange(app, layoutId, { ops, ...scope }),
    priorities: () => layoutPriorities(app, layoutId).map(toPriorityFact),
    recordPriority(input) {
      if (conversationId === null) throw new Error("a priority is recorded from what BK says, and a review is not a conversation");
      const { decision, created } = recordPriority(app, layoutId, { ...input, conversationId, sourceMessageIds });
      return { ...toPriorityFact(decision), alreadyKnown: !created };
    },
    choices: () => layoutChoices(app, layoutId).map(toChoiceFact),
    typingFindings: () => typingFindings(app, layoutId),
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
            ops: alt.ops, explanation: alt.explanation, source: "agent", title: alt.title, tradeoffs: alt.tradeoffs, ...(conversationId === null ? {} : { conversationId }), proposalGroup, ...scope,
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
