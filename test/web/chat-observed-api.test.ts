// The actual backend observation, HTTP schemas, browser transport and pure projection together.
// Only the model's HTTP transport is scripted. No paid models, firmware or real data directory.
import { afterEach, expect, spyOn, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { chatPresentation } from "../../src/app/chat-presentation.ts";
import type { ChatRequest, ObservedChatEvent } from "../../src/api/http.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { handleChatRoute } from "../../src/server/chat-routes.ts";
import { insertConversation, insertMessage } from "../../src/persistence/conversations.ts";
import { fetchConversation, streamObservedChat } from "../../src/web/chat/api-chat.ts";
import { EMPTY, fromConversation, isStreaming, transcriptReducer, type AssistantTurn, type Transcript } from "../../src/web/chat/transcript.ts";
import { fakeAnthropic, type ScriptStep } from "../helpers/fake-anthropic.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

async function browser(script: ScriptStep[]) {
  const { app, layoutId } = await optionOptionApp();
  const fake = fakeAnthropic(script);
  const backend = appChatBackend(app, { model: anthropicModel(fake.client) });
  const requests: Request[] = [];
  const fetchRoute = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input), "http://localhost"), init);
    requests.push(request.clone());
    const response = await handleChatRoute(request, new URL(request.url).pathname, backend, "synthetic");
    if (response === null) throw new Error("Unexpected browser route");
    return response;
  };
  const mock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(fetchRoute, { preconnect: globalThis.fetch.preconnect }));
  restore = () => { mock.mockRestore(); app.db.close(); };
  return { app, layoutId, requests, fake };
}

const assistants = (state: Transcript) => state.turns.filter((turn): turn is AssistantTurn => turn.kind === "assistant");
const visible = (state: Transcript) => assistants(state).map(({ userMessageId, text, presentation, proposals, priorities, question, phase, ending }) => ({ userMessageId, text, presentation, proposals, priorities, question, phase, ending }));
const sent = (state = EMPTY, text = "Inspect", id = "local") => transcriptReducer(state, { type: "sent", userId: `${id}:user`, assistantId: `${id}:reply`, text, selection: null });

async function send(layoutId: string, body: ChatRequest, initial: Transcript) {
  let state = initial;
  const events: ObservedChatEvent[] = [];
  await streamObservedChat("synthetic", layoutId, body, new AbortController().signal, (event) => {
    events.push(event);
    state = transcriptReducer(state, { type: "event", event });
  });
  if (state.conversationId === null) throw new Error("No conversation start");
  const detail = await fetchConversation("synthetic", state.conversationId, new AbortController().signal);
  return { state, events, detail };
}

test("backend note + tool + long final answer agrees live/reloaded without duplicate text or capped final answers", async () => {
  const fullAnswer = "Full public answer. 😀\n".repeat(1000);
  const { layoutId, requests, fake } = await browser([
    { blocks: [{ text: "Checking the available configs." }, { tool: "list_layouts", input: {} }] },
    { blocks: [{ text: fullAnswer }] },
  ]);
  const { state, events, detail } = await send(layoutId, { message: "Inspect" }, sent());
  expect(await requests[0]?.json()).toEqual({ message: "Inspect", presentationVersion: 1 });
  expect(fake.requests).toHaveLength(2);
  expect(assistants(state)).toHaveLength(1);
  const reply = assistants(state)[0];
  expect(reply?.id).toBe("local:reply");
  expect(reply?.userMessageId).toBe(detail.messages[0]?.id);
  expect(reply?.text).toBe(fullAnswer);
  expect(reply?.presentation?.detailsTruncated).toBe(true);
  expect(reply?.presentation?.messages.map((message) => message.kind)).toEqual(["working_note", "answer"]);
  expect(reply?.presentation?.operations.map((operation) => [operation.label, operation.status])).toEqual([["List configs", "succeeded"]]);
  expect(visible(fromConversation(detail))).toEqual(visible(state));
  const terminal = events.findLast((event) => event.type === "presentation");
  if (terminal?.type !== "presentation") throw new Error("No presentation");
  const repeated = transcriptReducer(state, { type: "event", event: terminal });
  expect(visible(repeated)).toEqual(visible(state));
  expect(assistants(repeated)[0]?.text).not.toContain("Checking the available configs");
});

test("answered old waiting snapshot and hidden answer owner survive a later request and reload in the same order", async () => {
  const { layoutId } = await browser([
    { blocks: [{ text: "One choice first." }, { tool: "ask_user", input: { question: "Which?", options: [{ label: "This" }, { label: "That" }], allowOther: true } }] },
    { blocks: [{ text: "Prepared that choice." }] },
    { blocks: [{ text: "Another answer." }] },
  ]);
  const first = await send(layoutId, { message: "Inspect" }, sent());
  const question = assistants(first.state)[0]?.question;
  if (question === null || question === undefined || first.state.conversationId === null) throw new Error("No waiting question");
  expect(visible(fromConversation(first.detail))).toEqual(visible(first.state));
  const answering = transcriptReducer(first.state, { type: "answering", toolUseId: question.toolUseId, text: "This", assistantId: "answer-reply" });
  const second = await send(layoutId, { conversationId: first.state.conversationId, answer: { toolUseId: question.toolUseId, text: "This" } }, answering);
  const starts = second.events.filter((event) => event.type === "start");
  const snapshots = second.events.filter((event) => event.type === "presentation");
  expect(snapshots[0]?.presentation.userMessageId).toBe(assistants(first.state)[0]?.userMessageId);
  expect(snapshots[0]?.presentation.status).toBe("completed");
  expect(snapshots[1]?.presentation.userMessageId).toBe(starts[0]?.messageId);
  expect(second.detail.messages.some((message) => message.id === starts[0]?.messageId)).toBe(false);
  expect(visible(fromConversation(second.detail))).toEqual(visible(second.state));
  expect(assistants(second.state).map((turn) => [turn.text, turn.question?.answer])).toEqual([["", "This"], ["Prepared that choice.", undefined]]);

  const third = await send(layoutId, { conversationId: first.state.conversationId, message: "More" }, sent(second.state, "More", "third"));
  expect(visible(fromConversation(third.detail))).toEqual(visible(third.state));
  expect(assistants(third.state).map((turn) => turn.text)).toEqual(["", "Prepared that choice.", "Another answer."]);
});

test("saved proposal references and priority source ownership agree after two observed requests", async () => {
  const { layoutId } = await browser([
    { blocks: [{ tool: "propose_changes", input: { alternatives: [{ title: "Synthetic proposal", explanation: "Synthetic", ops: [{ op: "setBinding", at: { layerId: "layer-2", position: 30 }, binding: { kind: "key", code: "A" } }], tradeoffs: { gains: [], costs: [] }, decisionDraft: { goal: "Synthetic goal", choice: "Synthetic choice", reason: "Synthetic reason", scope: { apps: [], habits: [] } } }] } }] },
    { blocks: [{ text: "Prepared an option." }] },
    { blocks: [{ tool: "record_priority", input: { priorityKind: "pinned", statement: "Keep Backspace", reason: "Explicit request", subject: { functions: ["key:BACKSPACE"] } } }] },
    { blocks: [{ text: "Remembered." }] },
  ]);
  const first = await send(layoutId, { message: "Inspect" }, sent());
  if (first.state.conversationId === null) throw new Error("No conversation");
  const second = await send(layoutId, { conversationId: first.state.conversationId, message: "Keep Backspace" }, sent(first.state, "Keep Backspace", "second"));
  expect(assistants(second.state)[0]?.proposals).toHaveLength(1);
  expect(assistants(second.state)[1]?.priorities).toHaveLength(1);
  expect(visible(fromConversation(second.detail))).toEqual(visible(second.state));
  const proposalId = assistants(second.state)[0]?.proposals[0]?.changeSetId;
  if (proposalId === undefined) throw new Error("No proposal");
  const applied = transcriptReducer(second.state, { type: "applied", changeSetId: proposalId });
  expect(assistants(applied)[0]?.proposals[0]?.status).toBe("applied");
  const removed = transcriptReducer(applied, { type: "priorityRemoved", id: assistants(applied)[1]?.priorities[0]?.id ?? "missing" });
  expect(assistants(removed)[1]?.priorities).toEqual([]);
});

test("reading an orphan snapshot with no canonical assistant exposes uncertainty, without executing or resending", async () => {
  const { app, layoutId, requests, fake } = await browser([]);
  const conversation = insertConversation(app.db, { layoutId, title: "Synthetic orphan" });
  const user = insertMessage(app.db, { conversationId: conversation.id, role: "user", content: [{ type: "text", text: "Inspect" }] });
  const observation = chatPresentation(app, conversation.id, user.id);
  observation.observe({ type: "operation_started", operationId: "op_1", tool: "create_config" });
  const detail = await fetchConversation("synthetic", conversation.id, new AbortController().signal);
  const state = fromConversation(detail);
  expect(detail.messages.map((message) => message.role)).toEqual(["user"]);
  expect(assistants(state)).toHaveLength(1);
  expect(assistants(state)[0]?.presentation).toMatchObject({ status: "unobserved", operations: [{ status: "unknown" }], effectsMayHaveOccurred: true });
  expect(assistants(state)[0]?.presentation?.warning).toContain("may still be running");
  expect(isStreaming(state)).toBe(false);
  expect(requests.map((request) => request.method)).toEqual(["GET"]);
  expect(fake.requests).toHaveLength(0);
});

test("a failed model after saved preparation retains its reference and warning, not raw tool input/replay", async () => {
  const { layoutId, requests } = await browser([
    { blocks: [{ tool: "create_config", input: { name: "PRIVATE_RECORDING_CANARY", from: "this" } }] },
    { blocks: [], error: { status: 529, message: "Synthetic overload" } },
  ]);
  const { state, detail, events } = await send(layoutId, { message: "Create a copy" }, sent(EMPTY, "Create a copy"));
  expect(events.at(-1)?.type).toBe("error");
  expect(detail.messages.map((message) => message.role)).toEqual(["user"]);
  const reply = assistants(state)[0];
  expect(reply?.presentation).toMatchObject({ status: "failed", effectsMayHaveOccurred: true, operations: [{ status: "succeeded", references: [{ kind: "config" }] }] });
  expect(reply?.presentation?.warning).toContain("Stop is not rollback");
  expect(JSON.stringify(state)).not.toContain("PRIVATE_RECORDING_CANARY");
  expect(assistants(fromConversation(detail))[0]?.presentation).toEqual(reply?.presentation);
  expect(isStreaming(state)).toBe(false);
  expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
});
