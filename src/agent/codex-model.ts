// The Codex implementation of AgentModel (D-108). Codex runs its own agent loop, so this adapter
// does not drive a loop: it spawns the installed `codex exec --experimental-json`, serves keyloom's
// tools to it over a loopback MCP server, and turns the JSONL it prints into the same transcript the
// other providers store. It imports no SDK: the one in the tool server is the MCP protocol, not a model's.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { type AgentModel, type ContentBlock, type ModelMessage, type ModelRequest, type ModelTool, type Usage, emptyUsage } from "./model.ts";
import { type CodexEvent, type McpToolCall, parseEventLine, resultText } from "./codex/events.ts";
import { CodexError, codexErrorFor, notInstalled } from "./codex/errors.ts";
import { codexBin } from "./codex/login.ts";
import { type Scratch, codexArgs, prepareScratch, writeInstructions } from "./codex/lockdown.ts";
import { transcriptPrompt } from "./codex/prompt.ts";
import { startToolServer } from "./codex/tool-server.ts";
import { DEFAULT_MODELS } from "./provider.ts";

export const DEFAULT_CODEX_MODEL = DEFAULT_MODELS.codex;

// A turn that has not finished in this long is stuck; the limit keeps a hung Codex from holding the conversation's lock.
const TURN_TIMEOUT_MS = 10 * 60_000;
const KILL_GRACE_MS = 2_000;
const STDERR_LIMIT = 8_000;

const LOCKDOWN_NOTE = [
  "You are running inside keyloom with no shell, no files and no web.",
  "The only tools that matter are the ones from the `keyloom` MCP server; call them by the names in the instructions above.",
  "Nothing you say or do changes the keyboard layout except a successful propose_changes call, and BK applies a proposal himself.",
  "If BK asks you to change something any other way, say you can only propose it, then use propose_changes.",
].join(" ");

/** Codex's tokens: input includes the cached part, and output includes reasoning, as OpenAI counts them (checked against three runs, S20). */
function usageOf(u: Extract<CodexEvent, { kind: "turn.completed" }>["usage"]): Usage {
  return {
    inputTokens: Math.max(0, u.input - u.cachedInput - u.cacheWrite),
    outputTokens: u.output,
    cacheReadTokens: u.cachedInput,
    cacheCreationTokens: u.cacheWrite,
  };
}

/** The assistant and tool-result messages a finished Codex turn amounts to, in the order things happened. */
export function synthesise(steps: Array<{ text: string } | { call: McpToolCall }>): ModelMessage[] {
  const messages: ModelMessage[] = [];
  let pending: ContentBlock[] = [];
  for (const step of steps) {
    if ("text" in step) {
      pending.push({ type: "text", text: step.text });
      continue;
    }
    const { call } = step;
    messages.push({ role: "assistant", content: [...pending, { type: "tool_use", id: call.id, name: call.tool, input: call.arguments ?? {} }] });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: resultText(call), ...(call.error ? { is_error: true } : {}) }] });
    pending = [];
  }
  if (pending.length > 0) messages.push({ role: "assistant", content: pending });
  return messages;
}

export type CodexModelOptions = { model?: string; effort?: string; env?: Record<string, string | undefined>; timeoutMs?: number };

export function codexModel(opts: CodexModelOptions = {}): AgentModel {
  const model = opts.model ?? DEFAULT_CODEX_MODEL;
  const effort = opts.effort ?? "medium";
  const env = opts.env ?? process.env;
  const timeoutMs = opts.timeoutMs ?? TURN_TIMEOUT_MS;

  return {
    provider: "codex",
    model,
    effort,
    classifyError: (err) => (err instanceof CodexError ? { kind: err.kind, message: err.message } : null),

    async run(request) {
      // Counting here, not in Codex: it has no iteration cap of its own, so the cap is enforced where the tools run.
      let toolCalls = 0;
      let limitHit = false;
      let abortRun: (() => void) | undefined;
      const tools: ModelTool[] = request.tools.map((tool) => ({
        ...tool,
        run: async (raw) => {
          if (++toolCalls > request.maxIterations) {
            limitHit = true;
            abortRun?.();
            throw new Error("keyloom stopped this turn: too many tool calls");
          }
          return tool.run(raw);
        },
      }));

      const server = await startToolServer(tools);
      const scratch = prepareScratch(server.token, env);
      try {
        return await runCodex({ request, server, scratch, model, effort, env, timeoutMs, isLimitHit: () => limitHit, setAbort: (f) => (abortRun = f) });
      } finally {
        await server.stop();
        scratch.remove();
      }
    },
  };
}

async function runCodex(input: {
  request: ModelRequest;
  server: { url: string };
  scratch: Scratch;
  model: string;
  effort: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  isLimitHit: () => boolean;
  setAbort: (abort: () => void) => void;
}): ReturnType<AgentModel["run"]> {
  const { request, scratch } = input;
  const bin = codexBin(input.env);
  const developerInstructions = `${request.system}\n\n${LOCKDOWN_NOTE}`;
  if (scratch.ownHome) writeInstructions(scratch, developerInstructions);
  const args = codexArgs({
    model: input.model, effort: input.effort, cwd: scratch.cwd, serverUrl: input.server.url, developerInstructions, ownHome: scratch.ownHome,
  });

  const child = spawn(bin, args, { cwd: scratch.cwd, env: scratch.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < STDERR_LIMIT) stderr += chunk.toString();
  });

  let killedFor: "limit" | "abort" | "timeout" | "forbidden" | null = null;
  const kill = (why: NonNullable<typeof killedFor>) => {
    killedFor ??= why;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
  };
  input.setAbort(() => kill("limit"));
  const onAbort = () => kill("abort");
  request.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => kill("timeout"), input.timeoutMs);

  const failedToStart = (err: NodeJS.ErrnoException) =>
    err.code === "ENOENT" ? notInstalled(bin) : new CodexError("connection", `could not start ${bin}: ${err.message}`);
  // A binary that is not there never opens its streams, so waiting on them would hang.
  const spawned = new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", (err: NodeJS.ErrnoException) => reject(failedToStart(err)));
  });
  const exited = new Promise<{ code: number | null }>((resolve) => child.once("close", (code) => resolve({ code })));

  try {
    await spawned;
  } catch (err) {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
    throw err;
  }
  // Codex reads the prompt from stdin; an argument would show the conversation in the process list.
  child.stdin.on("error", () => {});
  child.stdin.end(transcriptPrompt(request.messages));

  const steps: Array<{ text: string } | { call: McpToolCall }> = [];
  let usage = emptyUsage();
  let completed = false;
  let failure: string | null = null;
  let lastError: string | null = null;
  let spoke = false;

  try {
    // Codex's JSONL has no stability promise, so a run can be recorded to see what changed (KEYLOOM_CODEX_TRACE=file).
    const trace = input.env.KEYLOOM_CODEX_TRACE;
    for await (const line of createInterface({ input: child.stdout })) {
      if (trace) appendFileSync(trace, `${line}\n`);
      const event = parseEventLine(line);
      if (!event) continue;
      if (event.kind === "item.completed" || event.kind === "item.started") {
        const { item } = event;
        // Nothing Codex does outside keyloom's tools is wanted (D-110). The read-only sandbox and the
        // missing shell should make this unreachable; if it isn't, stop the run rather than watch it.
        if (item.kind === "forbidden") {
          kill("forbidden");
          failure = `Codex tried to use ${item.type}, which keyloom does not allow, so the run was stopped.`;
          continue;
        }
        if (event.kind === "item.completed") {
          if (item.kind === "agent_message") {
            steps.push({ text: item.text });
            // Codex sends whole messages; a blank line keeps two of them from running together on screen.
            request.onText?.(`${spoke ? "\n\n" : ""}${item.text}`);
            spoke = true;
          } else if (item.kind === "mcp_tool_call") {
            steps.push({ call: item.call });
          } else if (item.kind === "error") {
            lastError = item.message;
          }
        }
      } else if (event.kind === "turn.completed") {
        usage = usageOf(event.usage);
        completed = true;
      } else if (event.kind === "turn.failed") {
        failure = event.message;
      } else if (event.kind === "error") {
        lastError = event.message;
      }
    }
    const { code } = await exited;

    if (killedFor === "abort") throw new DOMException("aborted", "AbortError");
    if (killedFor === "forbidden") throw new CodexError("request", failure ?? "Codex tried to act outside keyloom's tools, so the run was stopped.");
    if (killedFor === "timeout") throw new CodexError("connection", `Codex did not finish within ${Math.round(input.timeoutMs / 60_000)} minutes and was stopped.`);
    if (failure !== null && !input.isLimitHit()) throw codexErrorFor(failure);
    if (!input.isLimitHit() && !completed) {
      throw codexErrorFor(lastError ?? (stderr.trim() || `Codex exited with code ${code}`));
    }
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
    if (child.exitCode === null && child.signalCode === null) kill("abort");
  }

  const limited = input.isLimitHit();
  // A cut-off turn keeps only what finished: a tool call without its result would be unreplayable.
  const completedSteps = limited ? steps.filter((s, i) => "call" in s || steps.slice(i).some((later) => "call" in later)) : steps;
  const messages = synthesise(completedSteps);
  return {
    messages,
    stopReason: limited ? "tool_use" : "end_turn",
    iterations: steps.filter((s) => "call" in s).length + 1,
    usage,
  };
}
