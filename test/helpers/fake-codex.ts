// A stand-in for the `codex` binary: it answers `login status`, and for `exec` it plays a scripted
// run, calling keyloom's tools over the real MCP endpoint it is given, exactly as Codex would. It
// writes down what it was started with, so a test can check the lockdown without Codex.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeStep =
  | { say: string }
  | { call: string; input: unknown; /** Report the call as failed by Codex rather than by the tool. */ codexError?: string; /** Report this completion after the next call executes, simulating buffered JSONL. */ deferCompletion?: boolean }
  | { raw: Record<string, unknown> }
  | { fail: string }
  | { hang: true }
  | { exit: number; stderr?: string };

export type FakeRecord = {
  args: string[];
  prompt: string;
  cwd: string;
  env: Record<string, string | undefined>;
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  results: Array<{ tool: string; text: string; isError: boolean }>;
  unauthorised: number;
  /** Where CODEX_HOME/auth.json pointed when Codex started; null when it is not a link. */
  authLink: string | null;
  /** The config.toml in CODEX_HOME when Codex started; null when there is none. */
  configToml: string | null;
};

const SCRIPT = `#!/usr/bin/env bun
import { readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const dir = dirname(process.argv[1]);
const scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8"));
const out = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
if (process.argv[2] === "login") {
  if (scenario.loggedIn) { console.error("Logged in using ChatGPT"); process.exit(0); }
  console.error("Not logged in"); process.exit(1);
}
const args = process.argv.slice(2);
const config = {};
for (let i = 0; i < args.length; i++) if (args[i] === "-c") { const [k, ...v] = args[i + 1].split("="); config["" + k] = JSON.parse(v.join("=")); }
const prompt = await new Response(Bun.stdin.stream()).text();
const url = config["mcp_servers.keyloom.url"];
const token = process.env.KEYLOOM_MCP_TOKEN;
const record = { args, prompt, cwd: process.cwd(), env: { HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME, KEYLOOM_MCP_TOKEN: process.env.KEYLOOM_MCP_TOKEN, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, PATH: process.env.PATH }, tools: [], results: [], unauthorised: 0, authLink: (() => { try { return readlinkSync(join(process.env.CODEX_HOME, "auth.json")); } catch { return null; } })(), configToml: (() => { try { return readFileSync(join(process.env.CODEX_HOME, "config.toml"), "utf8"); } catch { return null; } })() };
const save = () => writeFileSync(join(dir, "record.json"), JSON.stringify(record));
const rpc = async (method, params, auth = true) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (r.status === 401) { record.unauthorised++; return null; }
  return (await r.json()).result;
};
// A request without the token must be refused; the test reads the count.
await rpc("tools/list", {}, false);
record.tools = (await rpc("tools/list", {})).tools;
out({ type: "thread.started", thread_id: "t1" });
out({ type: "turn.started" });
let n = 0;
const deferred = [];
for (const step of scenario.steps) {
  if ("say" in step) out({ type: "item.completed", item: { id: "item_" + n++, type: "agent_message", text: step.say } });
  else if ("call" in step) {
    const id = "item_" + n++;
    const base = { id, type: "mcp_tool_call", server: "keyloom", tool: step.call, arguments: step.input };
    out({ type: "item.started", item: { ...base, status: "in_progress" } });
    const res = await rpc("tools/call", { name: step.call, arguments: step.input });
    const text = (res?.content ?? []).map((c) => c.text ?? "").join("");
    record.results.push({ tool: step.call, text, isError: Boolean(res?.isError) });
    const event = step.codexError
      ? { type: "item.completed", item: { ...base, status: "failed", error: { message: step.codexError } } }
      : { type: "item.completed", item: { ...base, status: res?.isError ? "failed" : "completed", result: { content: res?.content ?? [], structured_content: null } } };
    if (step.deferCompletion) deferred.push(event);
    else { for (const pending of deferred.splice(0)) out(pending); out(event); }
  } else if ("raw" in step) out(step.raw);
  else if ("fail" in step) { save(); out({ type: "turn.failed", error: { message: step.fail } }); process.exit(1); }
  else if ("hang" in step) { save(); await new Promise(() => {}); }
  else if ("exit" in step) { save(); if (step.stderr) process.stderr.write(step.stderr); process.exit(step.exit); }
}
for (const pending of deferred) out(pending);
save();
out({ type: "turn.completed", usage: scenario.usage ?? { input_tokens: 1000, cached_input_tokens: 400, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 20 } });
`;

export function fakeCodex(scenario: { loggedIn?: boolean; steps?: FakeStep[]; usage?: Record<string, number> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fake-codex-"));
  const bin = join(dir, "codex");
  writeFileSync(bin, SCRIPT);
  chmodSync(bin, 0o755);
  writeFileSync(join(dir, "scenario.json"), JSON.stringify({ loggedIn: true, steps: [], ...scenario }));
  return {
    bin,
    dir,
    /** What the last `exec` was started with; undefined if none ran. */
    record(): FakeRecord | undefined {
      try {
        return JSON.parse(readFileSync(join(dir, "record.json"), "utf8")) as FakeRecord;
      } catch {
        return undefined;
      }
    },
  };
}
