// One agent turn (03#the-loop-for-one-message): assemble the prompt, give the model the tools,
// let it loop, then decide from its stop reason what is safe to keep. Persistence and logging
// belong to the caller; this module only reports what happened.
import type { AgentModel, ModelMessage, ModelTool, Usage } from "./model.ts";
import { assembleSystemPrompt } from "./prompt.ts";
import type { AgentPorts, ProposalResult, RecordedPriority } from "./ports.ts";
import { type ToolCallTrace, TurnRecorder, type ValidationFailureTrace } from "./recorder.ts";
import { createTools } from "./tools/index.ts";

export const DEFAULT_MAX_ITERATIONS = 12;

/**
 * - `complete`: the model finished (possibly with a question for BK).
 * - `refused`: the model declined, even after the server-side fallback.
 * - `truncated`: it hit max_tokens mid-reply.
 * - `context_full`: the conversation no longer fits the context window.
 * - `iteration_limit`: it still wanted tools after `maxIterations` requests.
 */
export type TurnStatus = "complete" | "refused" | "truncated" | "context_full" | "iteration_limit";

export type AgentCallbacks = {
  onText?: (delta: string) => void;
  onToolCall?: (name: string) => void;
  onProposal?: (proposal: ProposalResult) => void;
  /** A priority BK stated that was stored by this call; not called again for one already known. */
  onPriority?: (priority: RecordedPriority) => void;
};

export type TurnOutcome = {
  status: TurnStatus;
  stopReason: string;
  /** The messages to store: what the loop added, minus any final message that would make the history unresumable. */
  messages: ModelMessage[];
  /** The text of the last assistant message kept. */
  text: string;
  proposals: ProposalResult[];
  priorities: RecordedPriority[];
  usage: Usage;
  costUsd?: number;
  iterations: number;
  toolCalls: ToolCallTrace[];
  validationFailures: ValidationFailureTrace[];
};

/** Consecutive user messages (a tool result, then BK's reply) are one turn to the API; merging keeps stored history untouched. */
export function mergeConsecutiveUsers(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (last && last.role === "user" && m.role === "user") out[out.length - 1] = { role: "user", content: [...last.content, ...m.content] };
    else out.push({ role: m.role, content: [...m.content] });
  }
  return out;
}

const textOf = (m: ModelMessage | undefined): string =>
  (m?.content ?? []).flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : [])).join("");

const hasToolUse = (m: ModelMessage) => m.content.some((b) => b.type === "tool_use");

/** Times each tool call and records it; a throw is rethrown after being recorded, for the runner to turn into an error result. */
function instrument(tools: ModelTool[], recorder: TurnRecorder, onToolCall?: (name: string) => void): ModelTool[] {
  return tools.map((tool) => ({
    ...tool,
    run: async (raw) => {
      onToolCall?.(tool.name);
      const started = performance.now();
      try {
        const out = await tool.run(raw);
        recorder.toolCalls.push({ name: tool.name, durationMs: Math.round(performance.now() - started), ok: true });
        return out;
      } catch (err) {
        recorder.toolCalls.push({ name: tool.name, durationMs: Math.round(performance.now() - started), ok: false });
        throw err;
      }
    },
  }));
}

function classify(stopReason: string): TurnStatus {
  switch (stopReason) {
    case "refusal": return "refused";
    case "max_tokens": return "truncated";
    case "model_context_window_exceeded": return "context_full";
    case "tool_use": return "iteration_limit";
    default: return "complete";
  }
}

/**
 * What to keep when a turn did not finish cleanly. A refused reply is dropped, so the next message
 * isn't answered from a history that ends in a refusal. A reply cut off mid-tool-call is dropped,
 * because a `tool_use` with no `tool_result` is a 400 on resume. A cut-off text reply stays: it is
 * what BK saw.
 */
function resumable(messages: ModelMessage[], status: TurnStatus): ModelMessage[] {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return messages;
  if (status === "refused" || ((status === "truncated" || status === "context_full") && hasToolUse(last))) return messages.slice(0, -1);
  return messages;
}

export async function runAgentTurn(input: {
  model: AgentModel;
  ports: AgentPorts;
  /** Stored messages plus BK's new one, last. */
  history: ModelMessage[];
  maxIterations?: number;
  callbacks?: AgentCallbacks;
  signal?: AbortSignal;
}): Promise<TurnOutcome> {
  const { model, ports, callbacks = {} } = input;
  const recorder = new TurnRecorder();
  const proposals: ProposalResult[] = [];
  const priorities: RecordedPriority[] = [];
  const tools = instrument(
    createTools(ports, recorder, {
      onProposal: (p) => {
        proposals.push(p);
        callbacks.onProposal?.(p);
      },
      onPriority: (p) => {
        priorities.push(p);
        callbacks.onPriority?.(p);
      },
    }),
    recorder,
    callbacks.onToolCall,
  );

  const snapshot = ports.snapshot();
  const result = await model.run({
    system: assembleSystemPrompt(snapshot.board, snapshot.document, ports.priorities(), ports.choices()),
    messages: mergeConsecutiveUsers(input.history),
    tools,
    maxIterations: input.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    ...(callbacks.onText ? { onText: callbacks.onText } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const status = classify(result.stopReason);
  const messages = resumable(result.messages, status);
  return {
    status,
    stopReason: result.stopReason,
    messages,
    text: messages.at(-1)?.role === "assistant" ? textOf(messages.at(-1)) : "",
    proposals,
    priorities,
    usage: result.usage,
    ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
    iterations: result.iterations,
    toolCalls: recorder.toolCalls,
    validationFailures: recorder.validationFailures,
  };
}
