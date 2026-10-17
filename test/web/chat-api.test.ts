// The browser's chat client against the real server and the scripted fake backend. The page uses
// relative URLs, so fetch is pointed at the test server.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { ChatEvent } from "../../src/api/http.ts";
import { startServer, type RunningServer } from "../../src/server/start-server.ts";
import { ApiError } from "../../src/web/api.ts";
import { applyChangeSet } from "../../src/web/api-write.ts";
import { fetchConversation, fetchConversations, streamChat } from "../../src/web/chat/api-chat.ts";
import { EMPTY, transcriptReducer } from "../../src/web/chat/transcript.ts";
import { FakeChat, type FakeChatOptions } from "../helpers/fake-chat-backend.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { loadFixture } from "../server/fixture.ts";

const TOKEN = "test-token-0123456789";
const REF = "moonlander-daily";
const fixture = await loadFixture();
const realFetch = globalThis.fetch;

let running: RunningServer | undefined;
let mock: ReturnType<typeof spyOn> | undefined;
beforeEach(() => {
  running = undefined;
});
afterEach(() => {
  running?.stop();
  mock?.mockRestore();
});

function start(options: FakeChatOptions = {}) {
  const editor = new FakeEditor(fixture);
  const chat = new FakeChat(editor, REF, { tokenDelayMs: 0, stepMs: 0, ...options });
  running = startServer({ port: 0, source: editor.source(), editor, chat, token: TOKEN });
  const origin = running.url.split("?")[0]!;
  mock = spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === "string" && input.startsWith("/") ? new URL(input, origin) : input, init)) as typeof fetch);
  return { editor };
}

async function collect(message: string, conversationId?: string, signal = new AbortController().signal) {
  const events: ChatEvent[] = [];
  await streamChat(TOKEN, REF, { message, ...(conversationId === undefined ? {} : { conversationId }) }, signal, (e) => events.push(e));
  return events;
}

describe("streamChat", () => {
  test("the first message gets three proposals at once, and the frames reduce to a transcript", async () => {
    start();
    const second = await collect("I can't press Option-Option because Option is on S");
    const conversationId = (second[0] as Extract<ChatEvent, { type: "start" }>).conversationId;
    expect(second[0]?.type).toBe("start");
    expect(second.at(-1)?.type).toBe("done");
    expect(second.filter((e) => e.type === "proposal")).toHaveLength(3);
    expect(second.some((e) => e.type === "tool" && e.name === "propose_changes")).toBe(true);
    expect(second.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).not.toContain("?");


    const t = second.reduce(
      (state, event) => transcriptReducer(state, { type: "event", event }),
      transcriptReducer(EMPTY, { type: "sent", userId: "u", assistantId: "a", text: "x", selection: null }),
    );
    const reply = t.turns.at(-1);
    expect(reply).toMatchObject({ kind: "assistant", phase: "done" });
    expect(reply?.kind === "assistant" && reply.proposals.map((p) => p.validation.ok)).toEqual([true, true, true]);
  });

  test("an explicit replace is acted on, and only a request that leaves the choice open gets a question (D-380)", async () => {
    start();
    const explicit = await collect("Please replace my config with the Glove80 one");
    expect(explicit.filter((e) => e.type === "tool" && e.name === "ask_user")).toHaveLength(0);
    expect(explicit.filter((e) => e.type === "proposal")).toHaveLength(3);
    const done = explicit.at(-1);
    expect(done?.type === "done" && done.outcome.question).toBeFalsy();

    const open = await collect("Please move my setup over");
    expect(open.some((e) => e.type === "tool" && e.name === "ask_user")).toBe(true);
    const asked = open.at(-1);
    expect(asked?.type === "done" && asked.outcome.status).toBe("awaiting_answer");
  });

  test("refusals before the stream opens carry the server's status and code", async () => {
    start({ missingKey: true });
    const error = await collect("hi").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect([(error as ApiError).status, (error as ApiError).code]).toEqual([503, "missing_api_key"]);
    running?.stop();
    mock?.mockRestore();

    start({ busy: true });
    const busy = await collect("hi").catch((e: unknown) => e);
    expect([(busy as ApiError).status, (busy as ApiError).code]).toEqual([409, "busy"]);
  });

  test("a model failure part-way through arrives as an error frame after some text", async () => {
    start({ failMidStream: true });
    const events = await collect("hi");
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "model_connection" });
  });

  test("aborting stops the read and rejects with the AbortError, so the panel can tell a stop from a failure", async () => {
    start({ tokenDelayMs: 20 });
    const controller = new AbortController();
    const seen: ChatEvent[] = [];
    const pending = streamChat(TOKEN, REF, { message: "hi" }, controller.signal, (e) => {
      seen.push(e);
      if (e.type === "text") controller.abort();
    });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(seen.some((e) => e.type === "done")).toBe(false);
  });

  test("a wrong token is a 401 the panel can explain", async () => {
    start();
    const error = await streamChat("wrong", REF, { message: "hi" }, new AbortController().signal, () => {}).catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(401);
  });
});

describe("conversations and applying a proposal", () => {
  test("history lists the conversation and reopens it with its proposals", async () => {
    start();
    const first = await collect("hello there");
    const id = (first[0] as Extract<ChatEvent, { type: "start" }>).conversationId;
    await collect("more", id);

    const list = await fetchConversations(TOKEN, REF, new AbortController().signal);
    expect(list.map((c) => c.id)).toEqual([id]);
    const detail = await fetchConversation(TOKEN, id, new AbortController().signal);
    expect(detail.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(detail.proposals).toHaveLength(6);
  });

  test("applying one proposal supersedes the others, and a second apply or a stale one is refused", async () => {
    const { editor } = start();
    const first = await collect("hello");
    const id = (first[0] as Extract<ChatEvent, { type: "start" }>).conversationId;
    const proposals = first.flatMap((e) => (e.type === "proposal" ? [e.proposal] : []));
    const [macro, nav, empty] = proposals;

    const result = await applyChangeSet(TOKEN, nav!.changeSetId);
    expect(editor.detail().revision.id).toBe(result.revisionId);
    expect(editor.detail().revision.origin).toBe("agent");
    const detail = await fetchConversation(TOKEN, id, new AbortController().signal);
    expect(Object.fromEntries(detail.proposals.map((p) => [p.changeSetId, p.status]))).toEqual({
      [macro!.changeSetId]: "superseded",
      [nav!.changeSetId]: "applied",
      [empty!.changeSetId]: "superseded",
    });

    const again = await applyChangeSet(TOKEN, nav!.changeSetId).catch((e: unknown) => e);
    expect((again as ApiError).code).toBe("usage");

    // Proposals from an earlier turn are made against the head they saw; once another turn's proposal
    // is applied they no longer fit, and the server says so instead of overwriting.
    const earlier = (await collect("what about another way", id)).flatMap((e) => (e.type === "proposal" ? [e.proposal] : []));
    const newer = (await collect("and another", id)).flatMap((e) => (e.type === "proposal" ? [e.proposal] : []));
    await applyChangeSet(TOKEN, newer[0]!.changeSetId);
    const stale = await applyChangeSet(TOKEN, earlier[2]!.changeSetId).catch((e: unknown) => e);
    expect([(stale as ApiError).status, (stale as ApiError).code]).toEqual([409, "stale_base"]);
  });
});
