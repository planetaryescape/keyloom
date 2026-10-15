// A scripted Anthropic API behind the real SDK client: the SDK's Tool Runner, zod tools and stream
// parsing all run for real, and only `fetch` is replaced, so no test touches the network.
import Anthropic from "@anthropic-ai/sdk";

export type ScriptedBlock = { text: string } | { tool: string; input: unknown };
export type ScriptedReply = {
  blocks: ScriptedBlock[];
  stop?: "end_turn" | "tool_use" | "max_tokens" | "refusal";
  usage?: { input: number; output: number };
  /** An HTTP error instead of a reply. */
  error?: { status: number; message: string };
};

export type SeenRequest = {
  body: Record<string, any>;
  headers: Headers;
  /** The text of every tool_result in the last user message, in order. */
  toolResults: string[];
};

export type ScriptStep = ScriptedReply | ((seen: SeenRequest) => ScriptedReply);

const sse = (events: Array<[string, unknown]>): string => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");

function stream(reply: ScriptedReply, n: number): string {
  const usage = reply.usage ?? { input: 100, output: 50 };
  const stop = reply.stop ?? (reply.blocks.some((b) => "tool" in b) ? "tool_use" : "end_turn");
  const events: Array<[string, unknown]> = [
    ["message_start", {
      type: "message_start",
      message: { id: `msg_fake${n}`, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: 1 } },
    }],
  ];
  reply.blocks.forEach((block, index) => {
    if ("text" in block) {
      const mid = Math.ceil(block.text.length / 2);
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      for (const part of [block.text.slice(0, mid), block.text.slice(mid)]) {
        events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: part } }]);
      }
    } else {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_${n}_${index}`, name: block.tool, input: {} } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return sse(events);
}

export function fakeAnthropic(script: ScriptStep[]): { client: Anthropic; requests: SeenRequest[] } {
  const requests: SeenRequest[] = [];
  const fetchFake = async (_url: unknown, init?: { body?: unknown; headers?: HeadersInit }): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    const lastUser = [...(body.messages as any[])].reverse().find((m) => m.role === "user");
    const blocks: any[] = Array.isArray(lastUser?.content) ? lastUser.content : [];
    const toolResults = blocks
      .filter((b) => b.type === "tool_result")
      .map((b) => (typeof b.content === "string" ? b.content : (b.content ?? []).map((c: any) => c.text ?? "").join("")));
    const seen: SeenRequest = { body, headers: new Headers(init?.headers), toolResults };
    requests.push(seen);
    const step = script[requests.length - 1];
    if (!step) throw new Error(`the scripted model was called ${requests.length} times, but the script has ${script.length} steps`);
    const reply = typeof step === "function" ? step(seen) : step;
    if (reply.error) {
      return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: reply.error.message } }), {
        status: reply.error.status, headers: { "content-type": "application/json" },
      });
    }
    return new Response(stream(reply, requests.length), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const client = new Anthropic({ apiKey: "test-key", fetch: fetchFake as unknown as typeof fetch, maxRetries: 0 });
  return { client, requests };
}
