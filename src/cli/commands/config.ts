// `keyloom config` (25, 10#commands): a board's configs, which is on the keyboard, and making, renaming, archiving and deleting them.
// Thin: each calls one use case in src/app.
import type { Command } from "commander";
import {
  type ConfigView, archiveConfig, deleteConfig, listConfigs, newConfig, renameConfig, restoreConfig, UsageError,
} from "../../app/index.ts";
import { SCHEMA_VERSION, columns, print } from "../output.ts";
import { type SyncCommandDeps, syncAndPrint } from "./sync.ts";

export const configJson = (c: ConfigView) => ({
  id: c.id, name: c.name, board_id: c.boardId, board_name: c.boardName, head_revision_id: c.headRevisionId, created_at: c.createdAt, updated_at: c.updatedAt,
  on_keyboard: c.onKeyboard, archived_at: c.archivedAt,
  copied_from: c.copiedFrom && { layout_id: c.copiedFrom.layoutId, layout_name: c.copiedFrom.layoutName, revision_id: c.copiedFrom.revisionId },
});

const statusWords = (c: ConfigView): string => (c.archivedAt !== null ? "archived" : c.onKeyboard ? `on your ${c.boardName}` : "");

export function registerConfigCommands(program: Command, deps: SyncCommandDeps): void {
  const { io, format, quiet, withApp } = deps;
  const config = program.command("config").description("configs: the layouts you keep for a board, and which one is on its keyboard");

  config
    .command("list")
    .description("a board's configs, newest edited first, marking the one on the keyboard")
    .option("--board <board>", "only this board, such as zsa/moonlander")
    .option("--archived", "include archived configs")
    .action(async (opts: { board?: string; archived?: boolean }) => {
      const rows = await withApp((app) => listConfigs(app, { ...(opts.board === undefined ? {} : { board: opts.board }), ...(opts.archived ? { includeArchived: true } : {}) }));
      print(io, format(), {
        json: { configs: rows.map(configJson) },
        rows: rows.map((c) => ({ schema_version: SCHEMA_VERSION, ...configJson(c) })),
        ids: rows.map((c) => c.id),
        table: rows.length === 0
          ? "no configs yet; import one with: keyloom import --board <board> <file>"
          : columns([["ID", "NAME", "BOARD", "STATUS", "UPDATED"], ...rows.map((c) => [c.id, c.name, c.boardId, statusWords(c), new Date(c.updatedAt).toISOString()])]),
      });
    });

  config
    .command("new")
    .description("make a config: a copy of one (its head, a revision or a version) or a blank one; it is not put on the keyboard")
    .argument("<name>", "the new config's name")
    .option("--from <config>", "copy this config (ID or name)")
    .option("--rev <revision>", "copy this revision of --from instead of its head")
    // Not --version: the program's own -V/--version flag would take it before this command saw it.
    .option("--from-version <version>", "copy the revision this version of --from names (ID or name)")
    .option("--blank", "start from the board's blank instead of a copy; needs --board")
    .option("--board <board>", "the board for --blank")
    .action(async (name: string, opts: { from?: string; rev?: string; fromVersion?: string; blank?: boolean; board?: string }) => {
      if (opts.blank && (opts.from !== undefined || opts.rev !== undefined || opts.fromVersion !== undefined)) throw new UsageError("--blank starts from nothing; leave out --from, --rev and --from-version");
      if (opts.blank && opts.board === undefined) throw new UsageError("--blank needs --board");
      if (!opts.blank && opts.from === undefined) throw new UsageError("say what to start from: --from <config> or --blank --board <board>");
      const made = await withApp((app) =>
        opts.blank
          ? newConfig(app, { name, from: "blank", board: opts.board as string })
          : newConfig(app, { name, from: "config", config: opts.from as string, ...(opts.rev === undefined ? {} : { revision: opts.rev }), ...(opts.fromVersion === undefined ? {} : { version: opts.fromVersion }) }),
      );
      print(io, format(), {
        json: { config: configJson(made) },
        ids: [made.id],
        table: quiet() ? made.id : `${made.id}\n${made.name} on your ${made.boardName}${made.copiedFrom ? `, copied from ${made.copiedFrom.layoutName ?? made.copiedFrom.layoutId} at ${made.copiedFrom.revisionId}` : ", blank"}; not on the keyboard (keyloom config use "${made.name}")`,
      });
    });

  config
    .command("rename")
    .description("rename a config")
    .argument("<config>", "config ID or name")
    .argument("<name>", "the new name")
    .action(async (ref: string, name: string) => {
      const c = await withApp((app) => renameConfig(app, ref, name));
      print(io, format(), { json: { config: configJson(c) }, ids: [c.id], table: quiet() ? c.id : `${c.id}\nrenamed to ${c.name}` });
    });

  config
    .command("archive")
    .description("hide a config but keep it (not the one on the keyboard); `restore` brings it back")
    .argument("<config>", "config ID or name")
    .action(async (ref: string) => {
      const c = await withApp((app) => archiveConfig(app, ref));
      print(io, format(), { json: { config: configJson(c) }, ids: [c.id], table: quiet() ? c.id : `${c.id}\narchived ${c.name}` });
    });

  config
    .command("restore")
    .description("bring an archived config back")
    .argument("<config>", "config ID or name")
    .action(async (ref: string) => {
      const c = await withApp((app) => restoreConfig(app, ref));
      print(io, format(), { json: { config: configJson(c) }, ids: [c.id], table: quiet() ? c.id : `${c.id}\nrestored ${c.name}` });
    });

  config
    .command("delete")
    .description("delete a config and its history for good; type its name again to confirm. Refuses the one on the keyboard")
    .argument("<config>", "config ID or name")
    .argument("<name>", "the config's name, typed again")
    .action(async (ref: string, typed: string) => {
      const gone = await withApp((app) => deleteConfig(app, ref, typed));
      print(io, format(), { json: { deleted: { id: gone.id, name: gone.name } }, ids: [gone.id], table: quiet() ? gone.id : `deleted ${gone.name} (${gone.id})` });
    });

  config
    .command("use")
    .description("put a config on its board's keyboard: makes it the one on the keyboard, then syncs it once (same checks and exit codes as `keyloom sync`)")
    .argument("<config>", "config ID or name")
    .option("--wait", "if a sync is already running (the server's), wait for it to end first instead of refusing")
    .action((ref: string, opts: { wait?: boolean }) => syncAndPrint(deps, ref, { ...opts, put: true }));
}
