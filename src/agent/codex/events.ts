// The part of `codex exec --experimental-json` that keyloom reads. The flag name says the format may
// change, so each line is parsed defensively: an event or item of a kind keyloom doesn't know is
// kept as "other" instead of failing the turn.
import { z } from "zod";

const McpToolCallItem = z.object({
  type: z.literal("mcp_tool_call"),
  id: z.string(),
  server: z.string().optional(),
  tool: z.string(),
  arguments: z.unknown().optional(),
  result: z.object({ content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).optional() }).nullish(),
  error: z.object({ message: z.string() }).nullish(),
  status: z.string().optional(),
});

const AgentMessageItem = z.object({ type: z.literal("agent_message"), id: z.string(), text: z.string() });

/** Items that mean Codex tried to act outside keyloom's tools. None of them should ever appear (D-110). */
export const FORBIDDEN_ITEMS = ["command_execution", "file_change", "web_search"] as const;

export type McpToolCall = z.infer<typeof McpToolCallItem>;

export type CodexItem =
  | { kind: "agent_message"; id: string; text: string }
  | { kind: "mcp_tool_call"; call: McpToolCall }
  | { kind: "forbidden"; type: (typeof FORBIDDEN_ITEMS)[number] }
  | { kind: "error"; message: string }
  | { kind: "other"; type: string };

export type CodexEvent =
  | { kind: "item.started" | "item.completed"; item: CodexItem }
  | { kind: "turn.completed"; usage: CodexUsage }
  | { kind: "turn.failed"; message: string }
  | { kind: "error"; message: string }
  | { kind: "other"; type: string };

export type CodexUsage = { input: number; cachedInput: number; cacheWrite: number; output: number };

const Usage = z.object({
  input_tokens: z.number().default(0),
  cached_input_tokens: z.number().default(0),
  cache_write_input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
});

function parseItem(raw: unknown): CodexItem {
  const type = typeof raw === "object" && raw !== null && "type" in raw ? String((raw as { type: unknown }).type) : "unknown";
  if (type === "agent_message") {
    const parsed = AgentMessageItem.safeParse(raw);
    if (parsed.success) return { kind: "agent_message", id: parsed.data.id, text: parsed.data.text };
  }
  if (type === "mcp_tool_call") {
    const parsed = McpToolCallItem.safeParse(raw);
    if (parsed.success) return { kind: "mcp_tool_call", call: parsed.data };
  }
  if (type === "error") return { kind: "error", message: String((raw as { message?: unknown }).message ?? "") };
  if ((FORBIDDEN_ITEMS as readonly string[]).includes(type)) return { kind: "forbidden", type: type as (typeof FORBIDDEN_ITEMS)[number] };
  return { kind: "other", type };
}

/** One line of stdout. Null for a line that isn't a JSON object (Codex prints notices to the same stream when it can). */
export function parseEventLine(line: string): CodexEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || typeof (raw as { type?: unknown }).type !== "string") return null;
  const event = raw as { type: string; item?: unknown; usage?: unknown; error?: { message?: unknown }; message?: unknown };
  switch (event.type) {
    case "item.started":
    case "item.completed":
      return { kind: event.type, item: parseItem(event.item) };
    case "turn.completed": {
      const usage = Usage.safeParse(event.usage ?? {});
      const u = usage.success ? usage.data : Usage.parse({});
      return { kind: "turn.completed", usage: { input: u.input_tokens, cachedInput: u.cached_input_tokens, cacheWrite: u.cache_write_input_tokens, output: u.output_tokens } };
    }
    case "turn.failed":
      return { kind: "turn.failed", message: String(event.error?.message ?? "the turn failed") };
    case "error":
      return { kind: "error", message: String(event.message ?? "") };
    default:
      return { kind: "other", type: event.type };
  }
}

/** The text of an MCP result, which is what keyloom's tool returned. */
export function resultText(call: McpToolCall): string {
  if (call.error) return call.error.message;
  return (call.result?.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
}
