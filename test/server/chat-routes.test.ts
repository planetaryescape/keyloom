import { afterAll, describe, expect, test } from "bun:test";
import { anthropicModel } from "../../src/agent/anthropic-model.ts";
import { ChatEventSchema, ConversationDetailSchema } from "../../src/api/http.ts";
import { appChatBackend } from "../../src/cli/chat-backend.ts";
import { handleChatRoute } from "../../src/server/chat-routes.ts";
import { withoutCredentials } from "../helpers/no-credentials.ts";
import { type ScriptStep, fakeAnthropic } from "../helpers/fake-anthropic.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { draft } from "../helpers/ops.ts";

const TOKEN = "t0ken";
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => servers.forEach((s) => s.stop(true)));

const propose = {
  alternatives: [{
    title: "Plain Option on layer 2",
    ops: [{ op: "setBinding", at: { layerId: "layer-2", position: 30 }, binding: { kind: "modifier", mods: ["LALT"] } }],
    explanation: "Hold layer 2, then tap S twice.",
    tradeoffs: { gains: ["Option-Option works"], costs: [] },
    decisionDraft: draft(),
  }],
};

async function serve(script: ScriptStep[], withModel = true) {
  const ctx = await optionOptionApp();
  const backend = appChatBackend(ctx.app, withModel ? { model: anthropicModel(fakeAnthropic(script).client) } : {});
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => (await handleChatRoute(request, new URL(request.url).pathname, backend, TOKEN)) ?? new Response("not a chat route", { status: 404 }),
  });
  servers.push(server);
  const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { ...(token ? { "x-keyloom-token": token } : {}), "content-type": "application/json", ...init.headers } });
  return { ...ctx, call };
}

async function events(res: Response) {
  const text = await res.text();
  return text.split("\n\n").filter(Boolean).map((f) => {
    const data = f.split("\n").find((l) => l.startsWith("data: ")) ?? "";
    return ChatEventSchema.parse(JSON.parse(data.slice(6)));
  });
}

const post = (message: string, extra: object = {}) => ({ method: "POST", body: JSON.stringify({ message, ...extra }) });

describe("chat routes", () => {
  test("POST streams start, text, tool, proposal and done as SSE", async () => {
    const { call, layoutId } = await serve([
      { blocks: [{ text: "Trying " }, { tool: "propose_changes", input: propose }] },
      { blocks: [{ text: "Done." }] },
    ]);
    const res = await call(`/api/layouts/${layoutId}/chat`, post("Option is on S"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const evs = await events(res);
    expect(evs.map((e) => e.type)).toEqual(["start", "text", "text", "tool", "proposal", "text", "text", "done"]);
    const done = evs.at(-1);
    if (done?.type !== "done") throw new Error("no done");
    expect(done.outcome.proposals[0]).toMatchObject({ title: "Plain Option on layer 2", status: "proposed", validation: { ok: true } });
    expect(done.outcome.usage.inputTokens).toBeGreaterThan(0);
  });

  test("GET reads the conversation back and lists conversations for the layout", async () => {
    const { call, layoutId } = await serve([{ blocks: [{ text: "Which app?" }] }]);
    const first = await events(await call(`/api/layouts/${layoutId}/chat`, post("hello")));
    const start = first[0];
    if (start?.type !== "start") throw new Error("no start");

    const list = await (await call(`/api/layouts/${layoutId}/conversations`)).json();
    expect(list.conversations).toMatchObject([{ id: start.conversationId, title: "hello" }]);

    const detail = ConversationDetailSchema.parse(await (await call(`/api/conversations/${start.conversationId}`)).json());
    expect(detail.messages.map((m) => [m.role, m.text])).toEqual([["user", "hello"], ["assistant", "Which app?"]]);
  });

  test("failures before the stream opens are ordinary JSON errors", async () => {
    const { call, layoutId } = await serve([]);
    expect((await call(`/api/layouts/nope/chat`, post("x"))).status).toBe(404);
    expect((await call(`/api/conversations/conv_nope`)).status).toBe(404);
    expect((await call(`/api/layouts/nope/conversations`)).status).toBe(404);
    const bad = await call(`/api/layouts/${layoutId}/chat`, { method: "POST", body: JSON.stringify({ message: "" }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("usage");
    expect((await call(`/api/layouts/${layoutId}/chat`, { method: "POST", body: "not json" })).status).toBe(400);
    expect((await call(`/api/layouts/${layoutId}/chat`, { method: "GET" })).status).toBe(405);
  });

  test("a missing API key is a 503 with a code the panel can act on", async () => {
    await withoutCredentials(async () => {
      const { call, layoutId } = await serve([], false);
      const res = await call(`/api/layouts/${layoutId}/chat`, post("x"));
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("missing_api_key");
    });
  });

  test("GET /api/chat/provider needs the token and reports the providers", async () => {
    await withoutCredentials(async () => {
      const { call } = await serve([], false);
      expect((await call("/api/chat/provider", {}, null)).status).toBe(401);
      const body = await (await call("/api/chat/provider")).json();
      expect(body.active).toBeNull();
      expect(body.providers.map((p: { id: string }) => p.id)).toEqual(["anthropic", "openrouter", "codex"]);
    });
  });

  test("POST /api/chat/provider needs the token and JSON, and saves the choice for the next conversation", async () => {
    const { call } = await serve([], false);
    const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) => ({ method: "POST", headers, body: JSON.stringify(body) });
    expect((await call("/api/chat/provider", post({ provider: "anthropic" }), null)).status).toBe(401);
    expect((await call("/api/chat/provider", post({ provider: "anthropic" }, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await call("/api/chat/provider", post({ provider: "nope" }))).status).toBe(400);
    const saved = await call("/api/chat/provider", post({ provider: "anthropic", model: "claude-test" }));
    expect(saved.status).toBe(200);
    expect((await saved.json()).active).toMatchObject({ provider: "anthropic", model: "claude-test" });
  });

  test("a model failure after the stream opened arrives as an error event", async () => {
    const { call, layoutId } = await serve([{ blocks: [], error: { status: 401, message: "invalid x-api-key" } }]);
    const res = await call(`/api/layouts/${layoutId}/chat`, post("x"));
    expect(res.status).toBe(200);
    const evs = await events(res);
    expect(evs.map((e) => e.type)).toEqual(["start", "error"]);
    expect(evs[1]).toMatchObject({ type: "error", code: "model_auth" });
  });

  test("a reply that goes quiet while the model thinks gets keep-alive comments, so Bun's 10 s idle timeout can't drop it", async () => {
    const backend = {
      send: async (_ref: string, _request: unknown, emit: (event: { type: "start"; conversationId: string; messageId: string }) => void) => {
        emit({ type: "start", conversationId: "conv_1", messageId: "msg_1" });
        await Bun.sleep(5_300);
      },
      provider: async () => ({ active: null, lockedBy: null, providers: [] }),
      chooseProvider: async () => ({ active: null, lockedBy: null, providers: [] }),
      list: async () => [],
      get: async () => null,
      retirePriority: async () => false,
    };
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => (await handleChatRoute(request, new URL(request.url).pathname, backend, TOKEN)) ?? new Response("no", { status: 404 }),
    });
    servers.push(server);
    const res = await fetch(`http://127.0.0.1:${server.port}/api/layouts/x/chat`, { method: "POST", headers: { "x-keyloom-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(": keepalive\n\n");
  }, 10_000);

  test("every route needs the session token, and other paths are left alone", async () => {
    const { call, layoutId } = await serve([]);
    expect((await call(`/api/layouts/${layoutId}/chat`, post("x"), null)).status).toBe(401);
    expect((await call(`/api/layouts/${layoutId}/conversations`, {}, "wrong")).status).toBe(401);
    expect((await call(`/api/conversations/x`, {}, null)).status).toBe(401);
    expect((await call(`/api/layouts/${layoutId}`)).status).toBe(404); // handled by startServer, not here
    expect((await call(`/api/layouts`)).status).toBe(404);
  });
});

describe("priority chips over the wire", () => {
  const record = { priorityKind: "pinned", statement: "keep Backspace where it is", subject: { functions: ["key:BACKSPACE"] } };

  test("a recorded priority streams as a priority event, comes back with the conversation, and DELETE retires it", async () => {
    const { call, layoutId } = await serve([
      { blocks: [{ tool: "record_priority", input: record }] },
      { blocks: [{ text: "Noted." }] },
    ]);
    const evs = await events(await call(`/api/layouts/${layoutId}/chat`, post("keep Backspace")));
    expect(evs.map((e) => e.type)).toEqual(["start", "tool", "priority", "text", "text", "done"]);
    const chip = evs.find((e) => e.type === "priority");
    if (chip?.type !== "priority") throw new Error("no chip");
    expect(chip.priority).toMatchObject({ priorityKind: "pinned", statement: "keep Backspace where it is", subject: { functions: ["key:BACKSPACE"] } });
    const start = evs[0];
    if (start?.type !== "start") throw new Error("no start");

    const detail = ConversationDetailSchema.parse(await (await call(`/api/conversations/${start.conversationId}`)).json());
    expect(detail.priorities.map((p) => p.id)).toEqual([chip.priority.id]);
    expect(detail.priorities[0]?.sourceMessageIds).toEqual([start.messageId]);

    expect((await call(`/api/priorities/${chip.priority.id}`, { method: "DELETE" })).status).toBe(204);
    const after = ConversationDetailSchema.parse(await (await call(`/api/conversations/${start.conversationId}`)).json());
    expect(after.priorities).toEqual([]);
    expect((await call(`/api/priorities/${chip.priority.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call("/api/priorities/dec_missing", { method: "DELETE" })).status).toBe(404);
  });

  test("DELETE needs the token and refuses other methods", async () => {
    const { call } = await serve([]);
    expect((await call("/api/priorities/dec_x", { method: "DELETE" }, null)).status).toBe(401);
    expect((await call("/api/priorities/dec_x", { method: "GET" })).status).toBe(405);
  });
});

describe("setting up a provider over the wire (D-496)", () => {
  const KEY = "sk-ant-api03-Example_Key-0123456789abcdWXYZ";

  async function serveKeys(verify: "ok" | "rejected") {
    const { Credentials, keychainStore, useCredentials } = await import("../../src/app/credentials.ts");
    const items = new Map<string, string>();
    const argv: string[] = [];
    useCredentials(new Credentials(keychainStore(async (_command, args, stdin) => {
      argv.push(args.join(" "));
      const account = args[args.indexOf("-a") + 1] ?? "";
      if (args[0] === "find-generic-password") return items.has(account) ? { code: 0, stdout: items.get(account)! } : { code: 44, stdout: "" };
      if (args[0] === "delete-generic-password") return { code: items.delete(account) ? 0 : 44, stdout: "" };
      const words = [...(stdin ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
      items.set(words[1] ?? "", words[3] ?? "");
      return { code: 0, stdout: "" };
    })));
    const ctx = await optionOptionApp();
    const backend = appChatBackend(ctx.app, { verifyKey: async () => (verify === "ok" ? { status: "ok" } : { status: "rejected", reason: "invalid x-api-key" }) });
    const server = Bun.serve({ port: 0, fetch: async (request) => (await handleChatRoute(request, new URL(request.url).pathname, backend, TOKEN)) ?? new Response("no", { status: 404 }) });
    servers.push(server);
    const call = (path: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { "x-keyloom-token": TOKEN, "content-type": "application/json", ...init.headers } });
    return { call, items, argv, done: () => useCredentials(undefined) };
  }

  test("saving a key answers with the status, its last four characters only, and forgetting removes it", async () => {
    const s = await serveKeys("ok");
    try {
      await withoutCredentials(async () => {
        const saved = await s.call("/api/chat/provider/key", { method: "POST", body: JSON.stringify({ provider: "anthropic", key: KEY }) });
        expect(saved.status).toBe(200);
        const text = await saved.text();
        expect(text).not.toContain(KEY);
        const body = JSON.parse(text);
        expect(body.checked).toBe(true);
        expect(body.status.active.provider).toBe("anthropic");
        expect(body.status.providers.find((p: { id: string }) => p.id === "anthropic").credential).toEqual({ source: "keychain", last4: "WXYZ" });
        expect(s.items.get("anthropic")).toBe(KEY);
        for (const args of s.argv) expect(args).not.toContain(KEY);

        const forgot = await s.call("/api/chat/provider/key/anthropic", { method: "DELETE" });
        expect(forgot.status).toBe(200);
        expect((await forgot.json()).active).toBeNull();
        expect(s.items.has("anthropic")).toBe(false);
      });
    } finally {
      s.done();
    }
  });

  test("a refused key is a 400 key_rejected that names the provider and never echoes the key", async () => {
    const s = await serveKeys("rejected");
    try {
      await withoutCredentials(async () => {
        const res = await s.call("/api/chat/provider/key", { method: "POST", body: JSON.stringify({ provider: "anthropic", key: KEY }) });
        expect(res.status).toBe(400);
        const text = await res.text();
        expect(text).not.toContain(KEY);
        expect(JSON.parse(text).error).toEqual({ code: "key_rejected", message: "Anthropic refused this key." });
        expect(s.items.size).toBe(0);
      });
    } finally {
      s.done();
    }
  });

  test("a bad body gets a fixed message, a form post is refused, and an unknown provider is not found", async () => {
    const s = await serveKeys("ok");
    try {
      const bad = await s.call("/api/chat/provider/key", { method: "POST", body: JSON.stringify({ provider: "codex", key: KEY }) });
      expect(bad.status).toBe(400);
      expect(await bad.text()).not.toContain(KEY);
      const form = await s.call("/api/chat/provider/key", { method: "POST", body: `key=${KEY}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
      expect(form.status).toBe(415);
      expect((await s.call("/api/chat/provider/key/codex", { method: "DELETE" })).status).toBe(404);
      expect((await s.call("/api/chat/provider/key", { method: "GET" })).status).toBe(405);
    } finally {
      s.done();
    }
  });

  test("a Codex sign-in with no Codex installed is a 409 codex_missing", async () => {
    const s = await serveKeys("ok");
    try {
      await withoutCredentials(async () => {
        const res = await s.call("/api/chat/provider/codex-login", { method: "POST" });
        expect(res.status).toBe(409);
        expect((await res.json()).error.code).toBe("codex_missing");
        const cancel = await s.call("/api/chat/provider/codex-login", { method: "DELETE" });
        expect(cancel.status).toBe(200);
        expect((await cancel.json()).codexSignIn).toEqual({ state: "idle" });
      });
    } finally {
      s.done();
    }
  });
});
