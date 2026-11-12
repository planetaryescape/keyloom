// R6-03: a direct edit the server wrote is applied even when the page can't read the new layout back.
import { expect, test } from "bun:test";
import { readAfterApply } from "../../src/web/editor/read-after-apply.ts";

test("a read that works resolves true and says nothing", async () => {
  const said: unknown[] = [];
  expect(await readAfterApply(async () => {}, (error) => said.push(error))).toBe(true);
  expect(said).toEqual([]);
});

test("a read that fails resolves false and hands the error on, so no caller reports a written change as not applied", async () => {
  const said: unknown[] = [];
  const failure = new Error("Couldn't reach keyloom");
  expect(await readAfterApply(async () => { throw failure; }, (error) => said.push(error))).toBe(false);
  expect(said).toEqual([failure]);
});

test("a direct edit that was written but couldn't be shown comes back applied, with the not-shown words said once (R6-03)", async () => {
  const { applyOps } = await import("../../src/web/editor/useChange.ts");
  const original = globalThis.fetch;
  const validation = { ok: true, errors: [], warnings: [], diff: { changed: [], displaced: [], dropped: [], relearnCount: 0, retuned: [], reminders: [] } };
  globalThis.fetch = Object.assign(async () => Response.json({ revisionId: "r2", changeSetId: "c1", validation, decisionId: null }), { preconnect: original.preconnect });
  const notShown: unknown[] = [];
  let stale = 0;
  try {
    const outcome = await applyOps(
      { token: "t", layoutRef: "l", revisionId: "r1", onChanged: async () => { throw new Error("read failed"); }, onNotShown: (error) => notShown.push(error), onStale: () => stale++ },
      [],
      "Swapped A and B",
    );
    expect(outcome).toEqual({ ok: true, shown: false, warnings: [] });
    expect(notShown).toHaveLength(1);
    expect(stale).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});
