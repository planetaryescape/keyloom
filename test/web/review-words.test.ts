// The board review's words (D-340): markers become caps and chips, and the marker by the config name counts what shows.
import { describe, expect, test } from "bun:test";
import type { BoardReview } from "../../src/api/review.ts";
import type { ReviewItem } from "../../src/validation/review-item.ts";
import { grouped, markerWords, segments } from "../../src/web/review/review-words.ts";

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  id: "x", source: "check", kind: "problem", severity: "warning", code: "c", title: "t", body: "b", keys: [], layers: [], proposalId: null, fixes: [], dismissedAt: null, ...over,
});
const review = (items: ReviewItem[]): BoardReview => ({
  id: "rev", layoutId: "lay", revisionId: "r1", trigger: "connect", checkedAt: 0, checks: { status: "done", summary: { layers: 6, keys: 80, combos: 8 } },
  ai: { status: "done", reason: null, model: null }, items, fixed: [],
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
  test("count problems and hints that show; a suggestion is counted with what it fixes; nothing is null", () => {
    const r = review([
      item({ id: "p" }), item({ id: "h", kind: "hint", severity: "info" }), item({ id: "h2", kind: "hint", severity: "info", dismissedAt: 5 }),
      item({ id: "s", kind: "suggestion", severity: "info", fixes: ["p"], proposalId: "cs" }),
    ]);
    expect(markerWords(r)).toBe("1 problem · 1 hint");
    expect(grouped(r).hints.map((i) => i.id)).toEqual(["h"]);
    expect(markerWords(review([item({ dismissedAt: 1 })]))).toBeNull();
  });
});
