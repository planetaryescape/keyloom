// What a repair request says under its title, and the buttons that match the words (R6-23). Pure.
import type { BoardReview } from "../../api/review.ts";
import { type PageFailure, pageFailure, wayOutFor } from "../shell/unexpected.ts";

/** What a revised-proposal request's recheck found missing. */
export type RecheckGone = "conversation" | "layout";

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
  /** Why the offer is off for now, shown beside it. Absent while the offer works. */
  offerWaits?: string;
};

/**
 * Showing the proposal opens its conversation, which would stop this page following the reply keyloom is writing, so the button waits for
 * it like Send and New do (#301 review).
 */
export const SHOW_PROPOSAL_WAITS = "keyloom is replying. Show the proposal once the reply ends, or stop the reply first.";

/**
 * `checking` is a finding whose review is busy or being read again: not known to be current yet, and not known to be out of date. `gone`
 * is what the send's recheck found missing (#313 review): with it gone, the request can never be sent and there is no proposal to show.
 */
export function repairWords(kind: RepairKind, state: { sent: boolean; current: boolean; checking?: boolean; replying?: boolean; gone?: RecheckGone | null }): RepairView {
  if (state.sent) return { scope: "Already sent. If the reply was interrupted, open the chat history to see it before you do anything else. keyloom won't send it again.", dismissLabel: "Dismiss request", offer: "open_history" };
  if (state.gone === "conversation") return { scope: "keyloom no longer has the conversation this proposal came from. It may have been deleted in another tab, so this request can't be sent. Dismissing it drops the request and any edits you made to it.", dismissLabel: "Dismiss request", offer: null };
  if (state.gone === "layout") return { scope: "keyloom no longer has this layout. It may have been deleted in another tab, so this request can't be sent. Dismissing it drops the request and any edits you made to it.", dismissLabel: "Dismiss request", offer: null };
  if (state.current) {
    return { scope: kind === "build" ? "Check the question before sending. It sends the build log to the model; nothing is applied." : "Check the request before sending. It asks for a proposal; nothing is applied.", dismissLabel: "Cancel", offer: null };
  }
  // A moment's wait while the review settles. Send is off until it does; the request and its edits stay, and nothing offers to drop them.
  if (state.checking === true) return { scope: "Checking that this finding is still current. Send is ready again in a moment; your request and its edits are kept.", dismissLabel: "Cancel", offer: null };
  if (kind === "proposal") {
    return {
      scope: "The layout or the proposal changed since you asked, so this request no longer fits it. Dismiss it and show the proposal, then plan the repair again from its card if it still needs one. Dismissing drops this request and any edits you made to it.",
      dismissLabel: "Dismiss request", offer: "show_proposal", ...(state.replying === true ? { offerWaits: SHOW_PROPOSAL_WAITS } : {}),
    };
  }
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

/** Before a revised-proposal request goes out, keyloom reads the layout and the proposal again. This is when that read failed (R10-11). */
export const RECHECK_FAILED = "keyloom couldn't check the proposal again, so nothing was sent. Your request is kept below.";

/**
 * A failed recheck, kept with its code (R10-11). Send request is its Try again. For a failure no screen planned for, keyloom's own sentence
 * follows, because it explains the Restart keyloom beside it; an answer that fails the same way every time turns Send request off (`failsAgain`).
 */
export function recheckFailure(error: unknown): PageFailure {
  const failure = pageFailure(error, "");
  return { ...failure, message: wayOutFor(failure, true) === null || failure.message === "" ? RECHECK_FAILED : `${RECHECK_FAILED} ${failure.message}` };
}

/**
 * What a failed recheck says is gone, or null (#313 review). The route's own `not_found` names the conversation or layout it read, and asking
 * again fails the same way, so the request is out of date for good, never retried. keyloom's catch-all 404 (`generic`) names nothing, so
 * it stays a failed recheck with Restart keyloom.
 */
export function recheckGone(error: unknown, read: RecheckGone): RecheckGone | null {
  const failure = pageFailure(error, "");
  return failure.code === "not_found" && failure.generic !== true ? read : null;
}
