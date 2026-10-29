// Every way a question ends (D-452), through the durable run APIs the app uses (`startAgentRun`, `answerAgentRun`). `sendMessage` creates no run
// row, so it never meets the two guards that refuse an answer once the layout head has moved since the run paused (agent-runs.ts, conversations.ts):
// tests that only used it missed the question BK could see and not answer. A scripted model behind the real SDK; nothing reaches a network.
import { describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { type AgentModel, emptyUsage } from "../../src/agent/model.ts";
import { ConversationDetailSchema } from "../../src/api/http.ts";
import { answerAgentRun, cancelAgentRun, drainAgentRuns, inspectAgentRun, startAgentRun, waitForAgentRun } from "../../src/app/agent-runs.ts";
import { type App, applyChange, rejectChange, showConversation } from "../../src/app/index.ts";
import { SKIPPED_ANSWER } from "../../src/app/question-skip.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";
import { type SeenRequest, fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { draft } from "../helpers/ops.ts";
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
      // Both guards still refuse an answer to it, and now say so about a question that is gone, not one that is open.
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
