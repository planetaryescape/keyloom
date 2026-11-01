import { expect, test } from "bun:test";
import { openViewWaiter } from "../../src/app/open-view.ts";
import { acknowledgeAgentView, cancelAgentRun, drainAgentRuns, inspectAgentRun, startAgentRun, waitForAgentRun } from "../../src/app/agent-runs.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { emptyUsage, type AgentModel } from "../../src/agent/model.ts";
import { openViewTool } from "../../src/agent/tools/open-view.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { sendMessage } from "../../src/app/index.ts";
import { openApp } from "../../src/app/index.ts";
import { AgentRunRequestSchema, AgentRunSnapshotSchema } from "../../src/api/agent-runs.ts";
import { ViewIntentSchema as WireIntentSchema, ViewResultSchema } from "../../src/api/open-view.ts";
import { ViewIntentSchema as StoredIntentSchema, PresentationSchema, savePresentation } from "../../src/persistence/chat-presentations.ts";
import { ChatPresentationSchema } from "../../src/api/http.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { handleChatRoute } from "../../src/server/chat-routes.ts";

const owner = "30000000-0000-4000-8000-000000000001";
const fakeModel = (run: AgentModel["run"]): AgentModel => ({ provider: "anthropic", model: "synthetic-open-view", effort: "medium", classifyError: () => null, run });
const reply = (result: string) => ({ messages: [
  { role: "assistant" as const, content: [{ type: "tool_use" as const, id: "view", name: "open_view", input: { view: "history" } }] },
  { role: "user" as const, content: [{ type: "tool_result" as const, tool_use_id: "view", content: result }] },
  { role: "assistant" as const, content: [{ type: "text" as const, text: result }] },
], stopReason: "end_turn", iterations: 1, usage: emptyUsage() });

for (const view of ["history", "lab", "decisions", "settings"] as const) test(`${view}: model cannot answer before render ack; duplicate is stable and scope-bound`, async () => {
  const { app, layoutId } = await optionOptionApp();
  let answered = false;
  const model = fakeModel(async (request) => {
    expect(request.system).not.toContain(owner);
    expect(JSON.stringify(request.messages)).not.toContain(owner);
    const result = await request.tools.find((tool) => tool.name === "open_view")?.run({ view });
    answered = true;
    return reply(String(result));
  });
  try {
    const run = await startAgentRun(app, { version: 1, requestId: `open-${view}`, layoutRef: layoutId, input: { message: `Open ${view}` }, viewClient: { version: 1, owner } }, { model });
    const intent = run.presentation?.viewIntents?.[0];
    expect(intent?.view).toBe(view);
    expect(answered).toBe(false);
    expect(JSON.stringify(run)).not.toContain(owner);
    expect(AgentRunSnapshotSchema.parse(run)).toEqual(run);
    const ack = { version: 1 as const, owner, configId: layoutId, intentId: intent?.id ?? "missing", result: { version: 1 as const, status: "opened" as const } };
    for (const invalid of [{ ...ack, owner: crypto.randomUUID() }, { ...ack, configId: "other" }, { ...ack, intentId: "wrong" }]) expect(() => acknowledgeAgentView(app, run.id, invalid)).toThrow();
    expect(() => acknowledgeAgentView(app, "wrong-run", ack)).toThrow();
    expect(answered).toBe(false);
    expect(acknowledgeAgentView(app, run.id, ack)).toEqual(ack.result);
    expect(acknowledgeAgentView(app, run.id, ack)).toEqual(ack.result);
    expect(() => acknowledgeAgentView(app, run.id, { ...ack, result: { version: 1, status: "already-open" } })).toThrow(/differently/);
    const done = await waitForAgentRun(app, run.id);
    expect(answered).toBe(true);
    expect(done.presentation?.viewIntents?.[0]).toMatchObject({ status: "resolved", result: ack.result });
    expect(done.status).toBe("completed");
    expect(acknowledgeAgentView(app, run.id, ack)).toEqual(ack.result);
    expect(done.presentation?.effectsMayHaveOccurred).toBe(false);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

for (const transport of ["durable-old", "legacy"] as const) test(`${transport}: unsupported is immediate, with no intent or waiter`, async () => {
  const { app, layoutId } = await optionOptionApp();
  let result = "";
  const model = fakeModel(async (request) => { result = String(await request.tools.find((tool) => tool.name === "open_view")?.run({ view: "history" })); return reply(result); });
  try {
    if (transport === "legacy") await sendMessage(app, layoutId, { message: "Open History", model, presentationVersion: 1 });
    else {
      const run = await startAgentRun(app, { version: 1, requestId: "old-client", layoutRef: layoutId, input: { message: "Open History" } }, { model });
      const done = await waitForAgentRun(app, run.id);
      expect(done.viewProtocol).toBeUndefined();
      expect(done.presentation?.viewIntents).toBeUndefined();
      expect(done.presentation?.operations[0]?.status).toBe("declined");
    }
    expect(JSON.parse(result)).toEqual({ version: 1, status: "unavailable", reason: "unsupported" });
  } finally { await drainAgentRuns(app); app.db.close(); }
});

for (const exit of ["timeout", "cancelled"] as const) test(`durable ${exit}: late rendered ack never changes saved receipt`, async () => {
  const { app, layoutId } = await optionOptionApp();
  const model = fakeModel(async (request) => reply(String(await request.tools.find((tool) => tool.name === "open_view")?.run({ view: "lab" }))));
  try {
    const run = await startAgentRun(app, { version: 1, requestId: exit, layoutRef: layoutId, input: { message: "Open lab" }, viewClient: { version: 1, owner } }, { model, viewTimeoutMs: exit === "timeout" ? 5 : 100 });
    const intent = run.presentation?.viewIntents?.[0];
    if (exit === "cancelled") cancelAgentRun(app, run.id);
    const done = await waitForAgentRun(app, run.id);
    expect(done.status).toBe(exit === "cancelled" ? "cancelled" : "completed");
    expect(done.presentation?.viewIntents?.[0]).toMatchObject({ status: "resolved", result: { version: 1, status: "unavailable", reason: exit } });
    expect(() => acknowledgeAgentView(app, run.id, { version: 1, owner, configId: layoutId, intentId: intent?.id ?? "missing", result: { version: 1, status: "opened" } })).toThrow();
    expect(inspectAgentRun(app, run.id).presentation?.viewIntents).toEqual(done.presentation?.viewIntents);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("parallel tools refuse overlap, eight sequential intents fit both contracts and row budget", async () => {
  const { app, layoutId } = await optionOptionApp();
  let second = "";
  const model = fakeModel(async (request) => {
    const tool = request.tools.find((tool) => tool.name === "open_view");
    const first = tool?.run({ view: "history" });
    second = String(await tool?.run({ view: "settings" }));
    return reply(String(await first));
  });
  try {
    const run = await startAgentRun(app, { version: 1, requestId: "parallel", layoutRef: layoutId, input: { message: "Open History" }, viewClient: { version: 1, owner } }, { model, viewTimeoutMs: 5 });
    const done = await waitForAgentRun(app, run.id);
    expect(JSON.parse(second)).toMatchObject({ status: "unavailable", reason: "busy" });
    expect(done.presentation?.viewIntents).toHaveLength(1);
    const intent = done.presentation?.viewIntents?.[0];
    if (!intent || !done.presentation) throw new Error("missing intent");
    expect(WireIntentSchema.parse(intent)).toEqual(StoredIntentSchema.parse(intent));
    const bounded = { ...done.presentation, viewIntents: Array.from({ length: 8 }, (_, n) => ({ ...intent, id: `intent-${n}` })) };
    expect(ChatPresentationSchema.parse(bounded)).toEqual(PresentationSchema.parse(bounded));
    expect(() => savePresentation(app.db, run.conversationId, bounded)).not.toThrow();
    const older = PresentationSchema.omit({ viewIntents: true }).parse(bounded);
    expect("viewIntents" in older).toBe(false);
    expect(older.status).toBe("completed");
    expect(ChatPresentationSchema.safeParse({ ...bounded, viewIntents: [...bounded.viewIntents, intent] }).success).toBe(false);
    expect(ViewResultSchema.safeParse({ version: 1, status: "opened", reason: "timeout" }).success).toBe(false);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("invalid destinations, unknown input and invalid negotiation are rejected before navigation", async () => {
  const { app, layoutId } = await optionOptionApp();
  try {
    const tool = openViewTool(createAgentPorts(app, layoutId, "synthetic", []));
    for (const raw of [{ view: "record" }, { view: "history", url: "javascript:alert(1)" }, {}]) expect(() => tool.run(raw)).toThrow(/invalid input/);
    expect(AgentRunRequestSchema.safeParse({ version: 1, requestId: "bad", layoutRef: layoutId, input: { message: "Open" }, viewClient: { version: 2, owner } }).success).toBe(false);
  } finally { app.db.close(); }
});

test("dead-owner pending intent becomes inert on restart; reading and replay never launch a tool", async () => {
  const { app, dir, layoutId } = await optionOptionApp();
  const script = `import { openApp } from ${JSON.stringify(new URL("../../src/app/context.ts", import.meta.url).pathname)};
    import { startAgentRun } from ${JSON.stringify(new URL("../../src/app/agent-runs.ts", import.meta.url).pathname)};
    const app = openApp({dataDir:${JSON.stringify(dir)}});
    const model = { provider:'anthropic', model:'synthetic', effort:'medium', classifyError:()=>null, run:async(r)=>{
      void r.tools.find(t=>t.name==='open_view').run({view:'history'}); process.exit(0);
    }};
    await startAgentRun(app,{version:1,requestId:'dead-view',layoutRef:${JSON.stringify(layoutId)},input:{message:'Open History'},viewClient:{version:1,owner:${JSON.stringify(owner)}}},{model});`;
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  expect(await child.exited).toBe(0);
  const reopened = openApp({ dataDir: dir });
  try {
    const run = inspectAgentRun(reopened, "dead-view");
    expect(run.status).toBe("interrupted");
    expect(run.presentation?.viewIntents?.[0]).toMatchObject({ status: "resolved", result: { version: 1, status: "unavailable", reason: "cancelled" } });
    const intent = run.presentation?.viewIntents?.[0];
    expect(() => acknowledgeAgentView(reopened, run.id, { version: 1, owner, configId: layoutId, intentId: intent?.id ?? "missing", result: { version: 1, status: "opened" } })).toThrow();
    const repeat = await startAgentRun(reopened, { version: 1, requestId: "dead-view", layoutRef: layoutId, input: { message: "Open History" }, viewClient: { version: 1, owner } }, { model: fakeModel(async () => { throw new Error("must not launch"); }) });
    expect(repeat).toEqual(run);
  } finally { reopened.db.close(); app.db.close(); }
});

test("ack route retains authentication and strict schema; old server negotiation is not advertised", async () => {
  const { app, layoutId } = await optionOptionApp();
  const model = fakeModel(async (request) => reply(String(await request.tools.find((tool) => tool.name === "open_view")?.run({ view: "settings" }))));
  const backend = appChatBackend(app, { model });
  try {
    const oldRequest = AgentRunRequestSchema.omit({ viewClient: true }).parse({ version: 1, requestId: "old-server", layoutRef: layoutId, input: { message: "Open settings" }, viewClient: { version: 1, owner } });
    const old = await startAgentRun(app, oldRequest, { model });
    expect((await waitForAgentRun(app, old.id)).viewProtocol).toBeUndefined();
    const run = await startAgentRun(app, { version: 1, requestId: "route", layoutRef: layoutId, input: { message: "Open settings" }, viewClient: { version: 1, owner } }, { model });
    const path = `/api/agent/v1/runs/${run.id}/view-ack`;
    const ack = { version: 1, owner, configId: layoutId, intentId: run.presentation?.viewIntents?.[0]?.id, result: { version: 1, status: "opened" } };
    const send = (token: string, body: unknown) => handleChatRoute(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-keyloom-token": token }, body: JSON.stringify(body) }), path, backend, "synthetic");
    expect((await send("wrong", ack))?.status).toBe(401);
    expect((await send("synthetic", { ...ack, result: { version: 1, status: "opened", reason: "timeout" } }))?.status).toBe(400);
    expect((await send("synthetic", ack))?.status).toBe(200);
    expect((await send("synthetic", ack))?.status).toBe(200);
    expect((await waitForAgentRun(app, run.id)).presentation?.viewIntents?.[0]).toMatchObject({ status: "resolved", result: { version: 1, status: "opened" } });
  } finally { await drainAgentRuns(app); app.db.close(); }
});

test("a run can acknowledge eight views, then refuses the ninth without replacing any receipt", async () => {
  const { app, layoutId } = await optionOptionApp();
  const results: unknown[] = [];
  const model = fakeModel(async (request) => {
    const tool = request.tools.find((item) => item.name === "open_view");
    for (let n = 0; n < 9; n++) {
      const pending = tool?.run({ view: "history" });
      const run = inspectAgentRun(app, "eight-views");
      const intent = run.presentation?.viewIntents?.at(-1);
      if (intent?.status === "pending") acknowledgeAgentView(app, run.id, { version: 1, owner, configId: layoutId, intentId: intent.id, result: { version: 1, status: n === 0 ? "opened" : "already-open" } });
      results.push(JSON.parse(String(await pending)));
    }
    return reply(JSON.stringify(results));
  });
  try {
    const run = await startAgentRun(app, { version: 1, requestId: "eight-views", layoutRef: layoutId, input: { message: "Open History" }, viewClient: { version: 1, owner } }, { model });
    const done = await waitForAgentRun(app, run.id);
    expect(results[0]).toEqual({ version: 1, status: "opened" });
    expect(results[7]).toEqual({ version: 1, status: "already-open" });
    expect(results[8]).toEqual({ version: 1, status: "unavailable", reason: "limit" });
    expect(done.presentation?.viewIntents).toHaveLength(8);
    expect(done.presentation?.viewIntents?.every((intent) => intent.status === "resolved")).toBe(true);
  } finally { await drainAgentRuns(app); app.db.close(); }
});

// Exit table: rendered/refused acknowledgement, deadline, abort, disposal, concurrent call.
// A settled waiter never accepts a late or contradictory acknowledgement.
test("view waiter publishes before waiting, refuses overlap, and settles only once", async () => {
  const abort = new AbortController();
  const seen: string[] = [];
  const waiter = openViewWaiter(abort.signal, 20);
  const result = waiter.wait(() => seen.push("pending"));
  expect(seen).toEqual(["pending"]);
  expect(await waiter.wait(() => seen.push("overlap"))).toEqual({ version: 1, status: "unavailable", reason: "busy" });
  expect(waiter.ack({ version: 1, status: "opened" })).toBe(true);
  expect(await result).toEqual({ version: 1, status: "opened" });
  expect(waiter.ack({ version: 1, status: "unavailable", reason: "cancelled" })).toBe(false);
  waiter.close();
});

for (const exit of ["timeout", "cancelled", "closed"] as const) test(`view waiter ${exit} cannot become opened`, async () => {
  const abort = new AbortController();
  const waiter = openViewWaiter(abort.signal, 1);
  const pending = waiter.wait(() => {});
  if (exit === "cancelled") abort.abort();
  if (exit === "closed") waiter.close();
  expect(await pending).toEqual({ version: 1, status: "unavailable", reason: exit === "closed" ? "cancelled" : exit });
  expect(waiter.ack({ version: 1, status: "opened" })).toBe(false);
  waiter.close();
});

test("already aborted waiter publishes nothing; browser refusal is exclusive", async () => {
  const abort = new AbortController();
  abort.abort();
  const waiter = openViewWaiter(abort.signal, 1);
  expect(await waiter.wait(() => { throw new Error("must not publish"); })).toMatchObject({ status: "unavailable", reason: "cancelled" });
  const live = openViewWaiter(new AbortController().signal, 20);
  const pending = live.wait(() => {});
  live.ack({ version: 1, status: "unavailable", reason: "draft" });
  expect(await pending).toMatchObject({ status: "unavailable", reason: "draft" });
  live.close();
});
