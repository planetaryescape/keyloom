// Every way a question ends (D-452), and how one is answered after the layout head moved (D-458), through the durable run APIs the app uses
// (`startAgentRun`, `answerAgentRun`). `sendMessage` creates no run row, so it has neither the run's status check nor the head the run was accepted
// at, which the note compares (agent-runs.ts, conversations.ts): tests that only used it missed the question BK could see and not answer. A scripted
// model behind the real SDK; nothing reaches a network.
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { transcriptPrompt } from "../../src/agent/codex/prompt.ts";
import { type AgentModel, emptyUsage } from "../../src/agent/model.ts";
import { ConversationDetailSchema } from "../../src/api/http.ts";
import { type AgentRunSnapshot, answerAgentRun, cancelAgentRun, drainAgentRuns, inspectAgentRun, startAgentRun, waitForAgentRun } from "../../src/app/agent-runs.ts";
import { type App, applyChange, applyOps, getLayout, importLayout, rejectChange, showConversation, undo } from "../../src/app/index.ts";
import { SKIPPED_ANSWER } from "../../src/app/question-skip.ts";
import { listMessages } from "../../src/persistence/conversations.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { F16_POSITION, TAB_POSITION, commandShiftApp } from "../helpers/command-shift.ts";
import { type ScriptStep, type SeenRequest, fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { draft, setKey } from "../helpers/ops.ts";
import { CLOSE_FOLLOWUP, QUICK_REQUEST, closeScript, lastSaved } from "../helpers/refine-journey.ts";
import { fromConversation, questionClosed, questionOpen, questionSkipped, type AssistantTurn } from "../../src/web/chat/transcript.ts";

const ops = (code: string) => [{ op: "dropFunction", function: "key:F16", reason: "you said so" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "key", code } }];
const proposal = (title: string, code: string) => ({ title, ops: ops(code), explanation: `${title}.`, tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() });
const ask = (text = "Backspace was placed on purpose. Does that still hold?") => ({ tool: "ask_user", input: { question: text, considerations: ["It matters."], step: { n: 1, of: 1 }, options: [{ label: "Yes" }, { label: "No" }] } });
const CLOSED = (title: string) => `BK applied another proposal ("${title}") without answering.`;

let sequence = 0;
/** One turn through the durable API, finished: a message, or an answer to the open question. */
async function turn(world: { app: App; layoutId: string }, model: AgentModel, input: { message?: string; answer?: { toolUseId: string; text: string }; conversationId?: string }) {
  const started = await startAgentRun(world.app, { version: 1, requestId: `req_${++sequence}`, layoutRef: world.layoutId, input }, { model });
  return waitForAgentRun(world.app, started.id);
}
const questionsOf = (app: App, conversationId: string) => showConversation(app, conversationId).messages.flatMap((m) => (m.question === undefined ? [] : [m.question]));
const proposalsOf = (app: App, conversationId: string) => showConversation(app, conversationId).proposals;
/** The tool results in the last message a request carried to the model: what it was told about the questions. */
const resultsIn = (seen: SeenRequest | undefined): Array<{ content: string }> => (seen?.body.messages.at(-1)?.content ?? []).filter((b: { type: string }) => b.type === "tool_result");

describe("applying a proposal while a question waits, through the durable runs", () => {
  test("a proposal that is not the one the question refines closes it: the card, the run and the conversation all move on", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("Option", "F17") }] },
      { blocks: [{ text: "Here it is." }] },
      // Turn 2: a remembered-decision question comes before any proposal, so it refines none.
      { blocks: [ask()] },
      { blocks: [{ text: "Understood." }] },
    ]);
    const model = anthropicModel(client);
    try {
      const first = await turn(world, model, { message: "put F17 on F16" });
      const [p1] = proposalsOf(world.app, first.conversationId);
      const second = await turn(world, model, { conversationId: first.conversationId, message: "and move Backspace" });
      const [open] = questionsOf(world.app, first.conversationId);
      expect(second.status).toBe("waiting_user");
      expect(open).toMatchObject({ answer: null });
      expect(open?.refines).toBeUndefined();

      applyChange(world.app, p1?.changeSetId ?? "");

      // The card reads Closed (not Skipped, not open), and no answer is pending.
      const [closed] = questionsOf(world.app, first.conversationId);
      expect(closed).toMatchObject({ closed: true, answer: expect.stringContaining(CLOSED("Option")) });
      expect(closed?.skipped).toBeUndefined();
      expect(inspectAgentRun(world.app, second.id)).toMatchObject({ status: "completed", presentation: { status: "completed" } });
      // Both answer paths still refuse it, and say so about a question that is gone: the run no longer waits and the question is no longer open.
      await expect(answerAgentRun(world.app, second.id, "late-answer", { toolUseId: open?.toolUseId ?? "", text: "Yes" }, { model })).rejects.toThrow(/no longer current/);
      await expect(turn(world, model, { conversationId: first.conversationId, answer: { toolUseId: open?.toolUseId ?? "", text: "Yes" } })).rejects.toThrow(/not open any more/);

      // A new message works, and the model reads that the question was closed, in one tool result the API will accept.
      const third = await turn(world, model, { conversationId: first.conversationId, message: "thanks" });
      expect(third.status).toBe("completed");
      const results = resultsIn(requests.at(-1));
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toContain("The layout has changed since you asked, so this question is closed; ask again if it still matters.");
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("the proposal the question refines skips it: Skipped, the run completed, and a message works", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("Option", "F17") }] },
      // The question comes in a reply of its own, after the proposal it refines was saved.
      { blocks: [ask("Should the Option stay on F16's key?")] },
      { blocks: [{ text: "Understood." }] },
    ]);
    const model = anthropicModel(client);
    try {
      const first = await turn(world, model, { message: "put F17 on F16" });
      const [p1] = proposalsOf(world.app, first.conversationId);
      const [open] = questionsOf(world.app, first.conversationId);
      expect(first.status).toBe("waiting_user");
      expect(open).toMatchObject({ answer: null, refines: p1?.changeSetId });

      applyChange(world.app, p1?.changeSetId ?? "");

      const [skipped] = questionsOf(world.app, first.conversationId);
      expect(skipped).toMatchObject({ skipped: true, answer: SKIPPED_ANSWER });
      expect(skipped?.closed).toBeUndefined();
      expect(inspectAgentRun(world.app, first.id)).toMatchObject({ status: "completed", presentation: { status: "completed" } });
      await expect(answerAgentRun(world.app, first.id, "late-answer", { toolUseId: open?.toolUseId ?? "", text: "Yes" }, { model })).rejects.toThrow(/no longer current/);
      const next = await turn(world, model, { conversationId: first.conversationId, message: "thanks" });
      expect(next.status).toBe("completed");
      const results = resultsIn(requests.at(-1));
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe(SKIPPED_ANSWER);
    } finally {
      await drainAgentRuns(world.app);
    }
  });
});

describe("the ended question as the browser receives it", () => {
  // The API schema strips keys it does not know, so a flag the server sets that the schema lacks would reach the card as plain text.
  const askedTurn = (app: App, conversationId: string): AssistantTurn => {
    const found = fromConversation(ConversationDetailSchema.parse(showConversation(app, conversationId))).turns
      .filter((t): t is AssistantTurn => t.kind === "assistant").find((t) => t.question !== null);
    if (found === undefined) throw new Error("no reply carries a question");
    return found;
  };

  test("Closed and Skipped survive the wire, and neither leaves the question open", async () => {
    for (const apply of ["other", "refined"] as const) {
      const world = await commandShiftApp();
      const { client } = fakeAnthropic([
        { blocks: [{ tool: "propose_changes", input: proposal("Option", "F17") }] },
        { blocks: [apply === "refined" ? ask("Should the Option stay?") : { text: "Here it is." }] },
        // For "other": turn 2 asks a question that refines nothing.
        ...(apply === "other" ? [{ blocks: [ask()] }] : []),
        { blocks: [{ text: "Understood." }] },
      ]);
      const model = anthropicModel(client);
      try {
        const first = await turn(world, model, { message: "put F17 on F16" });
        if (apply === "other") await turn(world, model, { conversationId: first.conversationId, message: "and move Backspace" });
        expect(questionOpen(askedTurn(world.app, first.conversationId))).toBe(true);
        applyChange(world.app, proposalsOf(world.app, first.conversationId)[0]?.changeSetId ?? "");
        const ended = askedTurn(world.app, first.conversationId);
        expect(questionOpen(ended)).toBe(false);
        expect(questionClosed(ended)).toBe(apply === "other");
        expect(questionSkipped(ended)).toBe(apply === "refined");
      } finally {
        await drainAgentRuns(world.app);
      }
    }
  });
});

// The turn may do 64 things (observation.ts): the 65th is refused with an error result and not run, and the turn is marked limited. A valid question
// still ends the turn waiting for BK. Any other ending left the question open on a failed run, which no answer path accepts ("no longer current")
// though the layout never changed. The calls beside the question are run by the Anthropic and OpenRouter adapter after it pauses.
describe("a call beside the question, or an earlier one, reaches the turn's activity limit", () => {
  const listAll = { tool: "list_layouts", input: {} };
  /** The turn's whole budget: 64 successful calls over eight replies. */
  const spent: ScriptStep[] = Array.from({ length: 8 }, () => ({ blocks: Array.from({ length: 8 }, () => listAll) }));
  const toolResults = (app: App, conversationId: string) => listMessages(app.db, conversationId).flatMap((m) => m.content).flatMap((b) => (b.type === "tool_result" ? [b] : []));

  for (const provider of ["anthropic", "openrouter"] as const) {
    test(`a call batched after the question is refused, the run waits, and the answer resumes it (${provider})`, async () => {
      const world = await commandShiftApp();
      const { client, requests } = fakeAnthropic([...spent, { blocks: [ask("Which hand is free?"), listAll] }, { blocks: [{ text: "Left it is." }] }]);
      const model = anthropicModel(client, { provider });
      try {
        const paused = await turn(world, model, { message: "go" });
        // The run waits, not failed, and the question is open.
        expect(paused).toMatchObject({ status: "waiting_user", presentation: { status: "waiting_user" } });
        const [open] = questionsOf(world.app, paused.conversationId);
        expect(open).toMatchObject({ answer: null, question: "Which hand is free?" });
        // The refused call has its one result, an error that says why; the 64 before it ran.
        const refused = toolResults(world.app, paused.conversationId).filter((b) => b.is_error === true);
        expect(refused).toHaveLength(1);
        expect(refused[0]?.content).toMatch(/activity limit/);
        // The answer is accepted and resumes the turn.
        const answering = await answerAgentRun(world.app, paused.id, "answer-limit", { toolUseId: open?.toolUseId ?? "", text: "Left" }, { model });
        expect((await waitForAgentRun(world.app, answering.id)).status).toBe("completed");
        expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ answer: "Left" });
        // The model was told both: the call it made beside the question was not run, and BK's answer.
        expect(resultsIn(requests.at(-1)).map((r) => r.content)).toEqual([expect.stringMatching(/activity limit/), "Left"]);
      } finally {
        await drainAgentRuns(world.app);
      }
    });
  }

  test("the limit reached in an earlier reply, then a question on its own, ends the same way", async () => {
    const world = await commandShiftApp();
    // Reply 9 is the 65th call, refused; the model reads that and asks.
    const { client } = fakeAnthropic([...spent, { blocks: [listAll] }, { blocks: [ask("Which hand is free?")] }, { blocks: [{ text: "Left it is." }] }]);
    const model = anthropicModel(client);
    try {
      const paused = await turn(world, model, { message: "go" });
      expect(paused).toMatchObject({ status: "waiting_user", presentation: { status: "waiting_user" } });
      const [open] = questionsOf(world.app, paused.conversationId);
      expect(open).toMatchObject({ answer: null });
      const answering = await answerAgentRun(world.app, paused.id, "answer-earlier", { toolUseId: open?.toolUseId ?? "", text: "Left" }, { model });
      expect((await waitForAgentRun(world.app, answering.id)).status).toBe("completed");
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("a call batched after the question that throws gets an error result, and the run waits", async () => {
    const world = await commandShiftApp();
    const { client } = fakeAnthropic([{ blocks: [ask("Which hand is free?"), { tool: "get_layout", input: { layout: "no-such-layout" } }] }, { blocks: [{ text: "Left it is." }] }]);
    const model = anthropicModel(client);
    try {
      const paused = await turn(world, model, { message: "go" });
      expect(paused).toMatchObject({ status: "waiting_user", presentation: { status: "waiting_user" } });
      const failed = toolResults(world.app, paused.conversationId).filter((b) => b.is_error === true);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.content).toContain("no-such-layout");
      const [open] = questionsOf(world.app, paused.conversationId);
      const answering = await answerAgentRun(world.app, paused.id, "answer-throws", { toolUseId: open?.toolUseId ?? "", text: "Left" }, { model });
      expect((await waitForAgentRun(world.app, answering.id)).status).toBe("completed");
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("Stop while the calls beside the question run: they are not run, the question is stored, and it can still be answered", async () => {
    const world = await commandShiftApp();
    const { client } = fakeAnthropic([{ blocks: [ask("Which hand is free?"), listAll, { tool: "propose_changes", input: proposal("Option", "F17") }] }, { blocks: [{ text: "Left it is." }] }]);
    const base = anthropicModel(client);
    // Stop is pressed as the first call beside the question starts.
    const model: AgentModel = { ...base, run: (request) => base.run({ ...request, tools: request.tools.map((tool) => tool.name !== "list_layouts" ? tool : { ...tool, run: (raw) => { cancelAgentRun(world.app, "stop-beside"); return tool.run(raw); } }) }) };
    try {
      const started = await startAgentRun(world.app, { version: 1, requestId: "stop-beside", layoutRef: world.layoutId, input: { message: "go" } }, { model });
      const paused = await waitForAgentRun(world.app, started.id);
      expect(paused).toMatchObject({ status: "waiting_user", cancelRequested: true, presentation: { status: "waiting_user" } });
      // Neither call ran: each has an error result, and the proposal was never saved.
      const stopped = toolResults(world.app, paused.conversationId).filter((b) => b.is_error === true);
      expect(stopped).toHaveLength(2);
      expect(proposalsOf(world.app, paused.conversationId)).toEqual([]);
      const [open] = questionsOf(world.app, paused.conversationId);
      expect(open).toMatchObject({ answer: null });
      const answering = await answerAgentRun(world.app, paused.id, "answer-stop", { toolUseId: open?.toolUseId ?? "", text: "Left" }, { model: anthropicModel(fakeAnthropic([{ blocks: [{ text: "Left it is." }] }]).client) });
      expect((await waitForAgentRun(world.app, answering.id)).status).toBe("completed");
    } finally {
      await drainAgentRuns(world.app);
    }
  });
});

describe("the demo scenario for the Closed card", () => {
  // scripts/dev-command-shift.ts plays this for the screenshot; the test keeps the script honest.
  test("a proposal, then a question that refines none, and applying the proposal closes it", async () => {
    const world = await commandShiftApp();
    const model = anthropicModel(fakeAnthropic(closeScript()).client);
    try {
      const first = await turn(world, model, { message: QUICK_REQUEST });
      const second = await turn(world, model, { conversationId: first.conversationId, message: CLOSE_FOLLOWUP });
      expect(second.status).toBe("waiting_user");
      expect(questionsOf(world.app, first.conversationId)[0]).toMatchObject({ answer: null, question: "Backspace was placed on purpose. Does that still hold?" });
      applyChange(world.app, proposalsOf(world.app, first.conversationId)[0]?.changeSetId ?? "");
      expect(questionsOf(world.app, first.conversationId)[0]).toMatchObject({ closed: true });
    } finally {
      await drainAgentRuns(world.app);
    }
  });
});

describe("an apply that lands while the turn is still running, before its question is stored", () => {
  test("another proposal of the conversation closes the question when the turn commits, and the run never waits", async () => {
    const world = await commandShiftApp();
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("Option", "F17") }] },
      { blocks: [{ text: "Here it is." }] },
      // Turn 2: BK applies the open proposal now, before the model asks a question that refines nothing.
      (seen) => {
        applyChange(world.app, lastSaved(seen));
        return { blocks: [ask()] };
      },
      { blocks: [{ text: "Understood." }] },
    ]);
    const model = anthropicModel(client);
    try {
      const first = await turn(world, model, { message: "put F17 on F16" });
      const second = await turn(world, model, { conversationId: first.conversationId, message: "and move Backspace" });
      // Nothing waits: the question was stored with its result, the run and the card agree, and a message goes through.
      expect(second.status).toBe("completed");
      expect(second.presentation?.status).toBe("completed");
      expect(questionsOf(world.app, first.conversationId)[0]).toMatchObject({ closed: true, answer: expect.stringContaining(CLOSED("Option")) });
      const third = await turn(world, model, { conversationId: first.conversationId, message: "thanks" });
      expect(third.status).toBe("completed");
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("the proposal the question refines, applied in the same window, skips it at commit", async () => {
    const world = await commandShiftApp();
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("One", "F17") }] },
      // BK applies the proposal now, before the model has asked its question.
      (seen) => {
        applyChange(world.app, lastSaved(seen));
        return { blocks: [ask("Should it stay?")] };
      },
      { blocks: [{ text: "Fine, it is applied." }] },
    ]);
    const model = anthropicModel(client);
    try {
      const first = await turn(world, model, { message: "go" });
      expect(first.status).toBe("completed");
      expect(first.presentation?.status).toBe("completed");
      expect(questionsOf(world.app, first.conversationId)[0]).toMatchObject({ skipped: true, answer: SKIPPED_ANSWER, refines: proposalsOf(world.app, first.conversationId)[0]?.changeSetId });
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("a proposal BK only rejects in that window is not an apply: the head did not move, so the question waits and can be answered", async () => {
    const world = await commandShiftApp();
    const { client } = fakeAnthropic([
      { blocks: [{ tool: "propose_changes", input: proposal("One", "F17") }] },
      (seen) => {
        rejectChange(world.app, lastSaved(seen));
        return { blocks: [ask("Should it stay?")] };
      },
      { blocks: [{ text: "Understood." }] },
    ]);
    const model = anthropicModel(client);
    try {
      const first = await turn(world, model, { message: "go" });
      expect(first.status).toBe("waiting_user");
      const [open] = questionsOf(world.app, first.conversationId);
      expect(open).toMatchObject({ answer: null });
      expect(open?.skipped).toBeUndefined();
      // The model is not told BK applied something he did not.
      expect(JSON.stringify(showConversation(world.app, first.conversationId).messages)).not.toContain("BK applied");
      const answered = await turn(world, model, { conversationId: first.conversationId, answer: { toolUseId: open?.toolUseId ?? "", text: "Yes" } });
      expect(answered.status).toBe("completed");
    } finally {
      await drainAgentRuns(world.app);
    }
  });
});

describe("the other ways a question ends", () => {
  const synthetic = (run: AgentModel["run"]): AgentModel => ({ provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null, run });
  const question = { question: "Which?", considerations: ["It matters."], step: { n: 1, of: 1 }, options: [{ label: "A" }, { label: "B" }] };
  const pausing = (id: string) => ({
    messages: [{ role: "assistant" as const, content: [{ type: "tool_use" as const, id, name: "ask_user", input: question }] }],
    stopReason: "awaiting_answer", pending: { id, name: "ask_user", input: question }, iterations: 1, usage: emptyUsage(),
  });

  test("BK answers: the answer is the result, the paused run completes, and the next run starts", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([{ blocks: [ask()] }, { blocks: [{ text: "Kept." }] }]);
    const model = anthropicModel(client);
    try {
      const first = await turn(world, model, { message: "go" });
      const [open] = questionsOf(world.app, first.conversationId);
      expect(first.status).toBe("waiting_user");
      const answered = await turn(world, model, { conversationId: first.conversationId, answer: { toolUseId: open?.toolUseId ?? "", text: "Yes" } });
      expect(answered.status).toBe("completed");
      expect(inspectAgentRun(world.app, first.id).status).toBe("completed");
      expect(questionsOf(world.app, first.conversationId)[0]).toMatchObject({ answer: "Yes" });
      expect(resultsIn(requests.at(-1)).map((b) => b.content)).toEqual(["Yes"]);
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("BK types a message instead: it answers the question, and a reload keeps saying so", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([{ blocks: [ask()] }, { blocks: [{ text: "Ok." }] }]);
    const model = anthropicModel(client);
    try {
      const first = await turn(world, model, { message: "go" });
      const typed = await turn(world, model, { conversationId: first.conversationId, message: "never mind, something else" });
      expect(typed.status).toBe("completed");
      expect(inspectAgentRun(world.app, first.id).status).toBe("completed");
      const [ended] = questionsOf(world.app, first.conversationId);
      expect(ended?.answer).toBe("BK did not pick an option; he wrote his own message instead.");
      expect(ended?.skipped).toBeUndefined();
      expect(ended?.closed).toBeUndefined();
      expect(resultsIn(requests.at(-1))).toHaveLength(1);
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("Stop before the question is reached ends the run with no question", async () => {
    const world = await commandShiftApp();
    const hanging = synthetic(async (request) => {
      await new Promise<void>((_resolve, reject) => { request.signal?.addEventListener("abort", () => reject(new Error("stopped")), { once: true }); });
      return { messages: [], stopReason: "end_turn", iterations: 1, usage: emptyUsage() };
    });
    try {
      const started = await startAgentRun(world.app, { version: 1, requestId: "stop-early", layoutRef: world.layoutId, input: { message: "go" } }, { model: hanging });
      cancelAgentRun(world.app, started.id);
      const done = await waitForAgentRun(world.app, started.id);
      expect(done).toMatchObject({ status: "cancelled", presentation: { status: "cancelled" } });
      expect(questionsOf(world.app, done.conversationId)).toEqual([]);
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("Stop as the question arrives: the question is stored and open, and it can still be answered", async () => {
    const world = await commandShiftApp();
    const model = synthetic(async () => {
      cancelAgentRun(world.app, "stop-late");
      return pausing("late-question");
    });
    const after = fakeAnthropic([{ blocks: [{ text: "Ok." }] }]);
    try {
      const started = await startAgentRun(world.app, { version: 1, requestId: "stop-late", layoutRef: world.layoutId, input: { message: "go" } }, { model });
      const paused = await waitForAgentRun(world.app, started.id);
      expect(paused).toMatchObject({ status: "waiting_user", cancelRequested: true, presentation: { status: "waiting_user" } });
      expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ toolUseId: "late-question", answer: null });
      const answered = await turn(world, anthropicModel(after.client), { conversationId: paused.conversationId, answer: { toolUseId: "late-question", text: "A" } });
      expect(answered.status).toBe("completed");
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("a turn that fails leaves no question and a failed run", async () => {
    const world = await commandShiftApp();
    try {
      const failed = await turn(world, synthetic(async () => { throw new Error("the provider fell over"); }), { message: "go" });
      expect(failed).toMatchObject({ status: "failed", presentation: { status: "failed" } });
      expect(questionsOf(world.app, failed.conversationId)).toEqual([]);
    } finally {
      await drainAgentRuns(world.app);
    }
  });
});

// A question can wait while the layout head moves by any means (an editor edit, an undo, an apply in another conversation, a change made while the
// turn was still working). The answer is taken, and the model reads a note first, because what it read of the layout before is out of date. The
// validator still decides every revision against the head (D-014): the answer changes what the model is told, not what can be applied (D-458).
describe("a question answered after the layout head moved", () => {
  const note = (revisions: string, words: string) => `The layout changed after your last reply began${revisions}. Read it again with get_layout before you revise anything. BK's answer:\n\n${words}`;
  /** BK puts `code` on a key in the editor: the head moves with a revision that is not an agent proposal. */
  const edit = (world: { app: App; layoutId: string }, summary: string, code = "F5", position = F16_POSITION) =>
    applyOps(world.app, world.layoutId, { baseRevisionId: getLayout(world.app, world.layoutId).revision.id, ops: setKey(position, code), summary });
  /** The answer by either route: the run's own answer route (`keyloom agent answer`), or an answer sent to the conversation (the browser). */
  const answerBy = (route: "run" | "conversation", world: { app: App; layoutId: string }, model: AgentModel, paused: AgentRunSnapshot, answer: { toolUseId: string; text: string }, requestId: string) =>
    route === "run"
      ? answerAgentRun(world.app, paused.id, requestId, answer, { model })
      : startAgentRun(world.app, { version: 1, requestId, layoutRef: world.layoutId, input: { conversationId: paused.conversationId, answer } }, { model });
  const storedResults = (app: App, conversationId: string) => listMessages(app.db, conversationId).flatMap((m) => m.content).filter((b) => b.type === "tool_result");

  for (const route of ["run", "conversation"] as const) {
    test(`an editor edit: the answer is taken by the ${route}'s route, the run resumes, and the model reads the note, the answer and the layout as it is now`, async () => {
      const world = await commandShiftApp();
      const { client, requests } = fakeAnthropic([
        { blocks: [ask("Which hand is free?")] },
        // The resumed turn does what the note asks: it reads the layout again.
        { blocks: [{ tool: "get_layout", input: {} }] },
        { blocks: [{ text: "Left it is." }] },
        { blocks: [{ text: "Fine." }] },
      ]);
      const model = anthropicModel(client);
      try {
        const paused = await turn(world, model, { message: "put F5 on F16" });
        const [open] = questionsOf(world.app, paused.conversationId);
        expect(paused.status).toBe("waiting_user");
        const moved = edit(world, "Put F5 on F16");
        // Nothing marks the question stale: the card still offers its options and the run still waits.
        expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ answer: null });
        expect(inspectAgentRun(world.app, paused.id).status).toBe("waiting_user");

        const answer = { toolUseId: open?.toolUseId ?? "", text: "Left" };
        const answered = await answerBy(route, world, model, paused, answer, "answer-moved");
        expect((await waitForAgentRun(world.app, answered.id)).status).toBe("completed");
        expect(inspectAgentRun(world.app, paused.id).status).toBe("completed");
        // The next request carries the note and the answer, as the one result the question is owed.
        expect(requests[1]?.toolResults).toEqual([note(' (1 revision: "Put F5 on F16")', "Left")]);
        // The resumed turn reads the head as it is now, not a snapshot of the one it paused on.
        expect(requests[2]?.toolResults.join("\n")).toContain(`head revision ${moved.revisionId}`);
        // The card shows BK's words, not the note.
        expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ answer: "Left" });
        expect(questionsOf(world.app, paused.conversationId)[0]?.closed).toBeUndefined();

        // The same answer identity returns the same continuation and runs nothing again.
        const calls = requests.length;
        expect((await answerBy(route, world, model, paused, answer, "answer-moved")).id).toBe(answered.id);
        expect(requests).toHaveLength(calls);
        // The note stays in the stored result, so a later message replays the history the model last read.
        await turn(world, model, { conversationId: paused.conversationId, message: "thanks" });
        const replayed = (requests.at(-1)?.body.messages ?? []).flatMap((m: { content: unknown }) => (Array.isArray(m.content) ? m.content : []))
          .filter((b: { type: string }) => b.type === "tool_result").map((b: { content: unknown }) => b.content);
        expect(replayed).toContain(note(' (1 revision: "Put F5 on F16")', "Left"));
      } finally {
        await drainAgentRuns(world.app);
      }
    });
  }

  test("an undo: the answer is taken, and the note names the undo", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([{ blocks: [ask("Which hand is free?")] }, { blocks: [{ text: "Left it is." }] }]);
    const model = anthropicModel(client);
    try {
      edit(world, "Put F5 on F16");
      const paused = await turn(world, model, { message: "go" });
      const [open] = questionsOf(world.app, paused.conversationId);
      undo(world.app, world.layoutId);
      expect(inspectAgentRun(world.app, paused.id).status).toBe("waiting_user");

      const answered = await answerAgentRun(world.app, paused.id, "answer-undone", { toolUseId: open?.toolUseId ?? "", text: "Left" }, { model });
      expect((await waitForAgentRun(world.app, answered.id)).status).toBe("completed");
      expect(requests[1]?.toolResults).toEqual([note(' (1 revision: "Undo: Put F5 on F16")', "Left")]);
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("a proposal of another conversation applied: the answer is taken, and the note names that change", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([
      { blocks: [ask("Which hand is free?")] },
      // Another conversation on the same layout proposes something, and BK applies it.
      { blocks: [{ tool: "propose_changes", input: proposal("Option on F17", "F17") }] },
      { blocks: [{ text: "Here it is." }] },
      { blocks: [{ text: "Left it is." }] },
    ]);
    const model = anthropicModel(client);
    try {
      const paused = await turn(world, model, { message: "go" });
      const [open] = questionsOf(world.app, paused.conversationId);
      const other = await turn(world, model, { message: "put F17 on F16" });
      expect(other.conversationId).not.toBe(paused.conversationId);
      applyChange(world.app, proposalsOf(world.app, other.conversationId)[0]?.changeSetId ?? "");
      // The other conversation's apply ends its own questions only; this one still waits.
      expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ answer: null });
      expect(inspectAgentRun(world.app, paused.id).status).toBe("waiting_user");

      const answered = await answerAgentRun(world.app, paused.id, "answer-elsewhere", { toolUseId: open?.toolUseId ?? "", text: "Left" }, { model });
      expect((await waitForAgentRun(world.app, answered.id)).status).toBe("completed");
      expect(requests.at(-1)?.toolResults).toEqual([note(' (1 revision: "Option on F17.")', "Left")]);
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("a change made while the turn was still working counts too: the question was stranded from the start", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([
      (_seen) => {
        edit(world, "Put F5 on F16 while the turn ran");
        return { blocks: [ask("Which hand is free?")] };
      },
      { blocks: [{ text: "Left it is." }] },
    ]);
    const model = anthropicModel(client);
    try {
      const paused = await turn(world, model, { message: "go" });
      expect(paused.status).toBe("waiting_user");
      const [open] = questionsOf(world.app, paused.conversationId);
      const answered = await answerAgentRun(world.app, paused.id, "answer-midturn", { toolUseId: open?.toolUseId ?? "", text: "Left" }, { model });
      expect((await waitForAgentRun(world.app, answered.id)).status).toBe("completed");
      expect(requests[1]?.toolResults).toEqual([note(' (1 revision: "Put F5 on F16 while the turn ran")', "Left")]);
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("several revisions are counted and the latest is named; a starting point the layout never had still says it changed", async () => {
    for (const unknownStart of [false, true]) {
      const world = await commandShiftApp();
      const { client, requests } = fakeAnthropic([{ blocks: [ask("Which hand is free?")] }, { blocks: [{ text: "Left it is." }] }]);
      const model = anthropicModel(client);
      try {
        const paused = await turn(world, model, { message: "go" });
        const [open] = questionsOf(world.app, paused.conversationId);
        edit(world, "Put F5 on F16");
        edit(world, "Put F18 on F16", "F18");
        if (unknownStart) world.app.db.query("UPDATE agent_runs SET revision_id = 'rev_unknown' WHERE id = ?").run(paused.id);
        const answered = await answerAgentRun(world.app, paused.id, "answer-many", { toolUseId: open?.toolUseId ?? "", text: "Left" }, { model });
        expect((await waitForAgentRun(world.app, answered.id)).status).toBe("completed");
        expect(requests[1]?.toolResults).toEqual([note(unknownStart ? "" : ' (2 revisions, the latest "Put F18 on F16")', "Left")]);
        expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ answer: "Left" });
      } finally {
        await drainAgentRuns(world.app);
      }
    }
  });

  test("a long or multi-line summary stays one short line, so the card still finds BK's words", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([{ blocks: [ask("Which hand is free?")] }, { blocks: [{ text: "Left it is." }] }]);
    const model = anthropicModel(client);
    try {
      const paused = await turn(world, model, { message: "go" });
      const [open] = questionsOf(world.app, paused.conversationId);
      edit(world, `Put F5 on F16\n\nso the thumb stays free ${"x".repeat(150)}`);
      const answered = await answerAgentRun(world.app, paused.id, "answer-long", { toolUseId: open?.toolUseId ?? "", text: "Left" }, { model });
      expect((await waitForAgentRun(world.app, answered.id)).status).toBe("completed");
      // Whitespace is one space, and the summary is cut at 99 characters and an ellipsis.
      expect(requests[1]?.toolResults).toEqual([note(` (1 revision: "${"Put F5 on F16 so the thumb stays free ".padEnd(99, "x")}…")`, "Left")]);
      expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ answer: "Left" });
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("an answer given when the head did not move carries no note", async () => {
    const world = await commandShiftApp();
    const { client, requests } = fakeAnthropic([{ blocks: [ask("Which hand is free?")] }, { blocks: [{ text: "Left it is." }] }]);
    const model = anthropicModel(client);
    try {
      const paused = await turn(world, model, { message: "go" });
      const [open] = questionsOf(world.app, paused.conversationId);
      const answered = await answerAgentRun(world.app, paused.id, "answer-still", { toolUseId: open?.toolUseId ?? "", text: "Left" }, { model });
      expect((await waitForAgentRun(world.app, answered.id)).status).toBe("completed");
      expect(requests[1]?.toolResults).toEqual(["Left"]);
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("the other checks still refuse once the head moved: another question, another layout's conversation, a run that no longer waits", async () => {
    const world = await commandShiftApp();
    const elsewhere = await importLayout(world.app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "elsewhere" });
    const { client, requests } = fakeAnthropic([{ blocks: [ask("Which hand is free?")] }, { blocks: [{ text: "Ok." }] }]);
    const model = anthropicModel(client);
    try {
      const paused = await turn(world, model, { message: "go" });
      const [open] = questionsOf(world.app, paused.conversationId);
      const toolUseId = open?.toolUseId ?? "";
      edit(world, "Put F5 on F16");

      // A question that is not the open one.
      await expect(answerAgentRun(world.app, paused.id, "wrong-question", { toolUseId: "not-the-question", text: "Left" }, { model })).rejects.toThrow(/not open any more/);
      await expect(turn(world, model, { conversationId: paused.conversationId, answer: { toolUseId: "not-the-question", text: "Left" } })).rejects.toThrow(/not open any more/);
      // A conversation of another layout.
      await expect(startAgentRun(world.app, { version: 1, requestId: "other-layout", layoutRef: elsewhere.layoutId, input: { conversationId: paused.conversationId, answer: { toolUseId, text: "Left" } } }, { model }))
        .rejects.toThrow(/belongs to another layout/);
      // Nothing was stored by any of them: the question is open and the run waits.
      expect(storedResults(world.app, paused.conversationId)).toEqual([]);
      expect(inspectAgentRun(world.app, paused.id).status).toBe("waiting_user");
      expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ answer: null });

      // BK types a message instead: it answers the question in his own words, with no note, and the paused run is over.
      await turn(world, model, { conversationId: paused.conversationId, message: "never mind, something else" });
      expect(inspectAgentRun(world.app, paused.id).status).toBe("completed");
      expect(requests.at(-1)?.toolResults).toEqual(["BK did not pick an option; he wrote his own message instead."]);
      // A run that no longer waits refuses an answer, as the head moves again.
      edit(world, "Put F18 on F16", "F18");
      await expect(answerAgentRun(world.app, paused.id, "late", { toolUseId, text: "Left" }, { model })).rejects.toThrow("that question is no longer current");
    } finally {
      await drainAgentRuns(world.app);
    }
  });

  test("applying the conversation's own proposals after an editor edit still ends the question: Skipped for the one it refines, Closed for another", async () => {
    for (const apply of ["refined", "other"] as const) {
      const world = await commandShiftApp();
      const { client, requests } = fakeAnthropic([
        { blocks: [{ tool: "propose_changes", input: proposal("Option", "F17") }] },
        { blocks: [apply === "refined" ? ask("Should the Option stay?") : { text: "Here it is." }] },
        ...(apply === "other" ? [{ blocks: [ask()] }] : []),
        { blocks: [{ text: "Understood." }] },
      ]);
      const model = anthropicModel(client);
      try {
        const first = await turn(world, model, { message: "put F17 on F16" });
        const paused = apply === "other" ? await turn(world, model, { conversationId: first.conversationId, message: "and move Backspace" }) : first;
        const [open] = questionsOf(world.app, first.conversationId);
        expect(paused.status).toBe("waiting_user");
        // The editor edit comes first, on a key the proposal does not touch, and moves the head.
        edit(world, "Put F5 on Tab", "F5", TAB_POSITION);
        applyChange(world.app, proposalsOf(world.app, first.conversationId)[0]?.changeSetId ?? "");

        const [ended] = questionsOf(world.app, first.conversationId);
        if (apply === "refined") expect(ended).toMatchObject({ skipped: true, answer: SKIPPED_ANSWER });
        else expect(ended).toMatchObject({ closed: true, answer: expect.stringContaining(CLOSED("Option")) });
        expect(inspectAgentRun(world.app, paused.id).status).toBe("completed");
        await expect(answerAgentRun(world.app, paused.id, "late-answer", { toolUseId: open?.toolUseId ?? "", text: "Yes" }, { model })).rejects.toThrow(/no longer current/);
        await expect(turn(world, model, { conversationId: first.conversationId, answer: { toolUseId: open?.toolUseId ?? "", text: "Yes" } })).rejects.toThrow(/not open any more/);
        // The model is told how it ended, in the result's own words and with no note about the layout.
        await turn(world, model, { conversationId: first.conversationId, message: "thanks" });
        const results = resultsIn(requests.at(-1));
        expect(results).toHaveLength(1);
        expect(results[0]?.content).toContain(apply === "refined" ? SKIPPED_ANSWER : CLOSED("Option"));
        expect(results[0]?.content).not.toContain("Read it again with get_layout");
      } finally {
        await drainAgentRuns(world.app);
      }
    }
  });

  // BK's words and the note keyloom puts ahead of them are told apart by how the result is stored, never by its text (D-458).
  test("an answer that starts with the note's own words is shown whole, with the head moved or not", async () => {
    const forged = "The layout changed after your last reply began. Read it again with get_layout before you revise anything. BK's answer:\n\nLeft";
    for (const moved of [false, true]) {
      const world = await commandShiftApp();
      const { client, requests } = fakeAnthropic([{ blocks: [ask("Which hand is free?")] }, { blocks: [{ text: "Left it is." }] }]);
      const model = anthropicModel(client);
      try {
        const paused = await turn(world, model, { message: "go" });
        const [open] = questionsOf(world.app, paused.conversationId);
        if (moved) edit(world, "Put F5 on F16");
        const answered = await answerAgentRun(world.app, paused.id, "answer-forged", { toolUseId: open?.toolUseId ?? "", text: forged }, { model });
        expect((await waitForAgentRun(world.app, answered.id)).status).toBe("completed");
        // The card shows every character he gave. The model reads them after the real note, when the head moved, and as they are when it did not.
        expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ answer: forged });
        expect(requests[1]?.toolResults).toEqual([moved ? note(' (1 revision: "Put F5 on F16")', forged) : forged]);
      } finally {
        await drainAgentRuns(world.app);
      }
    }
  });

  // Anthropic and OpenRouter share an adapter that sends a stored result as it is: no clip, and none of keyloom's own record on the wire.
  for (const provider of ["anthropic", "openrouter"] as const) {
    test(`a long answer after the head moved reaches the model whole, as a plain result with nothing of keyloom's record on it (${provider})`, async () => {
      const world = await commandShiftApp();
      const { client, requests } = fakeAnthropic([{ blocks: [ask("Which hand is free?")] }, { blocks: [{ text: "Left it is." }] }]);
      const model = anthropicModel(client, { provider });
      const long = `${"I keep my left hand on the home row. ".repeat(90)}So keep Backspace on the left.`;
      try {
        const paused = await turn(world, model, { message: "go" });
        const [open] = questionsOf(world.app, paused.conversationId);
        edit(world, "Put F5 on F16");
        const answered = await answerAgentRun(world.app, paused.id, "answer-long", { toolUseId: open?.toolUseId ?? "", text: long }, { model });
        expect((await waitForAgentRun(world.app, answered.id)).status).toBe("completed");
        expect(long.length).toBeGreaterThan(3_000);
        // The block the API gets is exactly a tool result with a string: no `words`, no `providerData`.
        expect(requests[1]?.body.messages.at(-1)?.content).toEqual([{ type: "tool_result", tool_use_id: open?.toolUseId, content: note(' (1 revision: "Put F5 on F16")', long) }]);
        expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ answer: long });
      } finally {
        await drainAgentRuns(world.app);
      }
    });
  }

  // Codex is sent the stored conversation as text and clips each tool result at 2,000 characters, which is fine for one it can fetch again and not for
  // BK's answer. Here the answer is under that limit on its own and the note pushes it over. The Codex formatter is the real one; the model is a stand-in.
  test("an answer given after the head moved reaches Codex whole, while a long tool result it can fetch again is still clipped", async () => {
    const world = await commandShiftApp();
    const question = { question: "Which hand is free?", considerations: ["It matters."], step: { n: 1, of: 1 }, options: [{ label: "Left" }, { label: "Right" }] };
    const prompts: string[] = [];
    const codexLike: AgentModel = {
      provider: "codex", model: "synthetic", effort: "medium", classifyError: () => null,
      run: async (request) => {
        prompts.push(transcriptPrompt(request.messages));
        if (prompts.length > 1) return { messages: [{ role: "assistant", content: [{ type: "text", text: "Left it is." }] }], stopReason: "end_turn", iterations: 1, usage: emptyUsage() };
        return {
          messages: [
            { role: "assistant", content: [{ type: "tool_use", id: "read-1", name: "get_layout", input: {} }] },
            { role: "user", content: [{ type: "tool_result", tool_use_id: "read-1", content: "X".repeat(3_000) }] },
            { role: "assistant", content: [{ type: "tool_use", id: "ask-1", name: "ask_user", input: question }] },
          ],
          stopReason: "awaiting_answer", pending: { id: "ask-1", name: "ask_user", input: question }, iterations: 1, usage: emptyUsage(),
        };
      },
    };
    const answer = `${"I keep my left hand on the home row. ".repeat(50)}So keep Backspace on the left.`;
    const received = note(' (1 revision: "Put F5 on F16")', answer);
    // The scenario: under the limit alone, over it with the note.
    expect(answer.length).toBeLessThan(2_000);
    expect(received.length).toBeGreaterThan(2_000);
    try {
      const paused = await turn(world, codexLike, { message: "go" });
      expect(paused.status).toBe("waiting_user");
      edit(world, "Put F5 on F16");
      const answered = await answerAgentRun(world.app, paused.id, "answer-codex", { toolUseId: "ask-1", text: answer }, { model: codexLike });
      expect((await waitForAgentRun(world.app, answered.id)).status).toBe("completed");

      const sent = prompts[1] ?? "";
      expect(sent).toContain(`[result: ${received}]`);
      // What the model can read again is still cut, with the instruction to call the tool again.
      expect(sent).toContain(`[result: ${"X".repeat(2_000)}... (cut; call the tool again for the rest)]`);
      expect(sent).not.toContain("X".repeat(2_001));
      // The card showed all of it all along.
      expect(questionsOf(world.app, paused.conversationId)[0]).toMatchObject({ answer });
    } finally {
      await drainAgentRuns(world.app);
    }
  });
});
