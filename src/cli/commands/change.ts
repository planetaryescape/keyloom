// `keyloom change check|propose|list|show|apply|reject` (10#command-tree).
import type { Command } from "commander";
import { Option } from "commander";
import {
  type ChangeSetStatus, ValidationFailedError, applyChange, checkChange, editorDraft, listChanges, proposeChange, rejectChange,
  showChange,
} from "../../app/index.ts";
import { changeSetJson, changeSetTable, validationTable } from "../change-report.ts";
import { SCHEMA_VERSION, columns, print } from "../output.ts";
import { readOps } from "../ops-input.ts";
import type { CliContext } from "./context.ts";
import { registerUndo } from "./undo.ts";

/** A refused change prints its validation to stdout first, as `boards check` does, then exits 4. */
export async function printingValidationFailure<T>(ctx: CliContext, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ValidationFailedError) {
      const validation = err.details as Parameters<typeof validationTable>[0];
      print(ctx.io, ctx.format(), { json: { ok: false, validation }, table: validationTable(validation) });
    }
    throw err;
  }
}

const STATUSES = ["proposed", "applied", "rejected", "superseded"] as const;

export function registerChangeCommands(program: Command, ctx: CliContext): void {
  const change = program.command("change").description("check, propose and apply changes to a layout");

  change
    .command("check")
    .description("validate ops against the head without saving anything; exits 4 if they are invalid")
    .argument("<layout>", "layout ID or name")
    .requiredOption("--ops <file>", "JSON ops, or - for stdin")
    .option("--base <revision>", "the revision the ops were written against (default: the head)")
    .action(async (ref: string, opts: { ops: string; base?: string }) => {
      const ops = await readOps(opts.ops);
      const validation = await ctx.withApp((app) => checkChange(app, ref, { ops, ...(opts.base === undefined ? {} : { baseRevisionId: opts.base }) }));
      print(ctx.io, ctx.format(), { json: { ok: validation.ok, validation }, table: validationTable(validation) });
      if (!validation.ok) throw new ValidationFailedError(`${validation.errors.length} validation error${validation.errors.length === 1 ? "" : "s"}`, validation);
    });

  change
    .command("propose")
    .description("save a valid change set against the head; prints its ID")
    .argument("<layout>", "layout ID or name")
    .requiredOption("--ops <file>", "JSON ops, or - for stdin")
    .requiredOption("--explain <text>", "why, in one line; it becomes the revision summary")
    .option("--reason <text>", "why you want this, to remember: applying it writes a decision that later changes to these keys bring up")
    .action(async (ref: string, opts: { ops: string; explain: string; reason?: string }) => {
      const ops = await readOps(opts.ops);
      const draft = editorDraft(opts.explain, opts.reason);
      const cs = await printingValidationFailure(ctx, () =>
        ctx.withApp((app) => proposeChange(app, ref, { ops, explanation: opts.explain, source: "editor", ...(draft ? { decisionDraft: draft } : {}) })),
      );
      print(ctx.io, ctx.format(), { json: { change_set_id: cs.id, change_set: changeSetJson(cs) }, ids: [cs.id], table: changeSetTable(cs) });
    });

  change
    .command("list")
    .description("change sets for a layout, newest first")
    .argument("<layout>", "layout ID or name")
    .addOption(new Option("--status <status>", "only change sets in this state").choices(STATUSES))
    .action(async (ref: string, opts: { status?: ChangeSetStatus }) => {
      const rows = await ctx.withApp((app) => listChanges(app, ref, opts.status === undefined ? {} : { status: opts.status }));
      print(ctx.io, ctx.format(), {
        json: { change_sets: rows.map(changeSetJson) },
        rows: rows.map((r) => ({ schema_version: SCHEMA_VERSION, ...changeSetJson(r) })),
        ids: rows.map((r) => r.id),
        table: rows.length === 0
          ? "no change sets"
          : columns([["ID", "STATUS", "SOURCE", "CREATED", "EXPLANATION"], ...rows.map((r) => [r.id, r.status, r.source, new Date(r.createdAt).toISOString(), r.explanation])]),
      });
    });

  change
    .command("show")
    .description("ops, explanation and validation of a change set")
    .argument("<change-set>", "change set ID")
    .action(async (id: string) => {
      const cs = await ctx.withApp((app) => showChange(app, id));
      print(ctx.io, ctx.format(), { json: { change_set: changeSetJson(cs) }, ids: [cs.id], table: changeSetTable(cs) });
    });

  change
    .command("apply")
    .description("apply a proposed change set to the head; prints the new revision ID. Exits 5 if the head moved under it, 4 if it no longer validates")
    .argument("<change-set>", "change set ID")
    .action(async (id: string) => {
      const out = await printingValidationFailure(ctx, () => ctx.withApp((app) => applyChange(app, id)));
      print(ctx.io, ctx.format(), {
        json: { revision_id: out.revisionId, change_set_id: out.changeSetId, decision_id: out.decisionId, validation: out.validation },
        ids: [out.revisionId],
        table: `${out.revisionId}\napplied ${out.changeSetId}${out.decisionId ? `\nremembered as ${out.decisionId}` : ""}\n${validationTable(out.validation)}`,
      });
    });

  change
    .command("reject")
    .description("reject a proposed change set")
    .argument("<change-set>", "change set ID")
    .action(async (id: string) => {
      const cs = await ctx.withApp((app) => rejectChange(app, id));
      print(ctx.io, ctx.format(), { json: { change_set_id: cs.id, status: cs.status }, ids: [cs.id], table: `${cs.id}\nrejected` });
    });

  registerUndo(program, ctx);
}
