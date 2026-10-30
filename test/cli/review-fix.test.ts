// `keyloom review fix` (D-461): one agent run with the same fixed request the review panel's button sends, followed like `agent start`.
// The findings are read by the get_review tool at run time, the answer revises the proposal, and applying it remembers the answer.
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { REVIEW_FIX_REQUEST } from "../../src/api/review.ts";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { applyChange, listDecisions, openApp } from "../../src/app/index.ts";
import { inspectAgentRun, savedRunOutcome } from "../../src/app/agent-runs.ts";
import { findChangeSet } from "../../src/persistence/change-sets.ts";
import { fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { withoutCredentials } from "../helpers/no-credentials.ts";
import { draft } from "../helpers/ops.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { savedId } from "../helpers/review-world.ts";

async function cli(args: string[], deps: Parameters<typeof runCli>[2] = {}) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io, deps), out, err };
}

const PUT_F17 = { op: "setBinding", at: { layerId: "layer-0", position: 33 }, binding: { kind: "key", code: "F17" } };
const TITLE = "F17 on the left empty key";
const QUESTION = {
  question: "Which empty key should take F17?", considerations: ["Both keys do nothing today."], step: { n: 1, of: 1 },
  options: [{ id: "left", label: "The left one", recommended: true }, { id: "right", label: "The right one" }],
};
const proposal = (over: object = {}) => ({
  alternatives: [{
    title: TITLE, ops: [PUT_F17], explanation: "One press for a key you use.", tradeoffs: { gains: ["F17 is one press"], costs: ["The empty key is gone"] },
    decisionDraft: draft({ goal: "Fix what the review found", choice: "F17 on the left empty key", reason: "The review found keys that do nothing." }), ...over,
  }],
});

/** A review of the config with the checks' one hint, made the way `keyloom review --run` makes it without a model. */
async function reviewed() {
  const w = await optionOptionApp();
  await withoutCredentials(() => cli(["review", "bk", "--run", "--format", "table", "--data-dir", w.dir]));
  return w;
}

const runIdOf = (text: string) => /^(run_\w+): (?:waiting_user|completed)/m.exec(text)?.[1] ?? "";

describe("keyloom review fix", () => {
  test("asks the same fixed request, reads the review by tool, then follows the question to the answer line", async () => {
    const w = await reviewed();
    let supersede = "";
    const answer = "The left one, my left thumb is free.";
    const fake = fakeAnthropic([
      { blocks: [{ tool: "get_review", input: {} }] },
      () => ({ blocks: [{ tool: "propose_changes", input: proposal() }] }),
      { blocks: [{ tool: "ask_user", input: QUESTION }] },
      () => ({ blocks: [{ tool: "propose_changes", input: proposal({ supersedes: supersede, decisionDraft: draft({ goal: "Fix what the review found", choice: "F17 on the left empty key", reason: `The review found keys that do nothing. You said: ${answer}` }) }) }] }),
      { blocks: [{ text: "F17 goes on the left empty key." }] },
    ]);
    const run = await cli(["review", "fix", "bk", "--format", "table", "--data-dir", w.dir], { model: anthropicModel(fake.client) });
    expect(run.code).toBe(0);

    // The run is this config's, through startAgentRun, with the one request text both surfaces send.
    const first = runIdOf(run.out);
    const row = w.app.db.query("SELECT layout_id, request_json FROM agent_runs WHERE id = ?").get(first) as { layout_id: string; request_json: string };
    expect(row.layout_id).toBe(w.layoutId);
    expect(JSON.parse(row.request_json)).toMatchObject({ version: 1, layoutRef: w.layoutId, input: { message: REVIEW_FIX_REQUEST } });
    expect(JSON.stringify(fake.requests[0]?.body)).toContain(REVIEW_FIX_REQUEST);

    // The agent read the review first: the second request carries get_review's own answer.
    expect(fake.requests).toHaveLength(3);
    expect(JSON.stringify(fake.requests[1]?.body)).toContain("The newest board review of this config");
    const answerLine = /Answer with: keyloom agent answer (run_\w+) (\S+) <answer>/.exec(run.out);
    expect(answerLine).not.toBeNull();
    expect(run.out).toContain(QUESTION.question);
    expect(run.out).toContain("The left one / The right one");

    // One question, two options with the recommended first, and its answer revises the proposal instead of adding another.
    const app = openApp({ dataDir: w.dir });
    const paused = await inspectAgentRun(app, answerLine?.[1] ?? "");
    expect(paused.status).toBe("waiting_user");
    const asked = savedRunOutcome(app, paused.id).question;
    expect(asked?.options.map((option) => [option.label, option.recommended])).toEqual([["The left one", true], ["The right one", undefined]]);
    const proposed = app.db.query("SELECT id FROM change_sets WHERE layout_id = ? AND status = 'proposed'").all(w.layoutId) as Array<{ id: string }>;
    expect(proposed).toHaveLength(1);
    const old = proposed[0]?.id ?? "";
    supersede = old;

    const answered = await cli(
      ["agent", "answer", paused.id, asked?.toolUseId ?? "", answer, "--request-id", "answer-fix-1", "--format", "table", "--data-dir", w.dir],
      { model: anthropicModel(fake.client) },
    );
    expect(answered.code).toBe(0);    expect(findChangeSet(app.db, old)?.status).toBe("superseded");
    const revised = app.db.query("SELECT id, tradeoffs FROM change_sets WHERE layout_id = ? AND status = 'proposed'").all(w.layoutId) as Array<{ id: string; tradeoffs: string }>;
    expect(revised).toHaveLength(1);
    expect(revised[0]?.id).not.toBe(old);
    expect(JSON.parse(revised[0]?.tradeoffs ?? "{}")).toMatchObject({ supersedes: old });

    // Apply, and the decision remembers the answer and the request it came from.
    applyChange(app, revised[0]?.id ?? "");
    const choice = listDecisions(app, w.layoutId, { kind: "choice" })[0];
    expect(choice?.reason).toContain(answer);
    expect(choice?.sourceMessageIds).toContain(paused.userMessageId);

    // A second request after Apply starts a new run and is not refused.
    const later = await cli(["review", "fix", "bk", "--format", "table", "--data-dir", w.dir], {
      model: anthropicModel(fakeAnthropic([
        { blocks: [{ tool: "get_review", input: {} }] },
        () => ({ blocks: [{ tool: "propose_changes", input: proposal() }] }),
        { blocks: [{ text: "F17 is on the left empty key." }] },
      ]).client),
    });
    expect(later.code).toBe(0);
    expect(later.err).not.toContain("refused");
    expect(later.out).toContain("completed");
    const runs = app.db.query("SELECT id, conversation_id, status FROM agent_runs ORDER BY created_at").all() as Array<{ id: string; conversation_id: string; status: string }>;
    expect(runs.every((row) => row.status === "completed")).toBe(true);
    expect(runs[1]?.conversation_id).toBe(runs[0]?.conversation_id);
    expect(runs[2]?.conversation_id).not.toBe(runs[0]?.conversation_id);
  });

  test("a second press beside an open question starts a new conversation and leaves the question open", async () => {
    const w = await reviewed();
    const script = () => fakeAnthropic([
      { blocks: [{ tool: "get_review", input: {} }] },
      () => ({ blocks: [{ tool: "propose_changes", input: proposal() }] }),
      { blocks: [{ tool: "ask_user", input: QUESTION }] },
    ]);
    const first = await cli(["review", "fix", "bk", "--format", "table", "--data-dir", w.dir], { model: anthropicModel(script().client) });
    const firstRun = runIdOf(first.out);
    const question = /Answer with: keyloom agent answer (run_\w+) (\S+) <answer>/.exec(first.out)?.[2];
    expect(first.code).toBe(0);

    // Fix issues again, before answering: a new conversation, not an answer to the old question and not a refusal.
    const second = await cli(["review", "fix", "bk", "--format", "table", "--data-dir", w.dir], {
      model: anthropicModel(fakeAnthropic([
        { blocks: [{ tool: "get_review", input: {} }] },
        () => ({ blocks: [{ tool: "propose_changes", input: proposal() }] }),
        { blocks: [{ text: "F17 is on the empty key." }] },
      ]).client),
    });
    expect(second.code).toBe(0);
    expect(second.out).toContain("completed");

    const app = openApp({ dataDir: w.dir });
    const still = await inspectAgentRun(app, firstRun);
    expect(still.status).toBe("waiting_user");
    expect(savedRunOutcome(app, still.id).question?.toolUseId).toBe(question);
    const runs = app.db.query("SELECT conversation_id FROM agent_runs ORDER BY created_at").all() as Array<{ conversation_id: string }>;
    expect(runs).toHaveLength(2);
    expect(runs[1]?.conversation_id).not.toBe(runs[0]?.conversation_id);
  });

  test("a config with no review says how to make one, and starts nothing", async () => {
    const w = await optionOptionApp();
    const fake = fakeAnthropic([]);
    const r = await cli(["review", "fix", "bk", "--format", "table", "--data-dir", w.dir], { model: anthropicModel(fake.client) });
    expect(r.code).toBe(2);
    expect(r.err).toContain("no review of bk yet; make one with: keyloom review bk --run");
    expect(fake.requests).toHaveLength(0);
  });

  test("with nothing left to fix it says so rather than paying for a run", async () => {
    const w = await reviewed();
    const json = JSON.parse((await cli(["review", "bk", "--json", "--data-dir", w.dir])).out);
    const item = json.review.items.find((i: { kind: string }) => i.kind === "hint");
    await cli(["review", "dismiss", item.id, "--layout", "bk", "--format", "table", "--data-dir", w.dir]);
    const fake = fakeAnthropic([]);
    const r = await cli(["review", "fix", "bk", "--format", "table", "--data-dir", w.dir], { model: anthropicModel(fake.client) });
    expect(r.code).toBe(2);
    expect(r.err).toContain("nothing to fix: no problems or hints that you have not hidden");
    expect(fake.requests).toHaveLength(0);
  });

  test("no model leaves a visible error, not silence", async () => {
    const w = await reviewed();
    const r = await withoutCredentials(() => cli(["review", "fix", "bk", "--format", "table", "--data-dir", w.dir]));
    expect(r.code).toBe(9);
    expect(r.err).toContain("No model provider is set up");
    expect(w.app.db.query("SELECT count(*) AS count FROM agent_runs").get()).toEqual({ count: 0 });
  });

  test("--json answers with the run, not words", async () => {
    const w = await reviewed();
    const fake = fakeAnthropic([
      { blocks: [{ tool: "get_review", input: {} }] },
      () => ({ blocks: [{ tool: "propose_changes", input: proposal() }] }),
      { blocks: [{ text: "F17 is on the left empty key." }] },
    ]);
    const r = await cli(["review", "fix", "bk", "--json", "--data-dir", w.dir], { model: anthropicModel(fake.client) });
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out);
    expect(json).toMatchObject({ schema_version: 1, status: "completed", conversationId: expect.stringMatching(/^conv_/) });
    expect(json.presentation.operations).toContainEqual(expect.objectContaining({ tool: "propose_changes", references: [expect.objectContaining({ kind: "proposal" })] }));
    const proposed = w.app.db.query("SELECT title FROM change_sets WHERE layout_id = ? AND status = 'proposed'").all(w.layoutId) as Array<{ title: string }>;
    expect(proposed.map((row) => row.title)).toEqual([TITLE]);
  });
});
