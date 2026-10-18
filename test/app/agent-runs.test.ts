import { expect, test } from "bun:test";
import type { AgentModel } from "../../src/agent/model.ts";
import { emptyUsage } from "../../src/agent/model.ts";
import { answerAgentRun, cancelAgentRun, drainAgentRuns, inspectAgentRun, startAgentRun, waitForAgentRun } from "../../src/app/agent-runs.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { applyChange, listLayouts, openApp, proposeChange, showConversation, showDecision } from "../../src/app/index.ts";
import { effectReceipt, findRun } from "../../src/persistence/agent-runs.ts";
import { listMessages } from "../../src/persistence/conversations.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { handleChatRoute } from "../../src/server/chat-routes.ts";
import { draft, setKey } from "../helpers/ops.ts";

const result = { messages: [{ role: "assistant" as const, content: [{ type: "text" as const, text: "Saved answer." }] }], stopReason: "end_turn", iterations: 1, usage: emptyUsage() };
const model = (run: AgentModel["run"]): AgentModel => ({ provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null, run });
const hanging = model(async (request) => {
  await new Promise<void>((_resolve, reject) => { request.signal?.addEventListener("abort", () => reject(new Error("stopped")), { once: true }); });
  return result;
});

test("acceptance races create one conversation and launch once; ambiguous acknowledgement recovers by identity", async () => {
  const { app, layoutId } = await optionOptionApp();
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const fake = model(async () => { calls++; await gate.promise; return result; });
  const request = { version: 1 as const, requestId: "first-race", layoutRef: layoutId, input: { message: "Unique input" } };
  try {
    const accepted = await Promise.all([startAgentRun(app, request, { model: fake }), startAgentRun(app, request, { model: fake })]);
    expect(accepted[0]?.id).toBe(accepted[1]?.id);
    const run = inspectAgentRun(app, "first-race");
    expect(calls).toBe(1);
    expect(listMessages(app.db, run.conversationId)).toHaveLength(1);
    await expect(startAgentRun(app, { ...request, input: { message: "Changed input" } }, { model: fake })).rejects.toThrow(/different scope or input/);
    await expect(startAgentRun(app, { ...request, requestId: "busy", input: { message: "Keep this draft", conversationId: run.conversationId } }, { model: fake })).rejects.toThrow(/still answering/);
    expect(listMessages(app.db, run.conversationId)).toHaveLength(1);
    gate.resolve();
    const finished = await waitForAgentRun(app, run.id);
    expect(finished.status).toBe("completed");
    const original = findRun(app.db, run.id)?.outcome_json;
    expect(await startAgentRun(app, request, { model: fake })).toEqual(finished);
    expect(findRun(app.db, run.id)?.outcome_json).toBe(original);
    expect(calls).toBe(1);
  } finally { gate.resolve(); await drainAgentRuns(app); app.db.close(); }
});

test("disconnect after create_config is not Stop; repeat returns original work with exactly one copy", async () => {
  const { app, layoutId } = await optionOptionApp();
  const created = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const fake = model(async (request) => {
    calls++;
    await request.tools.find((tool) => tool.name === "create_config")?.run({ name: "Unique prepared copy", from: "this" });
    created.resolve(); await gate.promise; return result;
  });
  const backend = appChatBackend(app, { model: fake });
  const body = { version: 1 as const, requestId: "before-ack", layoutRef: layoutId, input: { message: "Prepare once" } };
  try {
    const aborted = new AbortController();
    const request = new Request("http://localhost/api/agent/v1/runs", { method: "POST", headers: { "x-keyloom-token": "test", "content-type": "application/json" }, body: JSON.stringify(body), signal: aborted.signal });
    const responsePromise = handleChatRoute(request, "/api/agent/v1/runs", backend, "test");
    aborted.abort(); // A vanished acknowledgement is not a cancellation of accepted work.
    const response = await responsePromise;
    expect(response?.status).toBe(202);
    await created.promise;
    const saved = inspectAgentRun(app, "before-ack");
    const stream = await handleChatRoute(new Request(`http://localhost/api/agent/v1/runs/${saved.id}/events`, { headers: { "x-keyloom-token": "test" } }), `/api/agent/v1/runs/${saved.id}/events`, backend, "test");
    const reader = stream?.body?.getReader();
    expect(new TextDecoder().decode((await reader?.read())?.value)).toContain(saved.id);
    await reader?.cancel();
    expect(inspectAgentRun(app, saved.id)).toMatchObject({ status: "running", committedPreparations: 1 });
    const repeat = await backend.runs?.start(body);
    expect(repeat?.id).toBe(saved.id);
    expect(listLayouts(app).filter((layout) => layout.name === "Unique prepared copy")).toHaveLength(1);
    gate.resolve();
    expect((await waitForAgentRun(app, saved.id)).status).toBe("completed");
    expect(calls).toBe(1);
    expect(showConversation(app, saved.conversationId).messages.at(-1)?.text).toBe("Saved answer.");
  } finally { gate.resolve(); await drainAgentRuns(app); app.db.close(); }
});

test("receipt insertion failure rolls back nested config transaction; saved result is original, input-bound and immutable", async () => {
  const { app, layoutId } = await optionOptionApp();
  const run = await startAgentRun(app, { version: 1, requestId: "receipt", layoutRef: layoutId, input: { message: "Hold" } }, { model: hanging });
  const ports = createAgentPorts(app, layoutId, run.conversationId, [run.userMessageId], undefined, run.id);
  try {
    app.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON agent_effects BEGIN SELECT RAISE(ABORT, 'receipt disk fault'); END");
    expect(() => ports.newConfig({ name: "Must roll back", from: "this" })).toThrow("receipt disk fault");
    expect(listLayouts(app).some((layout) => layout.name === "Must roll back")).toBe(false);
    expect(inspectAgentRun(app, run.id).committedPreparations).toBe(0);
    app.db.exec("DROP TRIGGER fail_receipt");
    let attempts = 0;
    const perform = () => { attempts++; return ports.newConfig({ name: "Retained result", from: "this" }); };
    const original = effectReceipt(app.db, run.id, "stable-operation", { from: "this" }, perform);
    expect(effectReceipt(app.db, run.id, "stable-operation", { from: "this" }, perform)).toEqual(original);
    expect(attempts).toBe(1);
    expect(() => effectReceipt(app.db, run.id, "stable-operation", { from: "blank" }, perform)).toThrow(/different input/);
    expect(listLayouts(app).filter((layout) => layout.name === "Retained result")).toHaveLength(1);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("exact answer identity races accept once, replays original continuation, and reloads answered history", async () => {
  const { app, layoutId } = await optionOptionApp();
  let calls = 0;
  const question = { question: "Which side?", options: [{ label: "Left" }, { label: "Right" }] };
  const fake = model(async () => {
    calls++;
    return calls === 1 ? { ...result, stopReason: "awaiting_answer", pending: { id: "exact-question", name: "ask_user", input: question }, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "exact-question", name: "ask_user", input: question }] }] } : result;
  });
  try {
    const first = await startAgentRun(app, { version: 1, requestId: "question", layoutRef: layoutId, input: { message: "Ask" } }, { model: fake });
    await waitForAgentRun(app, first.id);
    const answer = { toolUseId: "exact-question", text: "Left" };
    const accepted = await Promise.all([answerAgentRun(app, first.id, "answer-once", answer, { model: fake }), answerAgentRun(app, first.id, "answer-once", answer, { model: fake })]);
    expect(accepted[0]?.id).toBe(accepted[1]?.id);
    const continuation = accepted[0];
    if (!continuation) throw new Error("no continuation");
    await waitForAgentRun(app, continuation.id);
    expect((await answerAgentRun(app, first.id, "answer-once", answer, { model: fake })).id).toBe(continuation.id);
    await expect(answerAgentRun(app, first.id, "answer-once", { ...answer, text: "Right" }, { model: fake })).rejects.toThrow(/different scope or input/);
    await expect(answerAgentRun(app, first.id, "stale", answer, { model: fake })).rejects.toThrow(/not open|no longer current/);
    expect(calls).toBe(2);
    expect(showConversation(app, first.conversationId).messages.find((message) => message.question)?.question?.answer).toBe("Left");
    expect(listMessages(app.db, first.conversationId).filter((message) => message.content.some((block) => block.type === "tool_result"))).toHaveLength(1);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("all preparation ports roll back at receipt failure, including proposal arrays, put and memory", async () => {
  const { app, layoutId } = await optionOptionApp();
  const cs = proposeChange(app, layoutId, { ops: setKey(28, "F5"), explanation: "synthetic", source: "agent", decisionDraft: { ...draft(), sourceMessageIds: [] } });
  const choiceId = applyChange(app, cs.id).decisionId;
  if (!choiceId) throw new Error("missing choice");
  const run = await startAgentRun(app, { version: 1, requestId: "all-effects", layoutRef: layoutId, input: { message: "Hold" } }, { model: hanging });
  const ports = createAgentPorts(app, layoutId, run.conversationId, [run.userMessageId], undefined, run.id);
  const alternative = { title: "Synthetic proposal", ops: setKey(29, "F17"), explanation: "synthetic", tradeoffs: { gains: [], costs: [] }, decisionDraft: draft() };
  const before = { configs: listLayouts(app).length, proposals: app.db.query("SELECT id FROM change_sets").all().length, choice: showDecision(app, choiceId) };
  try {
    app.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON agent_effects BEGIN SELECT RAISE(ABORT, 'receipt disk fault'); END");
    expect(() => ports.propose([alternative, { ...alternative, title: "Second" }])).toThrow("receipt disk fault");
    expect(app.db.query("SELECT id FROM change_sets").all()).toHaveLength(before.proposals);
    expect(() => ports.put({ from: layoutId, board: "moergo/glove80", name: "Atomic transfer" })).toThrow("receipt disk fault");
    expect(listLayouts(app)).toHaveLength(before.configs);
    expect(() => ports.recordPriority({ priorityKind: "pinned", statement: "Keep F5", subject: { functions: ["key:F5"] } })).toThrow("receipt disk fault");
    expect(ports.priorities()).toEqual([]);
    expect(() => ports.recordOutcome({ decisionId: choiceId, status: "tried_helpful", note: "Works" })).toThrow("receipt disk fault");
    expect(showDecision(app, choiceId)).toEqual(before.choice);
    expect(inspectAgentRun(app, run.id).committedPreparations).toBe(0);
    app.db.exec("DROP TRIGGER fail_receipt");
    // Validation refusal is a stable outcome even though it inserts no proposal.
    const invalid = { ...alternative, ops: [{ op: "setBinding" as const, at: { layerId: "layer-2", position: 30 }, binding: { kind: "key" as const, code: "OPTION" } }] };
    const refused = effectReceipt(app.db, run.id, "invalid", invalid, () => ports.propose([invalid]));
    expect(refused[0]?.changeSetId).toBeNull();
    expect(effectReceipt<typeof refused>(app.db, run.id, "invalid", invalid, () => { throw new Error("must not validate again"); })).toEqual(refused);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("another process reads live ownership without interruption and requests Stop that owner observes", async () => {
  const { app, dir, layoutId } = await optionOptionApp();
  const run = await startAgentRun(app, { version: 1, requestId: "foreign-reader", layoutRef: layoutId, input: { message: "Hold" } }, { model: hanging });
  try {
    const script = `import { openApp } from ${JSON.stringify(new URL("../../src/app/context.ts", import.meta.url).pathname)};
      import { inspectAgentRun, cancelAgentRun } from ${JSON.stringify(new URL("../../src/app/agent-runs.ts", import.meta.url).pathname)};
      const app = openApp({dataDir:${JSON.stringify(dir)}}); console.log(JSON.stringify(inspectAgentRun(app,${JSON.stringify(run.id)}))); console.log(JSON.stringify(cancelAgentRun(app,${JSON.stringify(run.id)}))); app.db.close();`;
    const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(output).toContain('"status":"running"');
    expect(output).toContain('"cancelRequested":true');
    // Polling the owner's persisted cancellation request is bounded by its 100ms check.
    await Bun.sleep(150);
    expect((await waitForAgentRun(app, run.id)).status).toBe("cancelled");
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("restart reconciles a dead owner without replay and keeps committed preparation", async () => {
  const { app, dir, layoutId } = await optionOptionApp();
  const script = `import { openApp } from ${JSON.stringify(new URL("../../src/app/context.ts", import.meta.url).pathname)};
    import { startAgentRun } from ${JSON.stringify(new URL("../../src/app/agent-runs.ts", import.meta.url).pathname)};
    const app=openApp({dataDir:${JSON.stringify(dir)}});
    const model={provider:'anthropic',model:'synthetic',effort:'medium',classifyError:()=>null,run:async (r)=>{await r.tools.find(t=>t.name==='create_config').run({name:'Committed before death',from:'this'}); process.exit(0);}};
    await startAgentRun(app,{version:1,requestId:'dead-owner',layoutRef:${JSON.stringify(layoutId)},input:{message:'Prepare then die'}},{model});`;
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  expect(await child.exited).toBe(0);
  const reopened = openApp({ dataDir: dir });
  try {
    expect(inspectAgentRun(reopened, "dead-owner")).toMatchObject({ status: "interrupted", committedPreparations: 1 });
    expect(inspectAgentRun(reopened, "dead-owner").presentation?.warning).toContain("nothing was automatically rerun");
    const before = listLayouts(reopened).length;
    const repeat = await startAgentRun(reopened, { version: 1, requestId: "dead-owner", layoutRef: layoutId, input: { message: "Prepare then die" } }, { model: model(async () => { throw new Error("must not launch"); }) });
    expect(repeat.status).toBe("interrupted");
    expect(listLayouts(reopened).length).toBe(before);
  } finally { reopened.db.close(); app.db.close(); }
});
