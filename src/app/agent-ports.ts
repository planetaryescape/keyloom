// The agent's view of keyloom for one layout and conversation, built from the change use cases so
// the agent's validation and storage are exactly the editor's and the CLI's (D-014).
import type { AgentPorts, Proposal, ProposalResult } from "../agent/ports.ts";
import { newId } from "../persistence/ids.ts";
import type { ValidationResult } from "../validation/result.ts";
import { ValidationResultSchema } from "../validation/result.ts";
import { checkChange, proposeChange } from "./changes.ts";
import type { App } from "./context.ts";
import { ValidationFailedError } from "./errors.ts";
import { getLayout } from "./layouts.ts";

export function createAgentPorts(app: App, layoutId: string, conversationId: string): AgentPorts {
  return {
    snapshot() {
      const view = getLayout(app, layoutId);
      return { layoutId: view.layout.id, layoutName: view.layout.name, revisionId: view.revision.id, document: view.document, board: view.board };
    },
    check: (ops) => checkChange(app, layoutId, { ops }),
    propose(alternatives: Proposal[]): ProposalResult[] {
      // One group for the alternatives of a call, so applying one supersedes the rest.
      const proposalGroup = newId("pg");
      return alternatives.map((alt) => {
        const validation = checkChange(app, layoutId, { ops: alt.ops });
        if (!validation.ok) return { title: alt.title, changeSetId: null, validation };
        try {
          const cs = proposeChange(app, layoutId, {
            ops: alt.ops, explanation: alt.explanation, source: "agent", title: alt.title, tradeoffs: alt.tradeoffs, conversationId, proposalGroup,
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
