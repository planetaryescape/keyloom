// `keyloom decisions list|show|edit|retire|outcome|due|dismiss` (10#command-tree, 08).
import type { Command } from "commander";
import { Option } from "commander";
import {
  type DecisionRow, type DecisionStatus, UsageError, dismissOutcome, editDecision, listDecisions, outcomeQuestions, recordOutcome, retireDecision,
  showDecision,
} from "../../app/index.ts";
import { SCHEMA_VERSION, columns, print } from "../output.ts";
import type { CliContext } from "./context.ts";

const KINDS = ["choice", "priority"] as const;
const STATUSES = ["hypothesis", "tried_helpful", "tried_unhelpful", "superseded", "retired"] as const;

/** What the decision is about, in the layout grid's vocabulary: functions as `key:BACKSPACE`, slots as `layer-0:28`. */
const about = (d: DecisionRow): string =>
  [...(d.subject.functions ?? []), ...(d.subject.slots ?? []).map((s) => `${s.layerId}:${s.position}`)].join(", ");

const decisionJson = (d: DecisionRow) => ({
  id: d.id,
  layout_id: d.layoutId,
  kind: d.kind,
  priority_kind: d.priorityKind,
  subject: d.subject,
  goal: d.goal,
  choice: d.choice,
  reason: d.reason,
  scope: d.scope,
  status: d.status,
  outcome_note: d.outcomeNote,
  change_set_id: d.changeSetId,
  conversation_id: d.conversationId,
  source_message_ids: d.sourceMessageIds,
  superseded_by: d.supersededBy,
  outcome_asked_at: d.outcomeAskedAt,
  created_at: d.createdAt,
  updated_at: d.updatedAt,
});

const decisionTable = (d: DecisionRow): string =>
  [
    `${d.id}  ${d.kind}${d.priorityKind ? ` (${d.priorityKind})` : ""}  ${d.status}`,
    `about:  ${about(d)}`,
    `goal:   ${d.goal}`,
    `choice: ${d.choice}`,
    `reason: ${d.reason}`,
    ...(d.outcomeNote ? [`outcome: ${d.outcomeNote}`] : []),
    ...(d.status === "superseded" ? [`superseded by: ${d.supersededBy ?? "a change with no reason recorded"}`] : []),
    ...(d.conversationId ? [`from:   ${d.conversationId} ${d.sourceMessageIds.join(" ")}`.trimEnd()] : []),
  ].join("\n");

export function registerDecisionCommands(program: Command, ctx: CliContext): void {
  const decisions = program.command("decisions").description("what keyloom remembers about why keys are where they are, and what matters to you");

  decisions
    .command("list")
    .description("decisions for a layout, newest first; retired ones are included only with --status retired")
    .argument("<layout>", "layout ID or name")
    .addOption(new Option("--kind <kind>", "only this kind").choices(KINDS))
    .addOption(new Option("--status <status>", "only this status").choices(STATUSES))
    .action(async (ref: string, opts: { kind?: DecisionRow["kind"]; status?: DecisionStatus }) => {
      const rows = (await ctx.withApp((app) => listDecisions(app, ref, { ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.status ? { status: opts.status } : {}) }))).filter(
        (d) => opts.status !== undefined || d.status !== "retired",
      );
      print(ctx.io, ctx.format(), {
        json: { decisions: rows.map(decisionJson) },
        rows: rows.map((d) => ({ schema_version: SCHEMA_VERSION, ...decisionJson(d) })),
        ids: rows.map((d) => d.id),
        table: rows.length === 0
          ? "no decisions"
          : columns([["ID", "KIND", "STATUS", "ABOUT", "STATEMENT"], ...rows.map((d) => [d.id, d.priorityKind ?? d.kind, d.status, about(d), d.goal])]),
      });
    });

  decisions
    .command("show")
    .description("one decision in full")
    .argument("<decision>", "decision ID")
    .action(async (id: string) => {
      const d = await ctx.withApp((app) => showDecision(app, id));
      print(ctx.io, ctx.format(), { json: { decision: decisionJson(d) }, ids: [d.id], table: decisionTable(d) });
    });

  decisions
    .command("edit")
    .description("correct what a decision says")
    .argument("<decision>", "decision ID")
    .option("--goal <text>", "what BK said or wanted")
    .option("--choice <text>", "what was chosen")
    .option("--reason <text>", "why")
    .addOption(new Option("--status <status>", "set the status").choices(STATUSES))
    .action(async (id: string, opts: { goal?: string; choice?: string; reason?: string; status?: DecisionStatus }) => {
      if (opts.goal === undefined && opts.choice === undefined && opts.reason === undefined && opts.status === undefined) {
        throw new UsageError("nothing to change; pass --goal, --choice, --reason or --status");
      }
      const d = await ctx.withApp((app) =>
        editDecision(app, id, {
          ...(opts.goal === undefined ? {} : { goal: opts.goal }),
          ...(opts.choice === undefined ? {} : { choice: opts.choice }),
          ...(opts.reason === undefined ? {} : { reason: opts.reason }),
          ...(opts.status === undefined ? {} : { status: opts.status }),
        }),
      );
      print(ctx.io, ctx.format(), { json: { decision: decisionJson(d) }, ids: [d.id], table: decisionTable(d) });
    });

  decisions
    .command("retire")
    .description("stop using a decision: the agent no longer sees it and the validator no longer checks it; the record stays")
    .argument("<decision>", "decision ID")
    .action(async (id: string) => {
      const d = await ctx.withApp((app) => retireDecision(app, id));
      print(ctx.io, ctx.format(), { json: { decision_id: d.id, status: d.status }, ids: [d.id], table: `${d.id}\nretired` });
    });

  decisions
    .command("outcome")
    .description("record how a choice turned out, in your words; the agent quotes it before proposing to undo something that helped")
    .argument("<decision>", "decision ID")
    .addOption(new Option("--status <status>", "how it went").choices(["tried_helpful", "tried_unhelpful"]).makeOptionMandatory())
    .requiredOption("--note <text>", "what you noticed")
    .action(async (id: string, opts: { status: "tried_helpful" | "tried_unhelpful"; note: string }) => {
      const d = await ctx.withApp((app) => recordOutcome(app, id, { status: opts.status, note: opts.note }));
      print(ctx.io, ctx.format(), { json: { decision: decisionJson(d) }, ids: [d.id], table: decisionTable(d) });
    });

  decisions
    .command("due")
    .description("choices you have had on your keyboard for a week and not been asked about")
    .argument("<layout>", "layout ID or name")
    .option("--now <time>", "pretend it is this ISO time, to see what would be due then")
    .action(async (ref: string, opts: { now?: string }) => {
      const now = opts.now === undefined ? Date.now() : Date.parse(opts.now);
      if (Number.isNaN(now)) throw new UsageError(`--now must be a time such as 2026-11-01T09:00:00Z, got "${opts.now}"`);
      const due = await ctx.withApp((app) => outcomeQuestions(app, ref, now));
      print(ctx.io, ctx.format(), {
        json: { due: due.map((q) => ({ ...decisionJson(q.decision), flashed_at: q.flashedAt })) },
        ids: due.map((q) => q.decision.id),
        table: due.length === 0
          ? "nothing to ask about"
          : columns([["ID", "FLASHED", "CHOICE"], ...due.map((q) => [q.decision.id, new Date(q.flashedAt).toISOString(), q.decision.choice])]),
      });
    });

  decisions
    .command("dismiss")
    .description("stop asking whether a choice worked out; it stays a hypothesis")
    .argument("<decision>", "decision ID")
    .action(async (id: string) => {
      const d = await ctx.withApp((app) => dismissOutcome(app, id));
      print(ctx.io, ctx.format(), { json: { decision: decisionJson(d) }, ids: [d.id], table: `${d.id}\nwill not be asked about again` });
    });
}
