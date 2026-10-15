// The browser side of the decisions routes (src/api/http.ts, "Decisions").
import {
  DecisionCardSchema, DecisionListResponseSchema, OutcomeQuestionsResponseSchema,
  type DecisionCard, type DecisionPatch, type OutcomeAnswer, type OutcomeQuestionsResponse,
} from "../../api/http.ts";
import { ApiError } from "../api.ts";
import { failure, request } from "../api-write.ts";

export async function fetchDecisions(token: string, ref: string, signal: AbortSignal): Promise<DecisionCard[]> {
  return (await request("GET", `/api/layouts/${encodeURIComponent(ref)}/decisions`, token, DecisionListResponseSchema, signal)).decisions;
}

export function patchDecision(token: string, id: string, patch: DecisionPatch): Promise<DecisionCard> {
  return request("PATCH", `/api/decisions/${encodeURIComponent(id)}`, token, DecisionCardSchema, undefined, patch);
}

/** Retires a decision. The server keeps the record, so what BK once decided survives (08). */
export async function retireDecision(token: string, id: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/decisions/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-keyloom-token": token } });
  } catch {
    throw new ApiError(0, "Can't reach keyloom. Is it still running in your terminal?");
  }
  if (!response.ok) throw await failure(response);
}

export async function fetchOutcomeQuestions(token: string, ref: string, signal: AbortSignal): Promise<OutcomeQuestionsResponse["questions"]> {
  return (await request("GET", `/api/layouts/${encodeURIComponent(ref)}/outcome-questions`, token, OutcomeQuestionsResponseSchema, signal)).questions;
}

export function answerOutcome(token: string, id: string, answer: OutcomeAnswer): Promise<DecisionCard> {
  return request("POST", `/api/decisions/${encodeURIComponent(id)}/outcome`, token, DecisionCardSchema, undefined, answer);
}
