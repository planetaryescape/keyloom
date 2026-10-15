import { describe, expect, spyOn, test } from "bun:test";
import type { ChatEvent } from "../../src/api/http.ts";
import { createSseParser, SseError } from "../../src/web/chat/sse.ts";

const frame = (event: ChatEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const TEXT: ChatEvent = { type: "text", delta: "héllo" };
const TOOL: ChatEvent = { type: "tool", name: "get_layout" };

function collect() {
  const events: ChatEvent[] = [];
  return { events, parser: createSseParser((event) => events.push(event)) };
}

describe("createSseParser", () => {
  test("reads whole frames and keeps their order", () => {
    const { events, parser } = collect();
    parser.push(frame(TOOL) + frame(TEXT));
    expect(events).toEqual([TOOL, TEXT]);
  });

  test("a frame split at every possible byte is still read once", () => {
    const stream = frame(TOOL) + frame(TEXT);
    for (let cut = 1; cut < stream.length; cut++) {
      const { events, parser } = collect();
      parser.push(stream.slice(0, cut));
      parser.push(stream.slice(cut));
      expect(events).toEqual([TOOL, TEXT]);
    }
  });

  test("CRLF separators and comment lines are accepted", () => {
    const { events, parser } = collect();
    parser.push(`: keep-alive\n\n${frame(TEXT).replaceAll("\n", "\r\n")}`);
    expect(events).toEqual([TEXT]);
  });

  test("a frame that is not JSON, or not a ChatEvent, is an SseError with a sentence for the page", () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => collect().parser.push("data: {nope\n\n")).toThrow(SseError);
      expect(() => collect().parser.push('data: {"type":"text"}\n\n')).toThrow(/can't read/);
    } finally {
      logged.mockRestore();
    }
  });

  test("a half-written frame at the end is dropped, not delivered", () => {
    const { events, parser } = collect();
    parser.push(`data: ${JSON.stringify(TEXT)}`);
    parser.end();
    expect(events).toEqual([]);
  });
});
