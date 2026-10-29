// `keyloom chat` and `keyloom conversations list` (10#command-tree).
import type { Command } from "commander";
import { createInterface } from "node:readline";
import {
  type AgentModel, type App, type ChatOutcome, type ConfigView, configsMadeInTurn, ModelError, PROVIDERS, type ProviderId, UsageError, isProviderId, listConversationSummaries, listLayouts, sendMessage, showConversation,
} from "../../app/index.ts";
import { SCHEMA_VERSION, columns, print } from "../output.ts";
import type { CliContext } from "./context.ts";
import { opLine } from "../change-report.ts";
import { answerAgentRun, cancelAgentRequest, cancelAgentRun, inspectAgentRun, startAgentRun, waitForAgentRun, savedRunOutcome, type AgentRunSnapshot } from "../../app/agent-runs.ts";

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

const configJson = (c: ConfigView) => ({ id: c.id, name: c.name, board_id: c.boardId, board_name: c.boardName });

const outcomeJson = (o: ChatOutcome, configs: readonly ConfigView[] = [], copySource?: ChatOutcome) => ({
  ...(copySource === undefined ? {} : { copy_source: { conversation_id: copySource.conversationId, model: copySource.model, usage: copySource.usage, ...(copySource.costUsd === undefined ? {} : { cost_usd: copySource.costUsd }) } }),
  conversation_id: o.conversationId,
  message_ids: o.messageIds,
  status: o.status,
  text: o.text,
  ...(o.question === undefined ? {} : { question: o.question }),
  ...(o.handoff === undefined ? {} : { handoff: o.handoff }),
  proposals: o.proposals.map(proposalJson),
  // Additive: the configs the agent made this turn (put_config, create_config). The web opens these; here they are named.
  configs_made: configs.map(configJson),
  priorities: o.priorities.map((p) => ({ id: p.id, priority_kind: p.priorityKind, statement: p.statement, subject: p.subject })),
  provider: o.provider,
  model: o.model,
  effort: o.effort,
  ...(o.costUsd === undefined ? {} : { cost_usd: o.costUsd }),
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
    ...(p.decisionDraft ? [`  remembers: ${p.decisionDraft.reason}`] : []),
    "  ops:",
    ...p.ops.map((o) => `    ${opLine(o)}`),
    `  apply with: keyloom change apply ${p.changeSetId}`,
  ].join("\n");
}

/** The CLI has no card to click, so a config the agent made is named with the commands that reach it. */
function madeConfigText(c: ConfigView): string {
  return [
    `made config "${c.name}" (${c.id}) on the ${c.boardName}`,
    `  its proposals: keyloom change list ${c.id}`,
    `  not on the keyboard until you run: keyloom config use ${c.id}`,
  ].join("\n");
}

const NOTICE: Partial<Record<ChatOutcome["status"], string>> = {
  truncated: "The reply was cut off at the model's output limit. Ask it to continue.",
  context_full: "The conversation no longer fits the model's context window. Start a new conversation.",
  iteration_limit: "The model kept calling tools and was stopped before it replied. Ask again, more specifically.",
};

/** `--provider`; a typo is a usage error here rather than a missing-credential error later. */
export function parseProvider(text: string): ProviderId {
  if (!isProviderId(text)) throw new UsageError(`--provider must be one of ${PROVIDERS.join(", ")}, got "${text}"`);
  return text;
}

export function registerChatCommands(program: Command, ctx: CliContext, deps: ChatDeps = {}): void {
  const agent = program.command("agent").description("saved agent work; inspection never replays it");
  const showRun = (run: AgentRunSnapshot) => print(ctx.io, ctx.format(), { json: run, ids: [run.id], table: `${run.id}: ${run.status}\nConversation ${run.conversationId}\n${run.committedPreparations} saved preparation(s)${run.cancelRequested ? "\nStop requested; preparation remains." : ""}${run.presentation?.warning ? `\n${run.presentation.warning}` : ""}${run.handoff ? `\nContinues on ${run.handoff.layoutId}, conversation ${run.handoff.conversationId}, run ${run.handoff.runId}` : ""}` });
  agent.command("show").argument("<id>", "run or request identity").action(async (id: string) => showRun(await ctx.withApp((app) => inspectAgentRun(app, id))));
  const showFinishedRun = async (app: App, run: AgentRunSnapshot) => {
    const finished = await waitForAgentRun(app, run.id);
    if (ctx.format() === "table") showRun(finished);
    if (finished.handoff) {
      const target = await waitForAgentRun(app, finished.handoff.runId);
      if (ctx.format() === "table") showRun(target);
      if (target.status === "waiting_user") {
        const question = savedRunOutcome(app, target.id).question;
        if (question && ctx.format() === "table") ctx.io.out(`\n${question.question}\n${question.options.map((option) => option.label).join(" / ")}\nAnswer with: keyloom agent answer ${target.id} ${question.toolUseId} <answer> --request-id <unique-id>\n`);
      }
    }
    if (ctx.format() !== "table") showRun(finished);
  };
  agent.command("cancel").argument("<id>").option("--request", "persist Stop for this request identity even before acceptance").action(async (id: string, opts: { request?: boolean }) => {
    const result = await ctx.withApp((app) => opts.request ? cancelAgentRequest(app, id) : cancelAgentRun(app, id));
    if (result.status === "pending_acceptance") print(ctx.io, ctx.format(), { json: result, ids: [], table: `Stop saved for request ${result.requestId}; no run has been accepted yet.` });
    else showRun(result);
  });
  agent.command("start").argument("<layout>").argument("<message>").requiredOption("--request-id <id>", "unique request identity; repeat only with identical input").option("--conversation <id>").option("--provider <provider>")
    .action(async (layoutRef: string, message: string, opts: { requestId: string; conversation?: string; provider?: string }) => {
      await ctx.withApp(async (app) => {
        const run = await startAgentRun(app, { version: 1, requestId: opts.requestId, layoutRef, input: { message, ...(opts.conversation ? { conversationId: opts.conversation } : {}) } }, { ...(deps.model ? { model: deps.model } : {}), ...(opts.provider ? { provider: parseProvider(opts.provider) } : {}) });
        await showFinishedRun(app, run);
      });
    });
  agent.command("answer").argument("<run>").argument("<question>").argument("<text>").requiredOption("--request-id <id>", "unique answer identity")
    .action(async (id: string, toolUseId: string, text: string, opts: { requestId: string }) => {
      await ctx.withApp(async (app) => {
        const run = await answerAgentRun(app, id, opts.requestId, { toolUseId, text }, deps.model ? { model: deps.model } : {});
        await showFinishedRun(app, run);
      });
    });
  program
    .command("chat")
    .description("talk to the agent about a layout; streams its reply and prints any proposals. Needs ANTHROPIC_API_KEY, OPENROUTER_API_KEY or a `codex login`")
    .argument("[layout]", "layout ID or name (optional when there is only one layout)")
    .argument("[message]", "one message; the same as --message")
    .option("--message <text>", "send one message and exit instead of starting an interactive chat")
    .option("--conversation <id>", "continue this conversation")
    .option("--select <layer:positions>", "keys selected on a layer, such as layer-0:29,30,31")
    .option("--provider <provider>", `model provider for a new conversation: ${PROVIDERS.join(", ")} (default: the config, then the first one with a credential)`)
    .action(async (layoutArg: string | undefined, positional: string | undefined, opts: { message?: string; conversation?: string; select?: string; provider?: string }) => {
      const oneShot = opts.message ?? positional;
      const select = opts.select === undefined ? undefined : parseSelect(opts.select);
      const provider = opts.provider === undefined ? undefined : parseProvider(opts.provider);
      const machine = ctx.format() !== "table";

      await ctx.withApp(async (app) => {
        let ref = layoutArg;
        if (ref === undefined) {
          const layouts = listLayouts(app);
          if (layouts.length !== 1) throw new UsageError(layouts.length === 0 ? "no layouts yet; import one first" : `name a layout: ${layouts.map((l) => l.name).join(", ")}`);
          ref = (layouts[0] as { id: string }).id;
        }
        let layoutRef: string = ref;
        let conversationId = opts.conversation;
        let pendingSelect = select;
        let last: ChatOutcome | undefined;
        let lastConfigs: ConfigView[] = [];
        let lastCopySource: ChatOutcome | undefined;

        const turn = async (message: string) => {
          let streamed = false;
          let outcome = await sendMessage(app, layoutRef, {
            message,
            ...(conversationId ? { conversationId } : {}),
            ...(pendingSelect ? { selection: pendingSelect } : {}),
            ...(deps.model ? { model: deps.model } : {}),
            ...(provider ? { provider } : {}),
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
          lastCopySource = undefined;
          const made = configsMadeInTurn(app, outcome.conversationId, outcome.messageIds[0] ?? "");
          if (outcome.handoff) {
            const handoff = outcome.handoff;
            lastCopySource = outcome;
            if (!machine) ctx.io.out(`\nContinuing on the copied config ${handoff.layoutId}.\n`);
            await waitForAgentRun(app, handoff.runId);
            outcome = savedRunOutcome(app, handoff.runId);
            layoutRef = handoff.layoutId;
            if (!machine && outcome.question) ctx.io.out(`\n${outcome.question.question}\n${outcome.question.options.map((option) => option.label).join(" / ")}\nAnswer with: keyloom agent answer ${handoff.runId} ${outcome.question.toolUseId} <answer> --request-id <unique-id>\n`);
          }
          pendingSelect = undefined;
          conversationId = outcome.conversationId;
          last = outcome;
          lastConfigs = [...made, ...configsMadeInTurn(app, outcome.conversationId, outcome.messageIds[0] ?? "")].filter((config, index, all) => all.findIndex((value) => value.id === config.id) === index);
          if (!machine) {
            if (streamed) ctx.io.out("\n");
            for (const p of outcome.priorities) ctx.io.err(`remembered ${p.id} (${p.priorityKind}): ${p.statement}\n`);
            for (const p of outcome.proposals) ctx.io.out(`\n${proposalText(p)}\n`);
            for (const c of lastConfigs) ctx.io.out(`\n${madeConfigText(c)}\n`);
            const notice = NOTICE[outcome.status];
            if (notice) ctx.io.err(`${notice}\n`);
            if (outcome.status === "refused") ctx.io.err("The model declined to answer.\n");
          }
          if (outcome.status === "refused") {
            if (machine) print(ctx.io, ctx.format(), { json: outcomeJson(outcome, lastConfigs), table: "" });
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
        if (machine) print(ctx.io, ctx.format(), { json: outcomeJson(last, lastConfigs, lastCopySource), table: "", ids: [last.conversationId] });
        else ctx.io.err(`conversation ${last.conversationId}\n`);
      });
    });

  const conversations = program.command("conversations").description("agent conversations about a layout");
  conversations.command("show")
    .description("read a conversation and its saved working details; never reruns the agent")
    .argument("<id>", "conversation ID")
    .action(async (id: string) => {
      const view = await ctx.withApp((app) => showConversation(app, id));
      const working = view.presentations.flatMap((p) => [
        `Work ${p.userMessageId}: ${p.status}`,
        ...p.operations.map((o) => `  ${o.label}: ${o.status} (${o.durationMs} ms)${o.validationCodes.length ? ` [${o.validationCodes.join(", ")}]` : ""}`),
        ...(p.warning ? [`  ${p.warning}`] : []),
        ...(p.detailsTruncated ? ["  Some working details were truncated."] : []),
      ]);
      print(ctx.io, ctx.format(), {
        json: view,
        ids: [view.conversation.id],
        table: [view.conversation.title, ...view.messages.filter((m) => m.text).map((m) => `${m.role}: ${m.text}`), ...(working.length ? working : ["Working details unavailable for this older conversation."])].join("\n"),
      });
    });
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
