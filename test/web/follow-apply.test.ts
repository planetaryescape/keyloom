// R5-08: once the server has applied a change, a failure to show it is never reported as a failed Apply.
import { expect, test } from "bun:test";
import { followApply } from "../../src/web/proposals/follow-apply.ts";

test("a refresh that fails is reported as not shown, and the Apply still resolves", async () => {
  const seen: unknown[] = [];
  const failure = new Error("Failed to fetch");
  await expect(followApply(() => Promise.reject(failure), (e) => seen.push(e))).resolves.toBe(false);
  expect(seen).toEqual([failure]);
});

test("a refresh that works reports nothing", async () => {
  const seen: unknown[] = [];
  await expect(followApply(async () => {}, (e) => seen.push(e))).resolves.toBe(true);
  expect(seen).toEqual([]);
});
