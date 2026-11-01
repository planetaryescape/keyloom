import { expect, test } from "bun:test";
import type { ChatPresentation } from "../../src/api/http.ts";
import { presentationView } from "../../src/web/chat/presentation-view.ts";
import { operationStatusWords, projectWork } from "../../src/web/chat/work-view.ts";

const presentation = (status: ChatPresentation["status"] = "completed"): ChatPresentation => ({
  version: 1, userMessageId: "request", status, effectsMayHaveOccurred: false, warning: null, detailsTruncated: false,
  operations: [], messages: [{ id: "note", kind: "working_note", text: "Checking the thumb key." }, { id: "answer", kind: "answer", text: "Your preview is ready." }],
});
const operation = (status: ChatPresentation["operations"][number]["status"]): ChatPresentation["operations"][number] => ({
  id: "op1", tool: "propose_changes", label: "Prepare proposals", status, durationMs: 700,
  validationCodes: [], references: [], accepted: 0, declined: 0,
});

test("public notes exclude the answer; successful activity folds without hiding final content", () => {
  const view = presentationView({ ...presentation(), operations: [operation("succeeded")] });
  expect(view.kind).toBe("observed");
  if (view.kind !== "observed") throw new Error("missing observed view");
  expect(view.notes.map((note) => note.text)).toEqual(["Checking the thumb key."]);
  expect(projectWork(view).canFold).toBe(true);
});

test("declined and partial outcomes remain visible and distinct from success", () => {
  const view = presentationView({ ...presentation(), operations: [
    { ...operation("declined"), declined: 1, validationCodes: ["layer_trap"] },
    { ...operation("partial"), id: "op2", accepted: 1, declined: 2, references: [{ kind: "proposal", id: "proposal" }] },
  ] });
  if (view.kind !== "observed") throw new Error("missing observed view");
  expect(projectWork(view).routine).toEqual([]);
  expect(projectWork(view).attention.map((item) => operationStatusWords(item.status))).toEqual(["Not accepted", "Partly accepted"]);
  expect(view.operations[0]?.summary).toContain("Validation: layer_trap");
  expect(view.operations[1]?.summary).toContain("1 saved proposal");
  // Only routine working folds; both attention rows remain outside it.
  expect(projectWork(view).canFold).toBe(true);
});

test("lookup failures carry safe reasons and a recovery, including legacy missing reasons", () => {
  const view = presentationView({ ...presentation(), operations: [{ ...operation("failed"), tool: "find_function", failureCode: "function_id" }, { ...operation("failed"), id: "old" }] });
  if (view.kind !== "observed") throw new Error("missing observed view");
  expect(view.operations[0]?.summary).toContain("not recognised");
  expect(view.operations[0]?.summary).toContain("does not establish a keyboard limitation");
  expect(view.operations[1]?.summary).toContain("No failure reason was recorded");
});

test("incomplete histories keep their warning and cannot look like clean folded work", () => {
  const view = presentationView({ ...presentation("unobserved"), detailsTruncated: true, warning: "Work may still be running.", operations: [operation("running")] });
  if (view.kind !== "observed") throw new Error("missing observed view");
  expect(view.status).toBe("disconnected");
  expect(view.warning).toBe("Work may still be running.");
  expect(projectWork(view).attention[0]?.status).toBe("unknown");
  expect(view.operations[0]?.durationMs).toBeNull();
  expect(projectWork({ ...view, status: "completed", operations: [operation("succeeded")].map((item) => ({ ...item, target: null, summary: null })) }).canFold).toBe(false);
});

test("running labels and durations come from observations, never wall-clock estimates", () => {
  const view = presentationView({ ...presentation("running"), operations: [operation("running")] });
  if (view.kind !== "observed") throw new Error("missing observed view");
  expect(view.label).toBe("Prepare proposals");
  expect(view.operations[0]?.durationMs).toBeNull();
  expect(presentationView(presentation("waiting_user")).status).toBe("waiting");
  expect(presentationView(presentation("cancelled")).status).toBe("stopped");
});
