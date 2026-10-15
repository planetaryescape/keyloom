import { describe, expect, test } from "bun:test";
import { plainSummary, tidySummary } from "../../src/layout/history-summary.ts";

describe("history summaries", () => {
  test("plainSummary drops a whole stack of prefixes and leaves the change", () => {
    expect(plainSummary("Back to: Redo: Back to: Layer 1, key 7: Tap A")).toBe("Layer 1, key 7: Tap A");
    expect(plainSummary("Layer 1, key 7: Tap A")).toBe("Layer 1, key 7: Tap A");
    expect(plainSummary("Undo: Undo: x")).toBe("x");
  });

  test("tidySummary keeps the first prefix only", () => {
    expect(tidySummary("Back to: Redo: Back to: Layer 1, key 7: Tap A")).toBe("Back to: Layer 1, key 7: Tap A");
    expect(tidySummary("Redo: Back to: X")).toBe("Redo: X");
    expect(tidySummary("Undo: X")).toBe("Undo: X");
    expect(tidySummary("Added layer Undo: later")).toBe("Added layer Undo: later");
  });
});
