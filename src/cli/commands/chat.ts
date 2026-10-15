// `keyloom chat` and `keyloom conversations list` (10#command-tree).
import type { Command } from "commander";
import { createInterface } from "node:readline";
import {
  type AgentModel, type ChatOutcome, ModelError, UsageError, listConversationSummaries, listLayouts, sendMessage,
} from "../../app/index.ts";
import { SCHEMA_VERSION, columns, print } from "../output.ts";
import type { CliContext } from "./context.ts";
import { opLine } from "../change-report.ts";

/** Seams for tests: a scripted model, and lines to read instead of stdin. */
export type ChatDeps = { model?: AgentModel; lines?: AsyncIterable<string> };

/** `layer:12,13,14` where layer is an ID, index or name; the last colon splits, so a layer name may contain one. */
export function parseSelect(text: string): { layer: string; positions: number[] } {
  const at = text.lastIndexOf(":");
  const layer = at < 0 ? "" : text.slice(0, at).trim();
  const positions = (at < 0 ? [] : text.slice(at + 1).split(",")).map((p) => p.trim()).filter(Boolean).map(Number);
  if (!layer || positions.length === 0 || positions.some((p) => !Number.isInteger(p) || p < 0)) {
    throw new UsageError(`--select must look like layer-0:29,30,31 (a layer, a colon, then key positions), got "${text}"`);
  }
  return { layer, positions };
}

const proposalJson = (p: ChatOutcome["proposals"][number]) => ({ change_set_id: p.changeSetId, title: p.title, validation: p.validation });

const outcomeJson = (o: ChatOutcome) => ({
  conversation_id: o.conversationId,
  message_ids: o.messageIds,
  status: o.status,
  text: o.text,
  proposals: o.proposals.map(proposalJson),
  model: o.model,
  effort: o.effort,
  usage: {
    input_tokens: o.usage.inputTokens, output_tokens: o.usage.outputTokens,
    cache_read_input_tokens: o.usage.cacheReadTokens, cache_creation_input_tokens: o.usage.cacheCreationTokens,
  },
});

function proposalText(p: ChatOutcome["proposals"][number]): string {
  const list = (label: string, items: string[]) => (items.length ? [`  ${label}:`, ...items.map((i) => `    - ${i}`)] : []);
  const warnings = p.validation.warnings.length ? [`  warnings: ${p.validation.warnings.map((w) => `${w.code}: ${w.message}`).join("; ")}`] : [];
  return [
    `${p.changeSetId}  ${p.title}`,
    `  ${p.explanation}`,
    ...list("gains", p.tradeoffs.gains),
    ...list("costs", p.tradeoffs.costs),
    ...warnings,
    "  ops:",
    ...p.ops.map((o) => `    ${opLine(o)}`),
    `  apply with: keyloom change apply ${p.changeSetId}`,
  ].join("\n");
}

const NOTICE: Partial<Record<ChatOutcome["status"], string>> = {
  truncated: "The reply was cut off at the model's output limit. Ask it to continue.",
  context_full: "The conversation no longer fits the model's context window. Start a new conversation.",
  iteration_limit: "The model kept calling tools and was stopped before it replied. Ask again, more specifically.",
};

export function registerChatCommands(program: Command, ctx: CliContext, deps: ChatDeps = {}): void {
  program
    .command("chat")
    .description("talk to the agent about a layout; streams its reply and prints any proposals. Needs ANTHROPIC_API_KEY")
    .argument("[layout]", "layout ID or name (optional when there is only one layout)")
    .argument("[message]", "one message; the same as --message")
    .option("--message <text>", "send one message and exit instead of starting an interactive chat")
    .option("--conversation <id>", "continue this conversation")
    .option("--select <layer:positions>", "keys selected on a layer, such as layer-0:29,30,31")
    .action(async (layoutArg: string | undefined, positional: string | undefined, opts: { message?: string; conversation?: string; select?: string }) => {
      const oneShot = opts.message ?? positional;
      const select = opts.select === undefined ? undefined : parseSelect(opts.select);
      const machine = ctx.format() !== "table";

      await ctx.withApp(async (app) => {
        let ref = layoutArg;
        if (ref === undefined) {
          const layouts = listLayouts(app);
          if (layouts.length !== 1) throw new UsageError(layouts.length === 0 ? "no layouts yet; import one first" : `name a layout: ${layouts.map((l) => l.name).join(", ")}`);
          ref = (layouts[0] as { id: string }).id;
        }
        const layoutRef: string = ref;
        let conversationId = opts.conversation;
        let pendingSelect = select;
        let last: ChatOutcome | undefined;

        const turn = async (message: string) => {
          let streamed = false;
          const outcome = await sendMessage(app, layoutRef, {
            message,
            ...(conversationId ? { conversationId } : {}),
            ...(pendingSelect ? { selection: pendingSelect } : {}),
            ...(deps.model ? { model: deps.model } : {}),
            onEvent: (e) => {
              if (machine) return;
              if (e.type === "text") {
                streamed = true;
                ctx.io.out(e.delta);
              } else if (e.type === "tool") {
                ctx.io.err(`[${e.name}]\n`);
              }
            },
          });
          pendingSelect = undefined;
          conversationId = outcome.conversationId;
          last = outcome;
          if (!machine) {
            if (streamed) ctx.io.out("\n");
            for (const p of outcome.proposals) ctx.io.out(`\n${proposalText(p)}\n`);
            const notice = NOTICE[outcome.status];
            if (notice) ctx.io.err(`${notice}\n`);
            if (outcome.status === "refused") ctx.io.err("The model declined to answer.\n");
          }
          if (outcome.status === "refused") {
            if (machine) print(ctx.io, ctx.format(), { json: outcomeJson(outcome), table: "" });
            throw new ModelError("refused", "the model declined to answer, even after the fallback; rephrase and try again");
          }
        };

        if (oneShot !== undefined) {
          await turn(oneShot);
        } else {
          ctx.io.err("keyloom chat: type a message, or an empty line / Ctrl-D to stop.\n");
          const lines = deps.lines ?? (createInterface({ input: process.stdin }) as unknown as AsyncIterable<string>);
          for await (const line of lines) {
            if (line.trim() === "") break;
            await turn(line);
          }
        }

        if (last === undefined) return;
        if (machine) print(ctx.io, ctx.format(), { json: outcomeJson(last), table: "", ids: [last.conversationId] });
        else ctx.io.err(`conversation ${last.conversationId}\n`);
      });
    });

  const conversations = program.command("conversations").description("agent conversations about a layout");
  conversations
    .command("list")
    .description("conversations for a layout, newest first")
    .argument("<layout>", "layout ID or name")
    .action(async (ref: string) => {
      const rows = await ctx.withApp((app) => listConversationSummaries(app, ref));
      const json = (r: (typeof rows)[number]) => ({ id: r.id, layout_id: r.layoutId, title: r.title, created_at: r.createdAt });
      print(ctx.io, ctx.format(), {
        json: { conversations: rows.map(json) },
        rows: rows.map((r) => ({ schema_version: SCHEMA_VERSION, ...json(r) })),
        ids: rows.map((r) => r.id),
        table: rows.length === 0 ? "no conversations" : columns([["ID", "CREATED", "TITLE"], ...rows.map((r) => [r.id, new Date(r.createdAt).toISOString(), r.title])]),
      });
    });
}
