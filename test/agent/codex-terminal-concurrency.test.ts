import { expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { codexModel } from "../../src/agent/codex-model.ts";
import type { ModelTool } from "../../src/agent/model.ts";
import { tempDir } from "../helpers/tmp.ts";

/** Two overlapping HTTP calls reach the real MCP server before either async tool finishes. */
function concurrentCodex(first: string) {
  const directory = tempDir("codex-terminal-concurrency-");
  const bin = join(directory, "codex");
  writeFileSync(join(directory, "auth.json"), "{}");
  writeFileSync(bin, `#!/usr/bin/env bun
const config = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) if (args[i] === '-c') { const [key, ...value] = args[i + 1].split('='); config[key] = JSON.parse(value.join('=')); }
await new Response(Bun.stdin.stream()).text();
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const call = async (id, name) => {
 const response = await fetch(config['mcp_servers.keyloom.url'], { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + process.env.KEYLOOM_MCP_TOKEN }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { id } } }) });
 return (await response.json()).result;
};
emit({ type: 'thread.started', thread_id: 'synthetic' }); emit({ type: 'turn.started' });
const names = [${JSON.stringify(first)}, 'terminal'];
const results = await Promise.all(names.map((name, index) => call(index + 1, name)));
results.forEach((result, index) => emit({ type: 'item.completed', item: { id: 'item_' + index, type: 'mcp_tool_call', server: 'keyloom', tool: names[index], arguments: { id: index + 1 }, status: result.isError ? 'failed' : 'completed', result: { content: result.content, structured_content: null } } }));
emit({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
`);
  chmodSync(bin, 0o755);
  return codexModel({ env: { PATH: process.env.PATH, CODEX_HOME: directory, KEYLOOM_CODEX_BIN: bin }, timeoutMs: 10_000 });
}

for (const mode of ["complete", "failed-first", "pause-first"] as const) test(`Codex serializes concurrent MCP execution: ${mode}`, async () => {
  const first = mode === "pause-first" ? "question" : "terminal";
  const model = concurrentCodex(first);
  const order: number[] = [];
  let effects = 0;
  const inputSchema = z.object({ id: z.number().int() });
  const tools: ModelTool[] = [{
    name: "terminal", description: "A successful call ends the turn", inputSchema, completes: true,
    async run(raw) {
      const { id } = inputSchema.parse(raw);
      order.push(id);
      await Bun.sleep(25);
      if (mode === "failed-first" && id === 1) throw new Error("Correctable first call failure");
      effects++;
      return "Saved once";
    },
  }, {
    name: "question", description: "Wait for an answer", inputSchema, pauses: true,
    async run(raw) { order.push(inputSchema.parse(raw).id); await Bun.sleep(25); return "Question pending"; },
  }];
  const result = await model.run({ system: "Synthetic concurrent tool calls", messages: [{ role: "user", content: [{ type: "text", text: "Finish once" }] }], maxIterations: 10, tools });
  expect(order).toEqual(mode === "failed-first" ? [1, 2] : [1]);
  expect(effects).toBe(mode === "pause-first" ? 0 : 1);
  expect(result.stopReason).toBe(mode === "pause-first" ? "awaiting_answer" : "end_turn");
  const stored = result.messages.flatMap((message) => message.content);
  if (mode === "failed-first") expect(stored.some((block) => block.type === "tool_result" && block.is_error)).toBe(true);
  if (mode === "pause-first") expect(result.pending?.name).toBe("question");
});
