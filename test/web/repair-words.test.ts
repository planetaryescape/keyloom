import { expect, test } from "bun:test";
import { repairWords } from "../../src/web/chat/repair-words.ts";

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

test("an out-of-date finding offers Run a fresh review, the way to a finding that can be sent", () => {
  const view = repairWords("finding", { sent: false, current: false });
  expect(view.offer).toBe("fresh_review");
  expect(view.scope).toContain("Run a fresh review");
});
