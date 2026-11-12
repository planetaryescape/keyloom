import { expect, test } from "bun:test";
import { CLOSED_WORDS, proposalApplyFailure } from "../../src/web/chat/proposal-apply-words.ts";

test("a proposal applied or set aside elsewhere says it is no longer open, never the change-set ID (R6-06)", () => {
  const usage = proposalApplyFailure({ code: "usage", status: 400, message: "change set cs_01JX is applied, not proposed" });
  expect(usage).toEqual({ message: CLOSED_WORDS, stale: false, closed: true });
  expect(usage.message).not.toContain("cs_");
  expect(proposalApplyFailure({ code: "not_found", status: 404, message: "no change set cs_01JX" }).closed).toBe(true);
});

test("a layout that moved on is stale, not closed: it can be planned again", () => {
  expect(proposalApplyFailure({ code: "stale_base", status: 409, message: "x" })).toMatchObject({ stale: true, closed: false });
});

test("any other failure keeps its words and Apply", () => {
  expect(proposalApplyFailure({ message: "Can't reach keyloom." })).toEqual({ message: "Can't reach keyloom.", stale: false, closed: false });
  expect(proposalApplyFailure(null).closed).toBe(false);
});
