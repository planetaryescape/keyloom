#!/usr/bin/env bun
// keyloom CLI (10). Every command is a thin call into src/app.
import { Command, CommanderError, Option } from "commander";
import {
  type App, type ImportOutcome, closeApp, checkBoard, getLayout, importLayout, listBoardDefinitions, listLayouts, openApp,
  regenerateGeometry, renderLayoutText, renderPositionGrid, runDoctor, showBoard, ValidationFailedError,
} from "../app/index.ts";
import { EXIT, classify } from "./errors.ts";
import { FORMATS, type Format, type Io, SCHEMA_VERSION, columns, defaultFormat, print } from "./output.ts";
import { importTable } from "./report.ts";

const stdIo = (): Io => ({
  out: (t) => void process.stdout.write(t),
  err: (t) => void process.stderr.write(t),
  isTTY: Boolean(process.stdout.isTTY),
});

type Globals = { format?: Format; dataDir?: string; quiet?: boolean; verbose?: boolean };

export function buildProgram(io: Io, state: { exitCode: number; dataDir: string }): Command {
  const program = new Command("keyloom")
    .description("Local-first keyboard configurator for QMK and ZMK boards")
    .addOption(new Option("--format <format>", "output format (default: table on a TTY, json otherwise)").choices(FORMATS))
    .option("--data-dir <path>", "use this directory instead of $XDG_DATA_HOME/keyloom")
    .option("--quiet", "print only what was asked for")
    .option("--verbose", "print where data is read from")
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });

  const globals = (): Globals => program.opts<Globals>();
  const format = (): Format => globals().format ?? defaultFormat(io);

  /** Opens the database for one command and closes it afterwards, even on error. */
  async function withApp<T>(fn: (app: App) => Promise<T> | T): Promise<T> {
    const opts = globals();
    const app = openApp(opts.dataDir === undefined ? {} : { dataDir: opts.dataDir });
    state.dataDir = app.dataDir;
    if (opts.verbose) io.err(`data directory: ${app.dataDir}\n`);
    try {
      return await fn(app);
    } finally {
      closeApp(app);
    }
  }

  program
    .command("import")
    .description("import an existing layout; prints the new layout ID and an import report")
    .requiredOption("--board <board>", "board ID, such as zsa/moonlander")
    .argument("<file>", "Oryx source zip, or the folder it unpacks to")
    .option("--name <name>", "layout name (default: taken from the source)")
    .action(async (file: string, opts: { board: string; name?: string }) => {
      const outcome: ImportOutcome = await withApp((app) =>
        importLayout(app, { board: opts.board, source: file, ...(opts.name === undefined ? {} : { name: opts.name }) }),
      );
      const quiet = globals().quiet === true;
      print(io, format(), {
        json: { layout_id: outcome.layoutId, revision_id: outcome.revisionId, name: outcome.name, report: outcome.report },
        table: quiet ? outcome.layoutId : importTable(outcome),
        ids: [outcome.layoutId],
      });
    });

  const layout = program.command("layout").description("saved layouts");

  layout
    .command("list")
    .description("list saved layouts")
    .action(async () => {
      const rows = await withApp((app) => listLayouts(app));
      print(io, format(), {
        json: { layouts: rows.map(layoutJson) },
        rows: rows.map((r) => ({ schema_version: SCHEMA_VERSION, ...layoutJson(r) })),
        ids: rows.map((r) => r.id),
        table:
          rows.length === 0
            ? "no layouts yet; import one with: keyloom import --board <board> <file>"
            : columns([["ID", "NAME", "BOARD", "UPDATED"], ...rows.map((r) => [r.id, r.name, r.boardId, new Date(r.updatedAt).toISOString()])]),
      });
    });

  layout
    .command("show")
    .description("print every layer as a grid shaped like the keyboard, or the IR with --format json")
    .argument("<layout>", "layout ID or name")
    .option("--layer <layer>", "only this layer (ID, index or name)")
    .option("--rev <revision>", "a revision ID instead of the head")
    .action(async (ref: string, opts: { layer?: string; rev?: string }) => {
      const view = await withApp((app) => getLayout(app, ref, opts.rev));
      const grids = renderLayoutText(view, opts.layer);
      const only = opts.layer === undefined ? view.document.layers : view.document.layers.filter((l, i) => [l.id, l.name, String(i)].includes(opts.layer as string));
      print(io, format(), {
        json: {
          layout_id: view.layout.id,
          name: view.layout.name,
          board_id: view.layout.boardId,
          revision_id: view.revision.id,
          layout: { ...view.document, layers: only },
        },
        ids: [view.layout.id],
        table: `${view.layout.id}  ${view.layout.name}  ${view.layout.boardId}  ${view.revision.id}\n\n${grids}`,
      });
    });

  const boards = program.command("boards").description("board definitions");

  boards
    .command("list")
    .description("boards keyloom has definitions for")
    .action(() => {
      const list = listBoardDefinitions();
      print(io, format(), {
        json: { boards: list.map((b) => ({ id: b.definition.id, name: b.definition.name, firmware: b.definition.firmware, key_count: b.definition.keyCount })) },
        ids: list.map((b) => b.definition.id),
        table: columns([
          ["ID", "NAME", "FIRMWARE", "KEYS", "REVISIONS"],
          ...list.map((b) => [b.definition.id, b.definition.name, b.definition.firmware, String(b.definition.keyCount), b.definition.revisions.map((r) => r.id).join(",")]),
        ]),
      });
    });

  boards
    .command("show")
    .description("physical keys, hands, firmware, build and flash recipe")
    .argument("<board>", "board ID")
    .action((id: string) => {
      const b = showBoard(id);
      const d = b.definition;
      const revisions = d.revisions
        .map((r) => `  ${r.id}: build ${r.build.kind}, flash ${r.flash.kind}${r.detect ? `, USB PID ${r.detect.usbProductId}` : ""}${r.qmkTarget ? `, target ${r.qmkTarget}` : ""}\n    ${r.source.repo} @ ${r.source.sha}`)
        .join("\n");
      const rows = Object.entries(d.rows).map(([name, p]) => `${name} ${p.length}`).join(", ");
      print(io, format(), {
        json: { board: d, geometry: b.geometry },
        ids: [d.id],
        table: `${d.id}  ${d.vendor} ${d.name}  ${d.firmware}  ${d.keyCount} keys\nhands: left ${d.hands.left.length}, right ${d.hands.right.length}; rows: ${rows}\nrevisions:\n${revisions}\n\nkey positions:\n${renderPositionGrid(b)}`,
      });
    });

  boards
    .command("check")
    .description("validate a board definition folder (for contributors)")
    .argument("<dir>", "board folder, such as boards/zsa/moonlander")
    .option("--offline", "don't regenerate geometry from the firmware tree")
    .action(async (dir: string, opts: { offline?: boolean }) => {
      const result = await checkBoard(dir, opts.offline ? { offline: true } : {});
      const lines = result.issues.map((i) => `${i.level}: ${i.message}`);
      print(io, format(), { json: { ok: result.ok, issues: result.issues }, table: [result.ok ? `${dir}: ok` : `${dir}: failed`, ...lines].join("\n") });
      if (!result.ok) throw new ValidationFailedError(`${dir} has ${result.issues.filter((i) => i.level === "error").length} errors`, result);
    });

  boards
    .command("geometry")
    .description("generate geometry.json from the pinned firmware tree")
    .argument("<board>", "board ID under ./boards, or a board folder")
    .action(async (ref: string) => {
      const r = await regenerateGeometry(ref);
      print(io, format(), { json: { path: r.path, key_count: r.keyCount, source: r.source }, table: `wrote ${r.path}: ${r.keyCount} keys from ${r.source}` });
    });

  program
    .command("doctor")
    .description("check the database (toolchain checks come with builds)")
    .action(() => {
      const checks = runDoctor(globals().dataDir === undefined ? {} : { dataDir: globals().dataDir as string });
      print(io, format(), {
        json: { ok: checks.every((c) => c.ok), checks },
        table: checks.map((c) => `${c.ok ? "ok  " : "FAIL"}  ${c.name}: ${c.detail}`).join("\n"),
      });
      if (checks.some((c) => !c.ok)) state.exitCode = EXIT.bug;
    });

  return program;
}

const layoutJson = (r: { id: string; name: string; boardId: string; headRevisionId: string; createdAt: number; updatedAt: number }) => ({
  id: r.id, name: r.name, board_id: r.boardId, head_revision_id: r.headRevisionId, created_at: r.createdAt, updated_at: r.updatedAt,
});

/** Runs the CLI and returns the exit code; never throws. */
export async function runCli(argv: string[], io: Io = stdIo()): Promise<number> {
  const state = { exitCode: EXIT.ok as number, dataDir: "" };
  const program = buildProgram(io, state);
  let jsonErrors = false;
  try {
    await program.parseAsync(argv, { from: "user" });
    return state.exitCode;
  } catch (err) {
    if (err instanceof CommanderError) {
      // Help and version are not failures.
      if (err.code === "commander.helpDisplayed" || err.code === "commander.help" || err.code === "commander.version") return EXIT.ok;
      return EXIT.usage; // commander already printed the message
    }
    jsonErrors = (program.opts<Globals>().format ?? defaultFormat(io)) !== "table";
    const c = classify(err, state.dataDir || (program.opts<Globals>().dataDir ?? ""));
    io.err(jsonErrors ? `${JSON.stringify({ schema_version: SCHEMA_VERSION, error: { code: c.kind, message: c.message } })}\n` : `error: ${c.message}\n`);
    return c.code;
  }
}

if (import.meta.main) {
  process.exit(await runCli(process.argv.slice(2)));
}
