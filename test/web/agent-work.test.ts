import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentWorking } from "../../src/web/chat/AgentWorking.tsx";
import { MAX_WORK_ROWS, observedDuration, operationStatusWords, preserveWorkFocus, projectWork, workDetailsOpen, type AgentOperationView, type AgentWorkView } from "../../src/web/chat/work-view.ts";

const operation = (status: AgentOperationView["status"], id = "read-keys"): AgentOperationView => ({
  id, status, label: "Read selected keys", target: "Moonlander · Daily · Base", durationMs: 200, summary: "Read K and L.",
});
const observed = (status: AgentWorkView["status"], operations: readonly AgentOperationView[]): Extract<AgentWorkView, { kind: "observed" }> => ({
  kind: "observed", status, label: null, operations, notes: [],
});
const html = (view: AgentWorkView) => renderToStaticMarkup(createElement(AgentWorking, { view }));

describe("observed working, not inferred tool success", () => {
  test("a completed answer cannot turn an unfinished operation into success", () => {
    const work = projectWork(observed("completed", [operation("succeeded"), operation("running", "check")]));
    expect(work.routine.map((op) => op.id)).toEqual(["read-keys"]);
    expect(work.attention.map((op) => [op.id, op.status])).toEqual([["check", "unknown"]]);
    expect(work.canFold).toBe(false);
    const rendered = html(observed("completed", [operation("running")]));
    expect(rendered).toContain("Outcome not confirmed");
    expect(rendered).not.toContain("Completed");
    expect(rendered).toContain("some steps need attention");
    expect(rendered).not.toContain('data-active="true"');
  });

  test.each(["waiting", "failed", "stopped", "disconnected"] as const)("%s does not leave an old tool falsely running", (status) => {
    const work = projectWork(observed(status, [operation("running")]));
    expect(work.attention[0]?.status).toBe("unknown");
    expect(work.canFold).toBe(false);
  });

  test("failed, cancelled and unknown steps stay outside routine working even with a completed answer", () => {
    const view = observed("completed", [operation("succeeded"), operation("failed", "bad"), operation("unknown", "lost"), operation("cancelled", "cancelled")]);
    const rendered = html(view);
    const toggle = rendered.indexOf("agent-work-disclosure");
    expect(rendered.indexOf('data-state="failed"')).toBeLessThan(toggle);
    expect(rendered.indexOf('data-state="unknown"')).toBeLessThan(toggle);
    expect(rendered.indexOf('data-state="cancelled"')).toBeLessThan(toggle);
    expect(rendered).toContain('aria-expanded="true"');
    expect(rendered).not.toContain("On your keyboard");
  });

  test("only a fully observed successful completion folds by default", () => {
    expect(html(observed("completed", [operation("succeeded")]))).toContain('aria-expanded="false"');
    expect(html(observed("running", [operation("succeeded")]))).toContain('aria-expanded="true"');
    expect(html(observed("waiting", [operation("succeeded")]))).toContain("Needs your answer");
    expect(html(observed("failed", [operation("succeeded")]))).toContain('aria-expanded="true"');
  });

  test("a stale phase label cannot disguise a failure or a pending answer", () => {
    expect(html({ ...observed("failed", [operation("failed")]), label: "All done" })).not.toContain("All done");
    expect(html({ ...observed("waiting", [operation("succeeded")]), label: "Checking keys…" })).toContain("Needs your answer");
  });

  test("legacy history cannot invent operation rows, elapsed time or note/answer boundaries", () => {
    const rendered = html({ kind: "unavailable", status: "completed" });
    expect(rendered).toContain("Working details unavailable for this conversation.");
    expect(rendered).not.toContain("agent-operation");
    expect(rendered).not.toContain("completed step");
    expect(rendered).not.toContain(" ms");
  });

  test("bounds stay explicit and cannot turn omitted failures into a clean success", () => {
    const operations = [operation("failed", "earlier-failure"), ...Array.from({ length: MAX_WORK_ROWS }, (_, i) => operation("succeeded", `read-${i}`))];
    const work = projectWork(observed("completed", operations));
    expect(work.routine).toHaveLength(MAX_WORK_ROWS);
    expect(work.omitted).toBe(1);
    expect(work.canFold).toBe(false);
    expect(html(observed("completed", operations))).toContain("Their outcomes are not confirmed here.");
  });

  test("public text is bounded; missing labels and invalid timings do not fabricate facts", () => {
    const work = projectWork(observed("running", [{ ...operation("unknown"), label: " ", target: "x".repeat(500), summary: "y".repeat(2_000) }]));
    expect(work.attention[0]?.label).toBe("Keyboard operation");
    expect(work.attention[0]?.target).toHaveLength(160);
    expect(work.attention[0]?.summary).toHaveLength(600);
    for (const invalid of [null, -1, NaN, Infinity]) expect(observedDuration(invalid)).toBeNull();
    expect(observedDuration(0)).toBe("0 ms");
    expect(observedDuration(1_200)).toBe("1.2 s");
    expect(operationStatusWords("succeeded")).toBe("Completed");
  });
});

describe("working disclosure choices", () => {
  test("automatic folding waits while focus is inside, and preserves that open choice after focus leaves", () => {
    let choice = preserveWorkFocus("automatic", false, true);
    expect(workDetailsOpen(choice, false, true)).toBe(true);
    choice = preserveWorkFocus(choice, true, true);
    expect(workDetailsOpen(choice, true, true)).toBe(true);
    expect(workDetailsOpen(choice, true, false)).toBe(true);
  });

  test("explicit user-open is preserved through new chunks and terminal states", () => {
    for (const canFold of [false, true, false, true]) {
      expect(preserveWorkFocus("open", canFold, false)).toBe("open");
      expect(workDetailsOpen("open", canFold, false)).toBe(true);
    }
  });

  test("explicitly closed routine work remains closed without hiding attention rows", () => {
    expect(workDetailsOpen("closed", false, false)).toBe(false);
    expect(preserveWorkFocus("closed", true, true)).toBe("closed");
    const work = projectWork(observed("failed", [operation("failed")]));
    expect(work.attention).toHaveLength(1);
    expect(work.routine).toHaveLength(0);
  });
});
