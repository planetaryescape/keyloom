import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewEvent, ReviewResponse } from "../../api/review.ts";
import type { FixedItem } from "../../validation/review-item.ts";
import { ApiError } from "../api.ts";
import * as api from "./api-review.ts";

// The board review of the config on screen (D-340): read when the page opens, again whenever the head moves, and again on each `review`
// frame for this config, so the checks show at once and the agent's part fills in when it arrives. Nothing here runs a review by
// itself except "Look now" on a config that has none; the engine reviews on connect, apply and import.
export function useReview(token: string, layoutId: string, headRevisionId: string, lastEvent: ReviewEvent | null) {
  const [response, setResponse] = useState<ReviewResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The fixed items of a review that arrived while the page was open, for the tick and the toast; once per review.
  const [justFixed, setJustFixed] = useState<{ reviewId: string; items: FixedItem[] } | null>(null);
  const seen = useRef<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await api.fetchReview(token, layoutId, signal);
      setResponse(r);
      setProblem(null);
      const review = r.review;
      if (review !== null && review.revisionId === r.headRevisionId) {
        // A review made while the page watched, with findings the change cleared: that's the satisfaction beat.
        if (seen.current !== null && seen.current !== review.id && review.fixed.length > 0) setJustFixed({ reviewId: review.id, items: review.fixed });
        seen.current = review.id;
      } else if (review !== null && seen.current === null) seen.current = review.id;
    } catch (error) {
      if (signal?.aborted) return;
      setProblem(error instanceof ApiError || error instanceof Error ? error.message : "Couldn't read the review.");
    }
  }, [token, layoutId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, headRevisionId]);

  // A frame for this config: a review was made or its agent part moved.
  const eventKey = lastEvent !== null && lastEvent.layoutId === layoutId ? `${lastEvent.reviewId}:${lastEvent.aiStatus}` : null;
  useEffect(() => {
    if (eventKey === null) return;
    void load();
  }, [eventKey, load]);

  const act = async (run: () => Promise<ReviewResponse>) => {
    setBusy(true);
    try {
      setResponse(await run());
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof ApiError || error instanceof Error ? error.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const review = response?.review ?? null;
  return {
    review,
    /** The review is of an older revision: the head's is being made. */
    stale: review !== null && response !== null && review.revisionId !== response.headRevisionId,
    loaded: response !== null,
    problem,
    busy,
    justFixed: justFixed !== null && review !== null && justFixed.reviewId === review.id ? justFixed.items : [],
    clearJustFixed: () => setJustFixed(null),
    run: (force = false) => act(() => api.runReview(token, layoutId, force)),
    dismiss: (id: string) => act(() => api.dismissItem(token, layoutId, id)),
    restore: (id: string) => act(() => api.restoreItem(token, layoutId, id)),
    reload: () => void load(),
  };
}

export type Review = ReturnType<typeof useReview>;
