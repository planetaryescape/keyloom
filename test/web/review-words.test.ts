// The board review's words (D-340): markers become caps and chips, and the marker by the config name counts what shows.
import { describe, expect, test } from "bun:test";
import type { BoardReview } from "../../src/api/review.ts";
import type { ReviewItem } from "../../src/validation/review-item.ts";
import { aiMissingWords, appliedNotShown, applyFailureWords, grouped, markerWords, placeOf, placeWords, reviewProblemWords, segments } from "../../src/web/review/review-words.ts";

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  id: "x", source: "check", kind: "problem", severity: "warning", code: "c", title: "t", body: "b", keys: [], layers: [], proposalId: null, fixes: [], dismissedAt: null, ...over,
});
const review = (items: ReviewItem[]): BoardReview => ({
  id: "rev", layoutId: "lay", revisionId: "r1", trigger: "connect", checkedAt: 0, checks: { status: "done", summary: { layers: 6, keys: 80, combos: 8 } },
  ai: { status: "done", reason: null, model: null }, items, fixed: [],
  freshness: { current: true, reason: null },
});

describe("segments", () => {
  test("keys and layers are drawn, the words between kept, and a malformed marker reads as text", () => {
    expect(segments("Your {key:default-layer:64} key opens {layer:factory-test-layer}.")).toEqual([
      { kind: "text", text: "Your " }, { kind: "key", layerId: "default-layer", position: 64 }, { kind: "text", text: " key opens " },
      { kind: "layer", layerId: "factory-test-layer" }, { kind: "text", text: "." },
    ]);
    expect(segments("{layer:a:3}")).toEqual([{ kind: "text", text: "{layer:a:3}" }]);
    expect(segments("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });
});

describe("the marker and the groups", () => {
  test("count every visible suggestion even when it is nested under the finding it fixes", () => {
    const r = review([
      item({ id: "p" }), item({ id: "h", kind: "hint", severity: "info" }), item({ id: "h2", kind: "hint", severity: "info", dismissedAt: 5 }),
      item({ id: "s", kind: "suggestion", severity: "info", fixes: ["p"], proposalId: "cs" }),
    ]);
    expect(markerWords(r)).toBe("1 problem · 1 hint · 1 suggestion");
    expect(grouped(r).hints.map((i) => i.id)).toEqual(["h"]);
    expect(markerWords(review([item({ dismissedAt: 1 })]))).toBeNull();
  });
});

describe("where keys are", () => {
  const rows = { function: [0, 1, 2, 3, 4, 5], home: [10, 11], thumb: [20, 21, 22, 23] };
  test("keys are counted by the row they sit on, most first, and a key on no row is somewhere else", () => {
    expect(placeWords([1, 2, 3, 4, 5, 20, 21, 22, 23], rows)).toBe("5 on the function row, 4 by the thumbs");
    expect(placeWords([10, 20, 21], rows)).toBe("2 by the thumbs, 1 on the home row");
    expect(placeWords([11], rows)).toBe("on the home row");
    expect(placeOf(99, rows)).toBe("elsewhere on the board");
    expect(placeOf(0, { macro: [0] })).toBe("on the macro row");
  });
});

describe("no suggestions says why and offers the fix (R4-10)", () => {
  const ai = (status: "unavailable" | "failed", model: string | null, code: string | null = null) => ({ status, reason: "r", model, code });
  test("no model set up opens the setup only: trying again can't help until one is", () => {
    expect(aiMissingWords(ai("unavailable", null))).toEqual({ words: "Suggestions need a model, and none is set up.", actions: ["set_up"], refused: false });
  });
  test("a refused account opens its key and can run again once it is fixed at the provider (#288 review)", () => {
    expect(aiMissingWords(ai("unavailable", "claude-opus-5-5", "auth"))).toMatchObject({ actions: ["set_up", "retry"], refused: true });
    expect(aiMissingWords(ai("unavailable", "claude-opus-5-5", "permission")).actions).toEqual(["set_up", "retry"]);
    // A review from before the code was kept is still a refusal.
    expect(aiMissingWords(ai("unavailable", "claude-opus-5-5")).actions).toEqual(["set_up", "retry"]);
  });
  test("an account out of credits offers Add credits first, by its code", () => {
    const view = aiMissingWords(ai("unavailable", "claude-opus-5-5", "no_credits"));
    expect(view).toMatchObject({ actions: ["credits", "set_up", "retry"], refused: true });
    expect(view.words).toContain("out of credits");
  });
  test("a look that stopped for another reason tries again", () => {
    expect(aiMissingWords(ai("failed", "claude-opus-5-5")).actions).toEqual(["retry"]);
  });
});

describe("Apply that changed nothing says so beside Apply (R4-07)", () => {
  test("a stale or refused suggestion offers a fresh review, never the same Apply", () => {
    for (const code of ["stale_base", "validation_failed", "not_found", "usage"]) expect(applyFailureWords({ code, status: 409, message: "x" }).action).toBe("fresh_review");
  });
  test("another refusal tries again", () => {
    expect(applyFailureWords({ code: "busy", status: 409, message: "A build is running." })).toEqual({ words: "Nothing was applied: A build is running.", action: "retry" });
  });
  test("no answer, or a failure after the answer, never claims nothing was applied; the page checks first (#288 review)", () => {
    for (const status of [0, 200, -1]) {
      const view = applyFailureWords({ code: undefined, status, message: "x" });
      expect(view.action).toBe("check");
      expect(view.words).not.toContain("nothing was applied");
    }
  });
});


describe("reviewProblemWords (R5-10)", () => {
  test("no answer or a server fault repeats the same request", () => {
    expect(reviewProblemWords("run", { code: undefined, status: -1, message: "fetch failed" })).toEqual({ words: "keyloom couldn't start the review. The server didn't answer.", button: "Try again", next: "repeat" });
    expect(reviewProblemWords("dismiss", { code: "internal", status: 500, message: "internal error" })).toEqual({ words: "keyloom couldn't hide that. It hit an unexpected error.", button: "Try again", next: "repeat" });
  });
  test("a refusal reads the review again with the server's reason, since repeating it would be refused too", () => {
    expect(reviewProblemWords("restore", { code: "not_found", status: 404, message: "the latest review of x has no item \"y\"" })).toEqual({ words: "keyloom couldn't show that again. the latest review of x has no item \"y\".", button: "Read the review again", next: "reload" });
    expect(reviewProblemWords("run", { code: "usage", status: 400, message: "The review is still running. Wait for it to finish before changing activities." })).toMatchObject({ next: "reload" });
  });
  test("a failed read is always tried again", () => {
    expect(reviewProblemWords("load", { code: "not_found", status: 404, message: "no layout" })).toMatchObject({ button: "Try again", next: "repeat" });
  });
});

test("Show the new layout that fails again still says the change is applied, with why (R5-09)", () => {
  expect(appliedNotShown(new Error("Failed to fetch"))).toEqual({ words: "Applied. keyloom still couldn't show the new layout. Failed to fetch.", action: "show" });
  expect(appliedNotShown("x")).toEqual({ words: "Applied. keyloom still couldn't show the new layout.", action: "show" });
});
