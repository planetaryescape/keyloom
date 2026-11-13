import { expect, test } from "bun:test";
import type { BoardReview } from "../../src/api/review.ts";
import { RECHECK_FAILED, SHOW_PROPOSAL_WAITS, findingRepairState, recheckFailure, recheckGone, repairWords } from "../../src/web/chat/repair-words.ts";
import { ApiError, UNREACHABLE } from "../../src/web/api.ts";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, UNREADABLE_WORDS, failsAgain } from "../../src/web/shell/unexpected.ts";

test("a sent request names the history and offers Open history beside Dismiss request (R6-23)", () => {
  for (const kind of ["proposal", "build", "finding"] as const) {
    const view = repairWords(kind, { sent: true, current: true });
    expect(view).toMatchObject({ dismissLabel: "Dismiss request", offer: "open_history" });
    expect(view.scope).toContain("open the chat history");
  }
});

test("a request that can still be sent is cancelled, and its words don't say Dismiss", () => {
  const view = repairWords("finding", { sent: false, current: true });
  expect(view).toMatchObject({ dismissLabel: "Cancel", offer: null });
  expect(view.scope).not.toContain("Dismiss");
});

test("a request that went out of date says Dismiss, which is what its button says", () => {
  for (const kind of ["proposal", "build"] as const) {
    const view = repairWords(kind, { sent: false, current: false });
    expect(view.dismissLabel).toBe("Dismiss request");
    expect(view.scope).toContain("Dismiss");
  }
});

test("an out-of-date finding offers to dismiss it and run a fresh review, the way to a finding that can be sent", () => {
  const view = repairWords("finding", { sent: false, current: false });
  expect(view.offer).toBe("fresh_review");
  // Plan a repair waits while a request is up, so the fresh review's button dismisses this one, and the words say what that drops.
  expect(view.scope).toContain("Dismissing it drops the request and any edits you made to it");
  expect(view.scope).toContain("Run a fresh review");
});

test("a finding whose review is still settling is checked, not out of date: Cancel only, no fresh-review offer, edits kept", () => {
  const view = repairWords("finding", { sent: false, current: false, checking: true });
  expect(view).toMatchObject({ dismissLabel: "Cancel", offer: null });
  expect(view.scope).not.toContain("out of date");
  expect(view.scope).toContain("edits are kept");
});

const finding = { kind: "problem" as const, id: "f1", dismissedAt: null };
const review = (items: { kind: string; id: string; dismissedAt: number | null }[] = [finding]) => ({ id: "rv1", revisionId: "r1", items }) as unknown as BoardReview;
const draft = { reviewId: "rv1", headRevisionId: "r1", findingId: "f1" };
const settled = { review: review(), busy: false, refreshing: false, stale: false };

test("a finding is current only when its review settled on it, and checking while the review is busy or read again (R6-23 review)", () => {
  expect(findingRepairState(draft, settled)).toBe("current");
  // Hiding another item, or the AI part finishing, reads the review again: never "out of date" in that moment.
  expect(findingRepairState(draft, { ...settled, busy: true })).toBe("checking");
  expect(findingRepairState(draft, { ...settled, refreshing: true })).toBe("checking");
  expect(findingRepairState(draft, { ...settled, review: null, refreshing: true })).toBe("checking");
});

test("a finding that really went out of date is stale once the review settles", () => {
  expect(findingRepairState(draft, { ...settled, stale: true })).toBe("stale");
  expect(findingRepairState(draft, { ...settled, review: review([{ ...finding, dismissedAt: 1 }]) })).toBe("stale");
  expect(findingRepairState(draft, { ...settled, review: review([]) })).toBe("stale");
  expect(findingRepairState({ ...draft, reviewId: "rv0" }, settled)).toBe("stale");
});

test("an out-of-date proposal request offers Dismiss and show the proposal, whose card holds the recovery action (R7-14)", () => {
  const view = repairWords("proposal", { sent: false, current: false });
  expect(view).toMatchObject({ dismissLabel: "Dismiss request", offer: "show_proposal" });
  expect(view.scope).toContain("Dismiss it and show the proposal");
  expect(view.scope).not.toContain("select its recovery action");
  // A build question has no card to go back to.
  expect(repairWords("build", { sent: false, current: false }).offer).toBeNull();
});

test("Dismiss and show the proposal waits while keyloom replies, with the reason beside it, like Send and New (#301 review)", () => {
  const replying = repairWords("proposal", { sent: false, current: false, replying: true });
  expect(replying.offer).toBe("show_proposal");
  expect(replying.offerWaits).toBe(SHOW_PROPOSAL_WAITS);
  expect(repairWords("proposal", { sent: false, current: false, replying: false }).offerWaits).toBeUndefined();
});

// R10-11: a recheck that failed says so in plain words, keeps its code, and never names the "recovery source".
test("a failed recheck says nothing was sent in plain words and keeps its code", () => {
  const lost = recheckFailure(new ApiError(0, UNREACHABLE));
  expect(lost.message).toBe(RECHECK_FAILED);
  expect(lost.message).not.toContain("recovery source");
  expect(failsAgain(lost)).toBe(false);
  const internal = recheckFailure(new ApiError(500, INTERNAL_WORDS, { code: "internal" }));
  expect(internal.code).toBe("internal");
  expect(internal.message).toBe(`${RECHECK_FAILED} ${INTERNAL_WORDS}`);
  expect(failsAgain(internal)).toBe(false);
  const unreadable = recheckFailure(new ApiError(400, UNREADABLE_WORDS, { code: "unreadable" }));
  expect(failsAgain(unreadable)).toBe(true);
});

// #313 review: a recheck that finds the proposal's conversation or the layout gone is out of date for good, like a changed proposal: it says
// what is gone, Send goes off, and Dismiss request is the only button. It never offers a Send request that fails the same way.
test("a recheck whose conversation or layout is gone says what is gone and offers only Dismiss request", () => {
  expect(recheckGone(new ApiError(404, 'no conversation "c1"', { code: "not_found" }), "conversation")).toBe("conversation");
  expect(recheckGone(new ApiError(404, "keyloom has no layout here.", { code: "not_found" }), "layout")).toBe("layout");
  // keyloom's catch-all 404 names nothing, so it stays a failed recheck with Restart keyloom; other failures may pass on a second try.
  expect(recheckGone(new ApiError(404, NOT_FOUND_WORDS, { code: "not_found", generic: true }), "conversation")).toBeNull();
  expect(recheckGone(new ApiError(0, UNREACHABLE, { code: "unreachable" }), "layout")).toBeNull();
  expect(recheckGone(new ApiError(500, INTERNAL_WORDS, { code: "internal" }), "layout")).toBeNull();
  const conversation = repairWords("proposal", { sent: false, current: false, gone: "conversation" });
  expect(conversation).toEqual({ scope: expect.stringContaining("no longer has the conversation this proposal came from"), dismissLabel: "Dismiss request", offer: null });
  expect(conversation.scope).toContain("can't be sent");
  const layout = repairWords("proposal", { sent: false, current: false, gone: "layout" });
  expect(layout).toEqual({ scope: expect.stringContaining("no longer has this layout"), dismissLabel: "Dismiss request", offer: null });
  // A sent request still points at its history.
  expect(repairWords("proposal", { sent: true, current: false, gone: "layout" }).offer).toBe("open_history");
});
