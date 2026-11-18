import { expect, test } from "bun:test";
import { z } from "zod";
import { startToolServer } from "../../src/agent/codex/tool-server.ts";
import type { ModelTool } from "../../src/agent/model.ts";

function slowTool() {
  let markStarted = () => {};
  let markCancelled = () => {};
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const cancelled = new Promise<void>((resolve) => { markCancelled = resolve; });
  const tool: ModelTool = {
    name: "slow",
    description: "Waits until its call is cancelled.",
    inputSchema: z.object({}),
    run: (_raw, signal) => new Promise<string>((resolve) => {
      signal?.addEventListener("abort", () => {
        markCancelled();
        resolve("stopped");
      }, { once: true });
      markStarted();
    }),
  };
  return { tool, started, cancelled };
}

const send = (server: { url: string; token: string }, body: unknown, signal?: AbortSignal) => fetch(server.url, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${server.token}` },
  body: JSON.stringify(body),
  ...(signal === undefined ? {} : { signal }),
});

const call = { jsonrpc: "2.0", id: "call_1", method: "tools/call", params: { name: "slow", arguments: {} } };

test("MCP's cancel notification reaches the call it names, though it arrives on another request", async () => {
  const { tool, started, cancelled } = slowTool();
  const server = await startToolServer([tool]);
  try {
    const running = send(server, call);
    await started;
    await send(server, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "call_1" } });
    await cancelled;
    expect((await running).status).toBe(200);
  } finally {
    await server.stop();
  }
});

test("a cancel notification for another call leaves this one running", async () => {
  const { tool, started, cancelled } = slowTool();
  const server = await startToolServer([tool]);
  const client = new AbortController();
  try {
    const running = send(server, call, client.signal).catch(() => null);
    await started;
    await send(server, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "call_2" } });
    const outcome = await Promise.race([cancelled.then(() => "cancelled"), Bun.sleep(50).then(() => "running")]);
    expect(outcome).toBe("running");
    client.abort();
    await running;
  } finally {
    await server.stop();
  }
});

test("a client that disconnects cancels its call", async () => {
  const { tool, started, cancelled } = slowTool();
  const server = await startToolServer([tool]);
  const client = new AbortController();
  try {
    const running = send(server, call, client.signal).catch(() => null);
    await started;
    client.abort();
    await running;
    await cancelled;
  } finally {
    await server.stop();
  }
});
