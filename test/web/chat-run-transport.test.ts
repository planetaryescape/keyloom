import { expect, spyOn, test } from "bun:test";
import { startSavedChat, observeSavedRun } from "../../src/web/chat/api-chat.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { handleChatRoute } from "../../src/server/chat-routes.ts";
import { drainAgentRuns } from "../../src/app/agent-runs.ts";
import type { AgentModel } from "../../src/agent/model.ts";
import { emptyUsage } from "../../src/agent/model.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

test("lost accepted POST acknowledgement is recovered only by GET with no second model or config", async () => {
  const { app, layoutId } = await optionOptionApp();
  let calls = 0;
  const model: AgentModel = { provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null, async run(request) {
    calls++;
    await request.tools.find((tool) => tool.name === "create_config")?.run({ name: "Transport single copy", from: "this" });
    return { messages: [{ role: "assistant", content: [{ type: "text", text: "Prepared once" }] }], stopReason: "end_turn", iterations: 1, usage: emptyUsage() };
  } };
  const backend = appChatBackend(app, { model });
  const methods: string[] = [];
  let loseAck = true;
  const route = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), "http://localhost"), init);
    methods.push(request.method);
    const response = await handleChatRoute(request, new URL(request.url).pathname, backend, "synthetic");
    if (!response) throw new Error("unknown route");
    if (request.method === "POST" && loseAck) { loseAck = false; throw new Error("acknowledgement vanished after acceptance"); }
    return response;
  };
  const mock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(route, { preconnect: globalThis.fetch.preconnect }));
  try {
    await expect(startSavedChat("synthetic", layoutId, "recover-ack", { message: "Prepare once" }, new AbortController().signal)).rejects.toThrow(/reach keyloom/);
    const observed: string[] = [];
    await observeSavedRun("synthetic", "recover-ack", new AbortController().signal, (snapshot, detail) => {
      observed.push(snapshot.status);
      if (snapshot.status === "completed") expect(detail.messages.at(-1)?.text).toBe("Prepared once");
    });
    expect(observed.at(-1)).toBe("completed");
    expect(methods.filter((method) => method === "POST")).toHaveLength(1);
    expect(calls).toBe(1);
  } finally { mock.mockRestore(); await drainAgentRuns(app); app.db.close(); }
});

test("only a definite 404 permits legacy fallback; unknown version and ambiguous failure refuse writes", async () => {
  const mock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => new Response("unsupported", { status: 404 }), { preconnect: globalThis.fetch.preconnect }));
  try {
    expect(await startSavedChat("t", "layout", "id", { message: "Hello" }, new AbortController().signal)).toBeNull();
    mock.mockImplementation(Object.assign(async () => new Response("version", { status: 400 }), { preconnect: globalThis.fetch.preconnect }));
    await expect(startSavedChat("t", "layout", "id", { message: "Hello" }, new AbortController().signal)).rejects.toThrow();
    mock.mockImplementation(Object.assign(async () => { throw new Error("timeout"); }, { preconnect: globalThis.fetch.preconnect }));
    await expect(startSavedChat("t", "layout", "id", { message: "Hello" }, new AbortController().signal)).rejects.toThrow();
  } finally { mock.mockRestore(); }
});
