// `keyloom config` (25, 10#commands): a board's configs, which is on the keyboard, and making, renaming, archiving and deleting them.
// Thin: each calls one use case in src/app.
import type { Command } from "commander";
import {
  type ConfigView, type GeometryOptions, archiveConfig, deleteConfig, listConfigs, newBlankConfig, newConfig, newConfigFromImport, renameConfig, restoreConfig, UsageError,
} from "../../app/index.ts";
import { SCHEMA_VERSION, columns, print } from "../output.ts";
import { type SyncCommandDeps, syncAndPrint } from "./sync.ts";

export const configJson = (c: ConfigView) => ({
  id: c.id, name: c.name, board_id: c.boardId, board_name: c.boardName, head_revision_id: c.headRevisionId, created_at: c.createdAt, updated_at: c.updatedAt,
  on_keyboard: c.onKeyboard, archived_at: c.archivedAt,
  copied_from: c.copiedFrom && { layout_id: c.copiedFrom.layoutId, layout_name: c.copiedFrom.layoutName, revision_id: c.copiedFrom.revisionId },
});

const statusWords = (c: ConfigView): string => (c.archivedAt !== null ? "archived" : c.onKeyboard ? `on your ${c.boardName}` : "");

/** `firmware` is where a blank config's default keymap is read from; tests pass fixtures, otherwise the pinned tree on GitHub (D-370). */
export function registerConfigCommands(program: Command, deps: SyncCommandDeps, firmware: GeometryOptions = {}): void {
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
    .description("make a config: a copy of one (its head, a revision or a version), a blank one, or one from an exported file; it is not put on the keyboard")
    .argument("<name>", "the new config's name")
    .argument("[file]", "with --from import: the Oryx zip or folder, QMK keymap folder, ZMK .keymap, Karabiner json, or keyloom layout export to read")
    .option("--from <config>", "copy this config (ID or name), or `import` to read a file (needs --board and the file)")
    .option("--rev <revision>", "copy this revision of --from instead of its head")
    // Not --version: the program's own -V/--version flag would take it before this command saw it.
    .option("--from-version <version>", "copy the revision this version of --from names (ID or name)")
    .option("--blank", "start from the board's firmware default keymap where keyloom can get one, else an empty Base layer; needs --board")
    .option("--board <board>", "the board for --blank or --from import")
    .action(async (name: string, file: string | undefined, opts: { from?: string; rev?: string; fromVersion?: string; blank?: boolean; board?: string }) => {
      const importing = opts.from === "import";
      if (opts.blank && (opts.from !== undefined || opts.rev !== undefined || opts.fromVersion !== undefined)) throw new UsageError("--blank starts from nothing; leave out --from, --rev and --from-version");
      if (opts.blank && opts.board === undefined) throw new UsageError("--blank needs --board");
      if (!opts.blank && opts.from === undefined) throw new UsageError("say what to start from: --from <config>, --from import <file> --board <board>, or --blank --board <board>");
      if (importing && (opts.board === undefined || file === undefined)) throw new UsageError("--from import needs the file and --board: keyloom config new <name> --from import <file> --board <board>");
      if (importing && (opts.rev !== undefined || opts.fromVersion !== undefined)) throw new UsageError("--rev and --from-version copy a config; leave them out with --from import");
      if (!importing && file !== undefined) throw new UsageError("a file is only read with --from import");
      const made = await withApp(async (app) => {
        if (opts.blank) return newBlankConfig(app, { name, board: opts.board as string }, firmware);
        if (importing) {
          const out = await newConfigFromImport(app, { name, board: opts.board as string, source: file as string });
          return { config: out.config, note: `Imported ${out.report.layers} layers of ${out.report.keysPerLayer} keys from ${file}` };
        }
        return { config: newConfig(app, { name, from: "config", config: opts.from as string, ...(opts.rev === undefined ? {} : { revision: opts.rev }), ...(opts.fromVersion === undefined ? {} : { version: opts.fromVersion }) }) };
      });
      const c = made.config;
      const note = "note" in made ? made.note : undefined;
      print(io, format(), {
        json: { config: configJson(c), ...(note === undefined ? {} : { note }) },
        ids: [c.id],
        table: quiet() ? c.id : `${c.id}\n${c.name} on your ${c.boardName}${c.copiedFrom ? `, copied from ${c.copiedFrom.layoutName ?? c.copiedFrom.layoutId} at ${c.copiedFrom.revisionId}` : note === undefined ? "" : `. ${note}`}; not on the keyboard (keyloom config use "${c.name}")`,
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
