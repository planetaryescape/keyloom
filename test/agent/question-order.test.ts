// A question refines the last proposal saved before it, in the order the model made its calls, and never a proposal from a call after it (D-452).
// The Anthropic and OpenRouter adapter runs the calls that follow a question (a proposal batched with it has to reach the board), so a question
// recorded against "the last proposal of the turn" would be recorded against one that came after it. Each provider is played by a scripted model.
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { codexModel } from "../../src/agent/codex-model.ts";
import { type AgentModel, emptyUsage } from "../../src/agent/model.ts";
import { type App, applyChange, listChanges, sendMessage, showConversation } from "../../src/app/index.ts";
import { SKIPPED_ANSWER } from "../../src/app/question-skip.ts";
import { listMessages } from "../../src/persistence/conversations.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { type ScriptedBlock, type SeenRequest, fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { type FakeStep, fakeCodex } from "../helpers/fake-codex.ts";
import { draft } from "../helpers/ops.ts";
import { lastSaved } from "../helpers/refine-journey.ts";
import { tempDir } from "../helpers/tmp.ts";

const ops = (code: string) => [{ op: "dropFunction", function: "key:F16", reason: "you said so" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "key", code } }];
const proposal = (title: string, code: string, revision: { supersedes?: string | null } = {}) => ({ title, ops: ops(code), explanation: `${title}.`, tradeoffs: { gains: [], costs: [] }, decisionDraft: draft(), ...revision });
const question = (text = "Should P1 keep its placement?") => ({ question: text, considerations: ["It matters."], step: { n: 1, of: 2 }, options: [{ label: "Yes" }, { label: "No" }] });
const ask = (text?: string) => ({ tool: "ask_user", input: question(text) });
const propose = (title: string, code: string, supersedes: string | null) => ({ tool: "propose_changes", input: proposal(title, code, { supersedes }) });

const titles = (app: App, layoutId: string) => Object.fromEntries(listChanges(app, layoutId, {}).map((cs) => [cs.title, cs.id]));
const questionOf = (app: App, conversationId: string) => showConversation(app, conversationId).messages.flatMap((m) => (m.question === undefined ? [] : [m.question]))[0];

/**
 * One turn: P1 is saved in its first reply, and its second reply is `blocks`, the paused reply under test. A question refines the last
 * proposal saved before it in its own turn, so P1 is the proposal of an earlier reply. Returns the world after the turn, with every
 * proposal's id by title. `withP1: false` leaves the paused reply as the turn's first.
 */
async function scene(blocks: (p1: string) => ScriptedBlock[], opts: { provider?: "anthropic" | "openrouter"; withP1?: boolean } = {}) {
  const { app, layoutId } = await commandShiftApp();
  const { client } = fakeAnthropic([
    ...(opts.withP1 === false ? [() => ({ blocks: blocks("") })] : [
      { blocks: [{ tool: "propose_changes", input: proposal("P1", "F17") }] },
      (seen: SeenRequest) => ({ blocks: blocks(lastSaved(seen)) }),
    ]),
    { blocks: [{ text: "Understood." }] },
  ]);
  const model = anthropicModel(client, opts.provider === undefined ? {} : { provider: opts.provider });
  const turn = await sendMessage(app, layoutId, { message: "put F17 on F16", model });
  return { app, layoutId, conversationId: turn.conversationId, turn, ids: titles(app, layoutId), model };
}

describe("Anthropic: the order of the calls in the paused reply", () => {
  test("a proposal in a call after the question is not what it refines: it refines the one before, and applying the later one closes it", async () => {
    const make = () => scene(() => [ask(), propose("P2", "F18", null)]);
    const afterP2 = await make();
    expect(afterP2.turn.status).toBe("awaiting_answer");
    expect(afterP2.turn.question?.refines).toBe(afterP2.ids.P1);
    // The call after the question still ran: both proposals reached the board.
    expect(afterP2.turn.proposals.map((p) => p.title)).toEqual(["P1", "P2"]);
    expect(questionOf(afterP2.app, afterP2.conversationId)).toMatchObject({ answer: null, refines: afterP2.ids.P1 });
    // Applying the later proposal: Closed, not Skipped.
    applyChange(afterP2.app, afterP2.ids.P2 ?? "");
    const closed = questionOf(afterP2.app, afterP2.conversationId);
    expect(closed).toMatchObject({ closed: true, answer: expect.stringContaining('BK applied another proposal ("P2")') });
    expect(closed?.skipped).toBeUndefined();
    // Applying the one before it: Skipped.
    const afterP1 = await make();
    applyChange(afterP1.app, afterP1.ids.P1 ?? "");
    expect(questionOf(afterP1.app, afterP1.conversationId)).toMatchObject({ skipped: true, answer: SKIPPED_ANSWER });
  });

  test("a proposal in a call before the question is what it refines", async () => {
    const make = () => scene(() => [propose("P2", "F18", null), ask("Should P2 keep its placement?")]);
    const afterP2 = await make();
    expect(afterP2.turn.question?.refines).toBe(afterP2.ids.P2);
    applyChange(afterP2.app, afterP2.ids.P2 ?? "");
    expect(questionOf(afterP2.app, afterP2.conversationId)).toMatchObject({ skipped: true, answer: SKIPPED_ANSWER });
    const afterP1 = await make();
    applyChange(afterP1.app, afterP1.ids.P1 ?? "");
    expect(questionOf(afterP1.app, afterP1.conversationId)).toMatchObject({ closed: true });
  });

  test("with a call on each side, it refines the one before and the one after never counts", async () => {
    const make = () => scene(() => [propose("P2", "F18", null), ask("Should P2 keep its placement?"), propose("P3", "F19", null)]);
    const world = await make();
    expect(world.turn.question?.refines).toBe(world.ids.P2);
    expect(world.turn.proposals.map((p) => p.title)).toEqual(["P1", "P2", "P3"]);
    applyChange(world.app, world.ids.P3 ?? "");
    expect(questionOf(world.app, world.conversationId)).toMatchObject({ closed: true });
    const other = await make();
    applyChange(other.app, other.ids.P2 ?? "");
    expect(questionOf(other.app, other.conversationId)).toMatchObject({ skipped: true });
  });

  test("a question first in the turn refines none, and a proposal in the call after it closes it", async () => {
    const world = await scene(() => [ask(), propose("P2", "F18", null)], { withP1: false });
    expect(world.turn.question?.refines).toBeUndefined();
    expect(questionOf(world.app, world.conversationId)?.refines).toBeUndefined();
    applyChange(world.app, world.ids.P2 ?? "");
    expect(questionOf(world.app, world.conversationId)).toMatchObject({ closed: true });
  });

  test("a call after the question that revises the proposal it refines does not skip the question: nothing was applied, so it waits", async () => {
    const world = await scene((p1) => [ask(), propose("P2", "F18", p1)]);
    expect(world.turn.status).toBe("awaiting_answer");
    expect(world.turn.question).toMatchObject({ answer: null, refines: world.ids.P1 });
    expect(listChanges(world.app, world.layoutId, {}).map((cs) => [cs.title, cs.status])).toEqual([["P2", "proposed"], ["P1", "superseded"]]);
    // Nothing says BK applied anything, and he can still answer.
    expect(JSON.stringify(listMessages(world.app.db, world.conversationId))).not.toContain("BK applied");
    const answered = await sendMessage(world.app, world.layoutId, { conversationId: world.conversationId, answer: { toolUseId: world.turn.question?.toolUseId ?? "", text: "Yes" }, model: world.model });
    expect(answered.status).toBe("complete");
  });
});

describe("OpenRouter: the same adapter, the same order", () => {
  test("a call after the question is not what it refines", async () => {
    const world = await scene(() => [ask(), propose("P2", "F18", null)], { provider: "openrouter" });
    expect(showConversation(world.app, world.conversationId).conversation.provider).toBe("openrouter");
    expect(world.turn.question?.refines).toBe(world.ids.P1);
    applyChange(world.app, world.ids.P2 ?? "");
    expect(questionOf(world.app, world.conversationId)).toMatchObject({ closed: true });
  });
});

describe("Codex: nothing is saved after the question, so the question refines the last proposal saved", () => {
  const P = (title: string, code: string, supersedes: string | null) => proposal(title, code, { supersedes });
  const first: FakeStep = { call: "propose_changes", input: proposal("P1", "F17") };

  async function codexScene(steps: FakeStep[]) {
    const { app, layoutId } = await commandShiftApp();
    const fake = fakeCodex({ steps });
    const turn = await sendMessage(app, layoutId, { message: "put F17 on F16", model: codexModel({ env: { PATH: process.env.PATH, CODEX_HOME: tempDir("codex-order-"), KEYLOOM_CODEX_BIN: fake.bin } }) });
    return { app, layoutId, turn, ids: titles(app, layoutId) };
  }

  test("a proposal called after the question is refused by the tool server, so it is never saved and the question refines the one before", async () => {
    // The question's completion is reported after the next call runs, so that call certainly reaches the server while it is paused.
    const world = await codexScene([first, { call: "ask_user", input: question(), deferCompletion: true }, { call: "propose_changes", input: P("P2", "F18", null) }]);
    expect(world.turn.status).toBe("awaiting_answer");
    expect(world.turn.question?.refines).toBe(world.ids.P1);
    expect(Object.keys(world.ids)).toEqual(["P1"]);
    // And the history that is stored stops at the question.
    const calls = listMessages(world.app.db, world.turn.conversationId).flatMap((m) => m.content).flatMap((b) => (b.type === "tool_use" ? [b.name] : []));
    expect(calls).toEqual(["propose_changes", "ask_user"]);
    applyChange(world.app, world.ids.P1 ?? "");
    expect(questionOf(world.app, world.turn.conversationId)).toMatchObject({ skipped: true, answer: SKIPPED_ANSWER });
  });

  test("a proposal called before the question is what it refines, and the earlier one's apply closes it", async () => {
    const world = await codexScene([first, { call: "propose_changes", input: P("P2", "F18", null) }, { call: "ask_user", input: question("Should P2 keep its placement?") }]);
    expect(world.turn.question?.refines).toBe(world.ids.P2);
    applyChange(world.app, world.ids.P1 ?? "");
    expect(questionOf(world.app, world.turn.conversationId)).toMatchObject({ closed: true });
  });
});

// What the turn does with the position a provider reports. The adapters are tested above; this is the contract they report to.
describe("the position a provider reports (onPause)", () => {
  /** A model that makes its calls itself: each step proposes, or reports the question's place; it ends paused on a question. */
  const scripted = (steps: Array<{ propose: string; code: string } | "pause">, report: boolean): AgentModel => ({
    provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null,
    async run(request) {
      for (const step of steps) {
        if (step === "pause") {
          if (report) request.onPause?.();
          continue;
        }
        await request.tools.find((t) => t.name === "propose_changes")?.run(proposal(step.propose, step.code, { supersedes: null }));
      }
      const q = question();
      return { messages: [{ role: "assistant" as const, content: [{ type: "tool_use" as const, id: "q1", name: "ask_user", input: q }] }], stopReason: "awaiting_answer", pending: { id: "q1", name: "ask_user", input: q }, iterations: 1, usage: emptyUsage() };
    },
  });

  test("the proposals saved by the time it reports are the ones the question may refine", async () => {
    const { app, layoutId } = await commandShiftApp();
    const out = await sendMessage(app, layoutId, { message: "go", model: scripted([{ propose: "A", code: "F17" }, "pause", { propose: "B", code: "F18" }], true) });
    expect(out.proposals.map((p) => p.title)).toEqual(["A", "B"]);
    expect(out.question?.refines).toBe(titles(app, layoutId).A);
  });

  test("a provider that never reports counts everything saved as before the question", async () => {
    const { app, layoutId } = await commandShiftApp();
    const out = await sendMessage(app, layoutId, { message: "go", model: scripted([{ propose: "A", code: "F17" }, "pause", { propose: "B", code: "F18" }], false) });
    expect(out.question?.refines).toBe(titles(app, layoutId).B);
  });

  test("reporting before anything is saved means the question refines none", async () => {
    const { app, layoutId } = await commandShiftApp();
    const out = await sendMessage(app, layoutId, { message: "go", model: scripted(["pause", { propose: "A", code: "F17" }], true) });
    expect(out.proposals.map((p) => p.title)).toEqual(["A"]);
    expect(out.question?.refines).toBeUndefined();
  });
});
