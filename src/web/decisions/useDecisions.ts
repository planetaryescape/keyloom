import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionCard, DecisionPatch, OutcomeAnswer, OutcomeQuestionsResponse } from "../../api/http.ts";
import { answerOutcome, fetchDecisions, fetchOutcomeQuestions, patchDecision, retireDecision } from "./api-decisions.ts";

export type DecisionsState =
  | { status: "loading" }
  | { status: "ready"; items: DecisionCard[] }
  | { status: "error"; message: string };

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * The layout's decisions. `revisionId` is the head the page shows: an apply writes a decision and
 * moves the head, so a new head is the cue to read them again.
 */
export function useDecisions(token: string, layoutRef: string, revisionId: string, enabled: boolean) {
  const [state, setState] = useState<DecisionsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchDecisions(token, layoutRef, controller.signal)
      .then((items) => setState({ status: "ready", items }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", message: messageOf(error, "Couldn't load what keyloom remembers.") });
      });
    return () => controller.abort();
  }, [token, layoutRef, revisionId, enabled, attempt]);

  const replace = useCallback(
    (card: DecisionCard) => setState((s) => (s.status === "ready" ? { status: "ready", items: s.items.map((d) => (d.id === card.id ? card : d)) } : s)),
    [],
  );

  return {
    state,
    reload: useCallback(() => setAttempt((n) => n + 1), []),
    /** Rejects with the server's message. */
    async edit(id: string, patch: DecisionPatch) {
      replace(await patchDecision(token, id, patch));
    },
    async retire(id: string) {
      await retireDecision(token, id);
      setState((s) => (s.status === "ready" ? { status: "ready", items: s.items.filter((d) => d.id !== id) } : s));
    },
  };
}

type Question = OutcomeQuestionsResponse["questions"][number];

/** The "has this worked out?" questions due now (Q6). They are read once per page load, so a question is not re-asked mid-session. */
export function useOutcomeQuestions(token: string, layoutRef: string) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const answered = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    fetchOutcomeQuestions(token, layoutRef, controller.signal)
      .then((all) => setQuestions(all.filter((q) => !answered.current.has(q.decision.id))))
      // The question is a courtesy; a failure to fetch it is not worth an error banner.
      .catch(() => {});
    return () => controller.abort();
  }, [token, layoutRef]);

  return {
    questions,
    /** Rejects with the server's message so the card can say why it is still there. */
    async answer(id: string, answer: OutcomeAnswer) {
      await answerOutcome(token, id, answer);
      answered.current.add(id);
      setQuestions((all) => all.filter((q) => q.decision.id !== id));
    },
  };
}
