import { expect, test } from "bun:test";
import { openApp, importLayout, getLayout, applyOps, proposeChange, sendMessage, proposalRecovery } from "../../src/app/index.ts";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";
import { draft, setKey } from "../helpers/ops.ts";
import { declinedProposalCodes, refusalReasons, formatProposalRecoveryRequest } from "../../src/validation/proposal-recovery.ts";
import { runCli } from "../../src/cli/main.ts";

test("actual validator refusal is unsaved, resolves its canonical goal and CLI draft writes nothing", async () => {
  const app = openApp({ dataDir: tempDir() });
  try {
    const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
    const fake = fakeAnthropic([{ blocks: [{ tool: "propose_changes", input: { alternatives: [{ title: "Missing target", ops: [{ op: "setBinding", at: { layerId: "synthetic-missing-layer", position: 33 }, binding: { kind: "key", code: "F17" } }], explanation: "Try the missing target", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() }] } }] }, { blocks: [{ text: "The validator refused the change." }] }]);
    const outcome = await sendMessage(app, layoutId, { message: "Distinctive original goal: give my index finger F17", model: anthropicModel(fake.client) });
    expect(outcome.proposals).toHaveLength(0);
    const before = app.db.serialize();
    const selector = { conversation: outcome.conversationId, turn: outcome.messageIds[0]! };
    const recovery = proposalRecovery(app, layoutId, selector);
    expect(recovery.request).toContain("Distinctive original goal");
    expect(recovery.request).toContain("exact affected target was not recorded");
    expect(recovery.request).not.toContain("synthetic-missing-layer");
    expect(app.db.serialize()).toEqual(before);
    for (const format of ["table", "json"]) {
      let output = "";
      const code = await runCli(["agent", "replan", layoutId, "--conversation", outcome.conversationId, "--turn", outcome.messageIds[0]!, "--draft", "--format", format, "--data-dir", app.dataDir], { out: (text) => { output += text; }, err: () => {}, isTTY: false });
      expect(code).toBe(0);
      expect(output).toContain("Distinctive original goal");
      if (format === "json") expect(JSON.parse(output)).toMatchObject({ version: 1, request: recovery.request });
    }
    expect(app.db.serialize()).toEqual(before);
    expect(() => proposalRecovery(app, layoutId, { ...selector, proposal: "missing" })).toThrow(/mix selectors/);
    expect(() => proposalRecovery(app, layoutId, { conversation: outcome.conversationId, turn: "wrong" })).toThrow(/no complete recorded/);
    const replacement = fakeAnthropic([{ blocks: [{ tool: "get_layout", input: {} }] }, { blocks: [{ tool: "propose_changes", input: { alternatives: [{ title: "Replacement", ops: setKey(33, "F17"), explanation: "Replace only the selected key", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() }] } }] }, { blocks: [{ text: "Ready for preview" }] }]);
    const base = getLayout(app, layoutId).revision.id;
    const code = await runCli(["agent", "replan", layoutId, "--conversation", outcome.conversationId, "--turn", outcome.messageIds[0]!, "--format", "json", "--data-dir", app.dataDir], { out: () => {}, err: () => {}, isTTY: false }, { model: anthropicModel(replacement.client) });
    expect(code).toBe(0);
    expect(replacement.requests).toHaveLength(3);
    expect(getLayout(app, layoutId).revision.id).toBe(base);
  } finally { app.db.close(); }
});

test("overlong generated CLI request is refused before run creation or model calls", async () => {
  const app = openApp({ dataDir: tempDir() });
  try {
    const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
    const fake = fakeAnthropic([{ blocks: [{ tool: "propose_changes", input: { alternatives: [{ title: "Missing target", ops: setKey(33, "F17", "missing"), explanation: "Refused", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() }] } }] }, { blocks: [{ text: "Refused" }] }]);
    const source = await sendMessage(app, layoutId, { message: "x".repeat(7900), model: anthropicModel(fake.client) });
    const before = app.db.serialize(); let error = "";
    const code = await runCli(["agent", "replan", layoutId, "--conversation", source.conversationId, "--turn", source.messageIds[0]!, "--data-dir", app.dataDir], { out: () => {}, err: (text) => { error += text; }, isTTY: false });
    expect(code).not.toBe(0); expect(error).toContain("--draft"); expect(app.db.serialize()).toEqual(before);
  } finally { app.db.close(); }
});

test("stale proposal retains saved intent, disjoint old bases do not become fake refusals", async () => {
  const app = openApp({ dataDir: tempDir() });
  try {
    const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
    const source = proposeChange(app, layoutId, { source: "agent", title: "Index F17", explanation: "Distinct explanation", ops: setKey(33, "F17"), decisionDraft: { ...draft({ goal: "Distinctive saved intent" }), sourceMessageIds: [] } });
    applyOps(app, layoutId, { baseRevisionId: getLayout(app, layoutId).revision.id, ops: setKey(36, "F18"), summary: "Unrelated neighbor" });
    expect(() => proposalRecovery(app, layoutId, { proposal: source.id })).toThrow(/still validates/);
    applyOps(app, layoutId, { baseRevisionId: getLayout(app, layoutId).revision.id, ops: setKey(33, "F19"), summary: "Conflicting head" });
    const result = proposalRecovery(app, layoutId, { proposal: source.id });
    expect(result.context.goal).toBe("Distinctive saved intent");
    expect(result.context.goalBasis).toBe("saved goal");
    expect(result.context.reasons.join(" ")).toContain("changed");
    const other = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "Other" });
    expect(() => proposalRecovery(app, other.layoutId, { proposal: source.id })).toThrow(/belonging to this config/);
  } finally { app.db.close(); }
});

test("partial/generic/truncated evidence cannot manufacture an unsaved refusal; unknown codes and long goals remain truthful", () => {
  const op = { tool: "propose_changes", status: "declined", accepted: 0, declined: 1, validationCodes: ["unknown_ref"], references: [] };
  const p = { status: "completed", detailsTruncated: false, operations: [op] };
  expect(declinedProposalCodes(p)).toEqual(["unknown_ref"]);
  for (const operation of [{ ...op, status: "failed" }, { ...op, status: "partial", accepted: 1 }, { ...op, references: [{ kind: "proposal" }] }]) expect(declinedProposalCodes({ ...p, operations: [operation] })).toEqual([]);
  expect(declinedProposalCodes({ ...p, detailsTruncated: true })).toEqual([]);
  expect(refusalReasons(["__proto__"]).join(" ")).toContain("recorded validation rule");
  const goal = "x".repeat(8000);
  const request = formatProposalRecoveryRequest({ title: "Long", goal, goalBasis: "request", reasons: ["Refused"] });
  expect(request).toContain(goal);
  expect(request.length).toBeGreaterThan(8000);
});
