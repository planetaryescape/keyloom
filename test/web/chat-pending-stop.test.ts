import { expect, spyOn, test } from "bun:test";
import { cancelSavedRequest, startSavedChat, fetchSavedRun } from "../../src/web/chat/api-chat.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { handleChatRoute } from "../../src/server/chat-routes.ts";
import type { AgentModel } from "../../src/agent/model.ts";
import { listLayouts } from "../../src/app/layouts.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

test("held unsent acceptance after explicit Stop cannot execute preparation; lost ACK recovers only by GET", async () => {
  const { app, layoutId } = await optionOptionApp();
  const release = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  let calls = 0;
  const model: AgentModel = { provider: "anthropic", model: "synthetic", effort: "medium", classifyError: () => null, async run(request) {
    calls++;
    await request.tools.find((tool) => tool.name === "create_config")?.run({ name: "Must not exist after Stop", from: "this" });
    throw new Error("model must not execute");
  } };
  const backend = appChatBackend(app, { model });
  const paths: string[] = [];
  const route = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), "http://localhost"), init);
    const path = new URL(request.url).pathname;
    paths.push(path);
    if (path === "/api/agent/v1/runs" && request.method === "POST") { held.resolve(); await release.promise; }
    const response = await handleChatRoute(request, path, backend, "test");
    if (!response) throw new Error("unknown route");
    if (path === "/api/agent/v1/runs") throw new Error("accepted acknowledgement was lost");
    return response;
  };
  const mock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(route, { preconnect: globalThis.fetch.preconnect }));
  try {
    const count = listLayouts(app).length;
    const accepting = startSavedChat("test", layoutId, "held-before-transport", { message: "Prepare once" }, new AbortController().signal);
    await held.promise;
    expect(await cancelSavedRequest("test", "held-before-transport")).toEqual({ version: 1, status: "pending_acceptance", requestId: "held-before-transport", cancelRequested: true });
    // Unknown run cancellation still refuses rather than fabricating a terminal run.
    expect((await handleChatRoute(new Request("http://localhost/api/agent/v1/runs/unknown/cancel", { method: "POST", headers: { "content-type": "application/json", "x-keyloom-token": "test" }, body: '{"version":1}' }), "/api/agent/v1/runs/unknown/cancel", backend, "test"))?.status).toBe(404);
    release.resolve();
    await expect(accepting).rejects.toThrow(/reach keyloom/);
    const run = await fetchSavedRun("test", "held-before-transport", new AbortController().signal);
    expect(run).toMatchObject({ status: "cancelled", cancelRequested: true, committedPreparations: 0 });
    expect(calls).toBe(0);
    expect(listLayouts(app)).toHaveLength(count);
    expect(paths.filter((path) => path === "/api/agent/v1/runs")).toHaveLength(1);
  } finally { release.resolve(); mock.mockRestore(); app.db.close(); }
});
