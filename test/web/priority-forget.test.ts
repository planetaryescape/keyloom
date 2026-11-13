// R10-02: after one Forget lands, the turn's other Forget buttons come back on. The chips share one `removing` state, and the component
// stays mounted when a chip leaves, so a success must clear it as a failure does.
import { expect, test } from "bun:test";
import { ApiError } from "../../src/web/api.ts";
import { forgetPriority } from "../../src/web/chat/PriorityChips.tsx";
import type { PageFailure } from "../../src/web/shell/unexpected.ts";

function recorder() {
  const removing: (string | null)[] = [];
  const problems: (PageFailure | null)[] = [];
  return { removing, problems, setRemoving: (id: string | null) => void removing.push(id), setProblem: (p: PageFailure | null) => void problems.push(p) };
}

test("a Forget that lands turns every Forget button back on", async () => {
  const r = recorder();
  await forgetPriority("p1", async () => {}, r.setRemoving, r.setProblem);
  expect(r.removing).toEqual(["p1", null]);
  expect(r.problems).toEqual([null]);
});

test("a second Forget can run after the first one lands", async () => {
  const r = recorder();
  const forgotten: string[] = [];
  const onRemove = async (id: string) => void forgotten.push(id);
  await forgetPriority("p1", onRemove, r.setRemoving, r.setProblem);
  await forgetPriority("p2", onRemove, r.setRemoving, r.setProblem);
  expect(forgotten).toEqual(["p1", "p2"]);
  expect(r.removing.at(-1)).toBeNull();
});

test("a Forget that fails keeps its code and turns the buttons back on", async () => {
  const r = recorder();
  await forgetPriority("p1", async () => { throw new ApiError(500, "boom", { code: "internal" }); }, r.setRemoving, r.setProblem);
  expect(r.removing).toEqual(["p1", null]);
  expect(r.problems.at(-1)?.code).toBe("internal");
});
