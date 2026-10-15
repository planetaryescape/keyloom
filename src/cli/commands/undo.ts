// `keyloom undo <layout> [--rev R]` (10#command-tree).
import type { Command } from "commander";
import { undo } from "../../app/index.ts";
import { print } from "../output.ts";
import type { CliContext } from "./context.ts";

export function registerUndo(program: Command, ctx: CliContext): void {
  program
    .command("undo")
    .description("undo the head revision as a new revision; prints the new revision ID. Exits 5 if --rev is not the head")
    .argument("<layout>", "layout ID or name")
    .option("--rev <revision>", "the revision you expect to be the head")
    .action(async (ref: string, opts: { rev?: string }) => {
      const out = await ctx.withApp((app) => undo(app, ref, opts.rev === undefined ? {} : { revisionId: opts.rev }));
      print(ctx.io, ctx.format(), {
        json: { revision_id: out.revision.id, undoes_revision_id: out.undoesRevisionId },
        ids: [out.revision.id],
        table: `${out.revision.id}\nundid ${out.undoesRevisionId}`,
      });
    });
}
