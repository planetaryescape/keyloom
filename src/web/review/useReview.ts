import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewActivity, ReviewEvent, ReviewResponse } from "../../api/review.ts";
import { isReviewCurrent } from "../../api/review.ts";
import type { FixedItem } from "../../validation/review-item.ts";
import { ApiError } from "../api.ts";
import * as api from "./api-review.ts";

// The board review of the config on screen (D-340): read when the page opens, again whenever the head moves, and again on each `review`
// frame for this config. Results stay non-interactive until the current run finishes. Only explicit UI actions request runs here;
// the engine handles automatic refresh on connect, apply, import and changed inputs on connected configs.
export function useReview(token: string, layoutId: string, headRevisionId: string, lastEvent: ReviewEvent | null) {
  const [saved, setSaved] = useState<{ token: string; layoutId: string; headRevisionId: string; response: ReviewResponse } | null>(null);
  const response = saved?.token === token && saved.layoutId === layoutId ? saved.response : null;
  const [problem, setProblem] = useState<string | null>(null);
  const [action, setAction] = useState<{ token: string; layoutId: string; serial: number; kind: "refresh" | "dismissal" } | null>(null);
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
    setProblem(null);
    try {
      const r = await api.fetchReview(token, layoutId, signal);
      if (signal?.aborted || serial !== request.current) return;
      setSaved({ token, layoutId, headRevisionId, response: r });
      setSettledEvent(event);
      setProblem(null);
      const review = r.review;
      if (review !== null && review.revisionId === r.headRevisionId) {
        // A review made while the page watched, with findings the change cleared: that's the satisfaction beat.
        if (seen.current !== null && seen.current !== review.id && review.fixed.length > 0) setJustFixed({ reviewId: review.id, items: review.fixed });
        seen.current = review.id;
      } else if (review !== null && seen.current === null) seen.current = review.id;
    } catch (error) {
      if (signal?.aborted || serial !== request.current) return;
      setProblem(error instanceof ApiError || error instanceof Error ? error.message : "Couldn't read the review.");
    }
  }, [token, layoutId, headRevisionId, event]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const act = async (kind: "refresh" | "dismissal", run: () => Promise<ReviewResponse>) => {
    const serial = ++request.current;
    setAction({ token, layoutId, serial, kind });
    try {
      const next = await run();
      if (serial !== request.current) return;
      setSaved({ token, layoutId, headRevisionId, response: next });
      setSettledEvent(event);
      setProblem(null);
    } catch (error) {
      if (serial !== request.current) return;
      setProblem(error instanceof ApiError || error instanceof Error ? error.message : "That didn't work.");
    } finally {
      setAction((pending) => pending?.serial === serial ? null : pending);
    }
  };

  const review = response?.review ?? null;
  const refreshing = response === null || saved?.headRevisionId !== headRevisionId || event !== settledEvent || (busy && action?.kind === "refresh");
  return {
    review,
    activities: response?.workloadActivities ?? [],
    /** The revision or other inputs changed; old recommendations are withheld. */
    stale: review !== null && !isReviewCurrent(review, headRevisionId),
    loaded: response !== null,
    problem,
    // A review event disables the old results before the GET can replace them, even when it reuses the same review row.
    busy: busy || refreshing,
    refreshing,
    justFixed: justFixed !== null && review !== null && justFixed.reviewId === review.id ? justFixed.items : [],
    clearJustFixed: () => setJustFixed(null),
    run: (force = false, activities?: ReviewActivity[]) => act("refresh", () => api.runReview(token, layoutId, force, activities)),
    dismiss: (id: string) => act("dismissal", () => api.dismissItem(token, layoutId, id)),
    restore: (id: string) => act("dismissal", () => api.restoreItem(token, layoutId, id)),
    reload: () => void load(),
  };
}

export type Review = ReturnType<typeof useReview>;
