import { describe, expect, test } from "bun:test";
import type { BoardSync } from "../../src/api/http.ts";
import { createEventParser } from "../../src/web/sync/events.ts";

const board = { boardId: "zsa/moonlander", boardName: "Moonlander", layoutId: "lay_1", layoutName: "x", headRevisionId: "rev_1", otherLayouts: 0, state: { kind: "in_sync" }, auto: { on: true, choice: null, paused: false, proven: true, provenAt: 1, dueAt: null }, last: null };
const frame = (boards: unknown[]) => `event: sync\ndata: ${JSON.stringify({ type: "sync", boards })}\n\n`;

function collect() {
  const seen: BoardSync[][] = [];
  let unreadable = 0;
  return { seen, unreadable: () => unreadable, parser: createEventParser((b) => seen.push(b), () => unreadable++) };
}

describe("the events parser", () => {
  test("reads a frame, whole or split anywhere, with comments between", () => {
    const { seen, parser } = collect();
    const text = `: keepalive\n\n${frame([board])}${frame([])}`;
    for (const piece of text.match(/[\s\S]{1,7}/g) ?? []) parser.push(piece);
    expect(seen.map((b) => b.length)).toEqual([1, 0]);
  });

  test("reads CRLF frames", () => {
    const { seen, parser } = collect();
    parser.push(frame([board]).replaceAll("\n", "\r\n"));
    expect(seen).toHaveLength(1);
  });

  test("drops a frame it can't read and goes on to the next", () => {
    const { seen, unreadable, parser } = collect();
    parser.push("event: sync\ndata: {nope\n\n");
    parser.push(`event: sync\ndata: ${JSON.stringify({ type: "sync", boards: [{ boardId: 3 }] })}\n\n`);
    parser.push(frame([board]));
    expect(unreadable()).toBe(2);
    expect(seen).toHaveLength(1);
  });
});

describe("review frames (D-340)", () => {
  const review = { type: "review", layoutId: "lay_1", revisionId: "rev_1", reviewId: "rvw_1", aiStatus: "done" };
  const reviewFrame = (e: unknown) => `event: review\ndata: ${JSON.stringify(e)}\n\n`;

  test("a review frame goes to the review callback and is not mistaken for a sync frame", () => {
    const seen: BoardSync[][] = [];
    const reviews: unknown[] = [];
    let unreadable = 0;
    const parser = createEventParser((b) => seen.push(b), () => unreadable++, (e) => reviews.push(e));
    parser.push(`${reviewFrame(review)}${frame([board])}`);
    expect(reviews).toEqual([review]);
    expect(seen).toHaveLength(1);
    expect(unreadable).toBe(0);
  });

  test("a caller that doesn't care about reviews hears nothing, and a review frame it can't read is dropped as unreadable", () => {
    const { seen, unreadable, parser } = collect();
    parser.push(reviewFrame(review));
    expect(unreadable()).toBe(0);
    parser.push(reviewFrame({ type: "review", layoutId: 3 }));
    expect(unreadable()).toBe(1);
    expect(seen).toEqual([]);
  });
});
