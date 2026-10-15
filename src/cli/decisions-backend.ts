// The server's decisions interface over the app's decision use cases (rung 6). The one place that
// knows both the server's wire shapes and the app's errors.
import {
  type App, type DecisionRow, NotFoundError, UsageError, dismissOutcome, editDecision, listDecisions, outcomeQuestions, recordOutcome, retireDecision,
  showDecision,
} from "../app/index.ts";
import { DecisionError, type DecisionsBackend } from "../server/decisions-backend.ts";

// The wire shape lives in src/api, which the CLI may not import; the backend interface carries it.
type DecisionCard = Awaited<ReturnType<DecisionsBackend["update"]>>;

export const toDecisionCard = (d: DecisionRow): DecisionCard => ({
  id: d.id, kind: d.kind, priorityKind: d.priorityKind, status: d.status, goal: d.goal, choice: d.choice, reason: d.reason, scope: d.scope, subject: d.subject,
  outcomeNote: d.outcomeNote, supersededBy: d.supersededBy, conversationId: d.conversationId, sourceMessageIds: d.sourceMessageIds,
  createdAt: d.createdAt, updatedAt: d.updatedAt,
});

function translate<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof NotFoundError) throw new DecisionError(404, "not_found", err.message);
    if (err instanceof UsageError) throw new DecisionError(400, "usage", err.message);
    throw err;
  }
}

export function appDecisionsBackend(app: App, clock: () => number = Date.now): DecisionsBackend {
  return {
    async list(ref) {
      try {
        return listDecisions(app, ref).filter((d) => d.status !== "retired").map(toDecisionCard);
      } catch (err) {
        if (err instanceof NotFoundError) return null;
        throw err;
      }
    },
    async update(id, patch) {
      return translate(() => toDecisionCard(editDecision(app, id, patch)));
    },
    async retire(id) {
      try {
        retireDecision(app, id);
        return true;
      } catch (err) {
        if (err instanceof NotFoundError) return false;
        throw err;
      }
    },
    async questions(ref) {
      try {
        return outcomeQuestions(app, ref, clock()).map((q) => ({ decision: toDecisionCard(q.decision), flashedAt: q.flashedAt }));
      } catch (err) {
        if (err instanceof NotFoundError) return null;
        throw err;
      }
    },
    async answer(id, answer) {
      return translate(() => {
        showDecision(app, id);
        return toDecisionCard("dismiss" in answer ? dismissOutcome(app, id) : recordOutcome(app, id, answer));
      });
    },
  };
}
