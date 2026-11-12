import { expect, test } from "bun:test";
import type { BoardReview } from "../../src/api/review.ts";
import { findingRepairState, repairWords } from "../../src/web/chat/repair-words.ts";

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
