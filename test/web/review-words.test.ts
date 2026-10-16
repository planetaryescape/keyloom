// The board review's words (D-340): markers become caps and chips, and the marker by the config name counts what shows.
import { describe, expect, test } from "bun:test";
import type { BoardReview } from "../../src/api/review.ts";
import type { ReviewItem } from "../../src/validation/review-item.ts";
import { grouped, markerWords, placeOf, placeWords, segments } from "../../src/web/review/review-words.ts";

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
