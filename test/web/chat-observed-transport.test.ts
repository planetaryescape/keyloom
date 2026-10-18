import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ChatOutcome, ChatPresentation, ObservedChatEvent } from "../../src/api/http.ts";
import { streamObservedChat } from "../../src/web/chat/api-chat.ts";
import { createObservedSseParser, createSseParser, SseError } from "../../src/web/chat/sse.ts";

const snapshot: ChatPresentation = { version: 1, userMessageId: "request", status: "completed", messages: [{ id: "public_1", kind: "answer", text: "Answer" }], operations: [], effectsMayHaveOccurred: false, warning: null, detailsTruncated: false };
const outcome: ChatOutcome = { conversationId: "c", messageIds: ["request", "answer"], status: "complete", text: "Answer", proposals: [], priorities: [], provider: "anthropic", model: "synthetic", effort: "medium", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, iterations: 1 };
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

function response(text: string) {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const fetchReply = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, ...(init === undefined ? {} : { init }) });
    return new Response(text, { headers: { "content-type": "text/event-stream" } });
  };
  const mock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(fetchReply, { preconnect: globalThis.fetch.preconnect }));
  restore = () => mock.mockRestore();
  return calls;
}

describe("negotiated SSE parser", () => {
  test("legacy parser remains strict; observed parser accepts snapshots and legacy fallback with split CRLF boundaries", () => {
    expect(() => createSseParser(() => {}).push(frame({ type: "presentation", presentation: snapshot }))).toThrow(SseError);
    const expected: ObservedChatEvent[] = [{ type: "presentation", presentation: snapshot }, { type: "text", delta: "legacy" }];
    const text = expected.map(frame).join("").replaceAll("\n", "\r\n");
    for (let cut = 0; cut <= text.length; cut++) {
      const seen: ObservedChatEvent[] = [];
      const parser = createObservedSseParser((event) => seen.push(event));
      parser.push(text.slice(0, cut));
      parser.push(text.slice(cut));
      parser.end();
      expect(seen).toEqual(expected);
    }
  });

  test("unsupported versions and malformed snapshots fail with a readable upgrade instruction", () => {
    const parser = () => createObservedSseParser(() => {});
    expect(() => parser().push(frame({ type: "presentation", presentation: { ...snapshot, version: 2 } }))).toThrow(/can't read.*update keyloom/);
    expect(() => parser().push(frame({ type: "presentation", presentation: { ...snapshot, operations: [{ id: "op_1" }] } }))).toThrow(SseError);
    expect(() => parser().push("data: {not-json\n\n")).toThrow(/can't read/);
  });

  test("opaque replay and raw tool-result fields are not admitted into the presentation adapter", () => {
    const seen: ObservedChatEvent[] = [];
    createObservedSseParser((event) => seen.push(event)).push(frame({ type: "presentation", presentation: { ...snapshot, providerData: { thinking: "PRIVATE_REPLAY_CANARY" }, rawRecording: "RAW_RECORDING_CANARY", operations: [{ id: "op_1", tool: "get_layout", label: "Read layout", status: "succeeded", durationMs: 1, validationCodes: [], references: [], accepted: 0, declined: 0, result: "RAW_TOOL_RESULT_CANARY" }] } }));
    expect(JSON.stringify(seen)).not.toContain("CANARY");
    expect(seen[0]?.type).toBe("presentation");
  });
});

describe("single-request observed transport", () => {
  test("an older server can ignore negotiation and return readable legacy events", async () => {
    const calls = response(frame({ type: "start", conversationId: "c", messageId: "request" }) + frame({ type: "text", delta: "Answer" }) + frame({ type: "done", outcome }));
    const seen: ObservedChatEvent[] = [];
    await streamObservedChat("synthetic", "layout", { message: "Inspect" }, new AbortController().signal, (event) => seen.push(event));
    expect(seen.map((event) => event.type)).toEqual(["start", "text", "done"]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ message: "Inspect", presentationVersion: 1 });
    expect(calls).toHaveLength(1);
  });

  test("a completed snapshot is not a terminal transport frame: a cut stream fails without resending", async () => {
    const calls = response(frame({ type: "start", conversationId: "c", messageId: "request" }) + frame({ type: "presentation", presentation: snapshot }));
    await expect(streamObservedChat("synthetic", "layout", { message: "Inspect" }, new AbortController().signal, () => {})).rejects.toThrow("dropped before the reply finished");
    expect(calls).toHaveLength(1);
  });

  test("malformed/wrong-version frames fail once, without retrying the request", async () => {
    const calls = response(frame({ type: "presentation", presentation: { ...snapshot, version: 2 } }));
    await expect(streamObservedChat("synthetic", "layout", { message: "Inspect" }, new AbortController().signal, () => {})).rejects.toThrow(/can't read/);
    expect(calls).toHaveLength(1);
  });

  test("a partially written done frame does not complete or resend the request", async () => {
    const calls = response(frame({ type: "presentation", presentation: { ...snapshot, status: "running" } }) + `data: ${JSON.stringify({ type: "done", outcome })}`);
    await expect(streamObservedChat("synthetic", "layout", { message: "Inspect" }, new AbortController().signal, () => {})).rejects.toThrow(/dropped/);
    expect(calls).toHaveLength(1);
  });
});
