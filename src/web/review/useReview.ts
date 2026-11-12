import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewActivity, ReviewEvent, ReviewResponse } from "../../api/review.ts";
import { isReviewCurrent } from "../../api/review.ts";
import type { FixedItem } from "../../validation/review-item.ts";
import { ApiError } from "../api.ts";
import * as api from "./api-review.ts";
import { type ReviewAction, type ReviewProblem, reviewProblemWords } from "./review-words.ts";

/** An error as the words functions read it: an ApiError's status and code, or a transport failure as status -1. */
export const asFailure = (error: unknown): { code: string | undefined; status: number; message: string } =>
  error instanceof ApiError ? error : { code: undefined, status: -1, message: error instanceof Error ? error.message : String(error) };

// The board review of the config on screen (D-340): read when the page opens, again whenever the head moves, and again on each `review`
// frame for this config. Results stay non-interactive until the current run finishes. Only explicit UI actions request runs here;
// the engine handles automatic refresh on connect, apply, import and changed inputs on connected configs.
export function useReview(token: string, layoutId: string, headRevisionId: string, lastEvent: ReviewEvent | null) {
  const [saved, setSaved] = useState<{ token: string; layoutId: string; headRevisionId: string; response: ReviewResponse } | null>(null);
  const response = saved?.token === token && saved.layoutId === layoutId ? saved.response : null;
  // The request that failed, in words, and the way on: the same request again, or a fresh read when it was refused (R5-10).
  // A failed read has no `again`: Try again reads with the current `load`.
  const [failure, setFailure] = useState<{ action: ReviewAction; view: ReviewProblem; again: (() => void) | null } | null>(null);
  const [action, setAction] = useState<{ token: string; layoutId: string; serial: number; kind: Exclude<ReviewAction, "load"> } | null>(null);
  const busy = action?.token === token && action.layoutId === layoutId;
  // The fixed items of a review that arrived while the page was open, for the tick and the toast; once per review.
  const [justFixed, setJustFixed] = useState<{ reviewId: string; items: FixedItem[] } | null>(null);
  const seen = useRef<string | null>(null);
  const request = useRef(0);
  const matchingEvent = lastEvent?.layoutId === layoutId ? lastEvent : null;
  // Retain this config's last event when another board emits; foreign traffic cannot settle or release its read lock.
  const [observed, setObserved] = useState({ token, layoutId, event: matchingEvent });
  const sameScope = observed.token === token && observed.layoutId === layoutId;
  const event = matchingEvent ?? (sameScope ? observed.event : null);
  if (!sameScope || event !== observed.event) setObserved({ token, layoutId, event });
  const [settledEvent, setSettledEvent] = useState<ReviewEvent | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const serial = ++request.current;
    setFailure(null);
    try {
      const r = await api.fetchReview(token, layoutId, signal);
      if (signal?.aborted || serial !== request.current) return;
      setSaved({ token, layoutId, headRevisionId, response: r });
      setSettledEvent(event);
      setFailure(null);
      const review = r.review;
      if (review !== null && review.revisionId === r.headRevisionId) {
        // A review made while the page watched, with findings the change cleared: that's the satisfaction beat.
        if (seen.current !== null && seen.current !== review.id && review.fixed.length > 0) setJustFixed({ reviewId: review.id, items: review.fixed });
        seen.current = review.id;
      } else if (review !== null && seen.current === null) seen.current = review.id;
    } catch (error) {
      if (signal?.aborted || serial !== request.current) return;
      setFailure({ action: "load", view: reviewProblemWords("load", asFailure(error)), again: null });
    }
  }, [token, layoutId, headRevisionId, event]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const act = async (kind: Exclude<ReviewAction, "load">, run: () => Promise<ReviewResponse>): Promise<void> => {
    const serial = ++request.current;
    setAction({ token, layoutId, serial, kind });
    try {
      const next = await run();
      if (serial !== request.current) return;
      setSaved({ token, layoutId, headRevisionId, response: next });
      setSettledEvent(event);
      setFailure(null);
    } catch (error) {
      if (serial !== request.current) return;
      setFailure({ action: kind, view: reviewProblemWords(kind, asFailure(error)), again: () => void act(kind, run) });
    } finally {
      setAction((pending) => pending?.serial === serial ? null : pending);
    }
  };

  const review = response?.review ?? null;
  const refreshing = response === null || saved?.headRevisionId !== headRevisionId || event !== settledEvent || (busy && action?.kind === "run");
  return {
    review,
    activities: response?.workloadActivities ?? [],
    /** The revision or other inputs changed; old recommendations are withheld. */
    stale: review !== null && !isReviewCurrent(review, headRevisionId),
    loaded: response !== null,
    /** True when the review itself couldn't be read, so the last results are withheld. */
    readFailed: failure?.action === "load",
    /** What failed, in words; null when nothing has. */
    problem: failure?.view.words ?? null,
    /** The button for `problem`: Try again repeats the request that failed, Read the review again reads it afresh. */
    problemAction: failure === null ? null : { label: failure.view.button, run: failure.view.next === "repeat" && failure.again !== null ? failure.again : () => void load() },
    // A review event disables the old results before the GET can replace them, even when it reuses the same review row.
    busy: busy || refreshing,
    refreshing,
    justFixed: justFixed !== null && review !== null && justFixed.reviewId === review.id ? justFixed.items : [],
    clearJustFixed: () => setJustFixed(null),
    run: (force = false, activities?: ReviewActivity[]) => act("run", () => api.runReview(token, layoutId, force, activities)),
    /** Stops the activity tests and the look they belong to (R5-17); the engine removes their container. */
    stop: () => act("stop", () => api.stopReview(token, layoutId)),
    /** True while a Stop waits for the run to end. */
    stopping: busy && action?.kind === "stop",
    dismiss: (id: string) => act("dismiss", () => api.dismissItem(token, layoutId, id)),
    restore: (id: string) => act("restore", () => api.restoreItem(token, layoutId, id)),
    reload: () => void load(),
  };
}

export type Review = ReturnType<typeof useReview>;
