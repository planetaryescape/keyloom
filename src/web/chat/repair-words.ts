// What a repair request says under its title, and the buttons that match the words (R6-23). Pure.
import type { BoardReview } from "../../api/review.ts";

export type RepairKind = "proposal" | "build" | "finding";
export type RepairView = {
  scope: string;
  /** The button that drops the request: Cancel while it can still be sent, Dismiss request once it can't or was sent. */
  dismissLabel: "Cancel" | "Dismiss request";
  /**
   * The one button beside it that moves on: the chat's history after a send, a fresh review for a finding that went out of date, and the
   * proposal for a revised-proposal request that went out of date, whose card holds the recovery action (R7-14).
   */
  offer: "open_history" | "fresh_review" | "show_proposal" | null;
};

/** `checking` is a finding whose review is busy or being read again: not known to be current yet, and not known to be out of date. */
export function repairWords(kind: RepairKind, state: { sent: boolean; current: boolean; checking?: boolean }): RepairView {
  if (state.sent) return { scope: "Already sent. If the reply was interrupted, open the chat history to see it before you do anything else. keyloom won't send it again.", dismissLabel: "Dismiss request", offer: "open_history" };
  if (state.current) {
    return { scope: kind === "build" ? "Check the question before sending. It sends the build log to the model; nothing is applied." : "Check the request before sending. It asks for a proposal; nothing is applied.", dismissLabel: "Cancel", offer: null };
  }
  // A moment's wait while the review settles. Send is off until it does; the request and its edits stay, and nothing offers to drop them.
  if (state.checking === true) return { scope: "Checking that this finding is still current. Send is ready again in a moment; your request and its edits are kept.", dismissLabel: "Cancel", offer: null };
  if (kind === "proposal") return { scope: "The layout or the proposal changed since you asked, so this request no longer fits it. Dismiss it and show the proposal, then plan the repair again from its card if it still needs one. Dismissing drops this request and any edits you made to it.", dismissLabel: "Dismiss request", offer: "show_proposal" };
  if (kind === "build") return { scope: "The layout changed since this build, so this question no longer fits it. Dismiss it, and ask about the newest build if that one fails too.", dismissLabel: "Dismiss request", offer: null };
  // A fresh review's finding gets a request of its own, and Plan a repair waits while this one is up: the button dismisses it and runs
  // the review in one press, and says so. Dismissing drops the request's text, so the words say that before the press.
  return { scope: "This finding is out of date, so this request can't be sent. Dismissing it drops the request and any edits you made to it. Run a fresh review, then plan a repair from the finding it shows.", dismissLabel: "Dismiss request", offer: "fresh_review" };
}

/**
 * Whether a finding's repair request can be sent. While the review is busy or being read again (another item hidden, the AI part
 * finishing) its answer is about to change, so the finding is neither current nor out of date yet: `checking` keeps Send off and offers
 * no dismiss, so a moment's refresh never drops the request's edits (R6-23 review).
 */
export function findingRepairState(
  draft: { reviewId: string; headRevisionId: string; findingId: string },
  review: { review: BoardReview | null; busy: boolean; refreshing: boolean; stale: boolean },
): "current" | "checking" | "stale" {
  if (review.busy || review.refreshing) return "checking";
  const r = review.review;
  const open = r?.id === draft.reviewId && r.revisionId === draft.headRevisionId && !review.stale
    && r.items.some((item) => item.id === draft.findingId && item.dismissedAt === null && (item.kind === "problem" || item.kind === "hint"));
  return open ? "current" : "stale";
}
