// Run against a task-local installed candidate, never the user's data or model.
// bun test/cli/open-view-installed.ts /absolute/path/to/keyloom /task-owned/scratch
import { openApp, importLayout } from "../../src/app/index.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
const binary = process.argv[2];
const directory = process.argv[3];
if (!binary || !directory) throw new Error("Pass candidate binary and scratch data directory");
const app = openApp({ dataDir: directory });
await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "synthetic-cli" });
app.db.close();
const results: unknown[] = [];
let requests = 0;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (new URL(request.url).pathname !== "/v1/messages") throw new Error("Unexpected local model route");
  const body = await request.json();
  const last = body.messages.at(-1);
  const toolResult = Array.isArray(last?.content) ? last.content.find((block: { type: string }) => block.type === "tool_result") : undefined;
  const n = ++requests;
  const tool = !toolResult;
  if (toolResult) {
    const result = JSON.parse(toolResult.content);
    if (JSON.stringify(result) !== JSON.stringify({ version: 1, status: "unavailable", reason: "unsupported" })) throw new Error(`Wrong CLI view result: ${JSON.stringify(result)}`);
    results.push(result);
  }
  const block = tool ? { type: "tool_use", id: `view-${n}`, name: "open_view", input: {} } : { type: "text", text: "" };
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { id: `local-${n}`, type: "message", role: "assistant", model: "synthetic", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: block }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: tool ? { type: "input_json_delta", partial_json: '{"view":"history"}' } : { type: "text_delta", text: "History is unavailable in this terminal; no browser was opened." } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
} });
async function cli(args: string[]) {
  const child = Bun.spawn([binary ?? "", "--data-dir", directory ?? "", "--format", "json", ...args], {
    env: { PATH: process.env.PATH ?? "", HOME: directory, ANTHROPIC_API_KEY: "synthetic-local-only", ANTHROPIC_BASE_URL: server.url.origin }, stdout: "pipe", stderr: "pipe",
  });
  const out = await new Response(child.stdout).text();
  const error = await new Response(child.stderr).text();
  if (await child.exited !== 0) throw new Error(`CLI failed: ${error}\n${out}`);
  return JSON.parse(out);
}
try {
  for (const args of [["chat", "synthetic-cli", "--message", "Open History"], ["agent", "start", "synthetic-cli", "Open History", "--request-id", "D-installed"]]) {
    const output = await cli(args);
    const conversationId = output.conversation_id ?? output.conversationId;
    const inspected = await cli(["conversations", "show", conversationId]);
    if (inspected.presentations[0]?.operations[0]?.status !== "declined" || inspected.presentations[0]?.viewIntents !== undefined) throw new Error("Inspection did not retain unavailable operation");
    if (args[0] === "agent") {
      const saved = await cli(["agent", "show", output.id]);
      if (saved.viewProtocol !== undefined || saved.status !== "completed") throw new Error("CLI advertised a browser or did not finish");
    }
    console.log(JSON.stringify({ command: args.join(" "), output, inspection: inspected.presentations }));
  }
  if (requests !== 4 || results.length !== 2) throw new Error("Unexpected local model call count");
  console.log("PASS D-installed: chat and agent start, local SDK tool results before answers, saved inspection, no pending view or hang.");
} finally { server.stop(true); }
