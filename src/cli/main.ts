#!/usr/bin/env bun
// keyloom CLI (10). Every command is a thin call into src/app.
import { Command, CommanderError, Option } from "commander";
import {
  requireCommandSupport, type App, type ImportOutcome, dataDir as dataDirOf, PROVIDERS, boardDevView, closeApp, shutdownDeviceConnections, checkBoard, exportLayout, getLayout, importLayout, listBoardDefinitions, listLayouts, openApp, upgradeLayout, backfillLayerRefs, backfillConditionalLayers,
  loadUserBoards, regenerateGeometry, renderLayoutText, renderPositionGrid, runCredentialChecks, runDeviceHelperCheck, runDoctor, runKeyboardChecks, runRemapperChecks, runToolchainChecks, type HandsFreeOverrides, type SyncDeps, selectLayers, showBoard, UsageError, IncompatibleError, ValidationFailedError,
} from "../app/index.ts";
import { registerChangeCommands } from "./commands/change.ts";
import { registerConfigCommands } from "./commands/config.ts";
import { type ChatDeps, parseProvider, registerChatCommands } from "./commands/chat.ts";
import { registerDecisionCommands } from "./commands/decisions.ts";
import { registerEmulateCommand } from "./commands/emulate.ts";
import { type KeyboardCliDeps, registerKeyboardCommands } from "./commands/keyboard.ts";
import { type LabCliDeps, registerLabCommands } from "./commands/lab.ts";
import { registerFirmwareCommands } from "./commands/firmware.ts";
import { registerSyncCommands } from "./commands/sync.ts";
import { registerVersionCommands } from "./commands/version.ts";
import { registerRemapCommands } from "./commands/remap.ts";
import { registerReviewCommand } from "./commands/review.ts";
import { registerProviderCommands } from "./commands/provider.ts";
import { EXIT, classify } from "./errors.ts";
import { DEFAULT_PORT, serve, serveBoardDev } from "./serve.ts";
import { announceServer } from "../server/running-server.ts";
import { resolveExistingServer } from "./serve-existing.ts";
import { DESKTOP_PROTOCOL } from "../server/server-compat.ts";
import { FORMATS, type Format, type Io, SCHEMA_VERSION, columns, defaultFormat, print } from "./output.ts";
import { importTable } from "./report.ts";
import pkg from "../../package.json" with { type: "json" };

const stdIo = (): Io => ({
  out: (t) => void process.stdout.write(t),
  err: (t) => void process.stderr.write(t),
  isTTY: Boolean(process.stdout.isTTY),
});

type Globals = { format?: Format; dataDir?: string; quiet?: boolean; verbose?: boolean };

/** `handsFree` replaces how USB, raw HID and serial ports are read, and `syncDeps` how `sync` builds and flashes; tests pass fakes. */
export function buildProgram(io: Io, state: { exitCode: number; dataDir: string }, chat: ChatDeps = {}, handsFree?: HandsFreeOverrides, syncDeps?: SyncDeps, lab?: LabCliDeps, keyboards?: KeyboardCliDeps): Command {
  const program = new Command("keyloom")
    .description("Local-first keyboard configurator for QMK and ZMK boards")
    .version(pkg.version, "-V, --version", "print the keyloom version")
    .addOption(new Option("--format <format>", "output format (default: table on a TTY, json otherwise)").choices(FORMATS))
    .option("--data-dir <path>", "use this directory instead of $XDG_DATA_HOME/keyloom")
    .option("--quiet", "print only what was asked for")
    .option("--verbose", "print where data is read from")
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });

  // Boards derived on this machine live in the data directory; every command, including the ones that never open the database, sees them.
  program.hook("preAction", (_program, action) => {
    const names: string[] = [];
    for (let cmd: Command | null = action; cmd?.parent; cmd = cmd.parent) names.unshift(cmd.name());
    requireCommandSupport(names.join(" "), { offline: action.opts().offline === true, rebootOnly: action.opts().rebootOnly === true });
    loadUserBoards(globals().dataDir);
  });

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
    .requiredOption("--board <board>", "board ID, such as zsa/moonlander or moergo/glove80")
    .argument("<file>", "Oryx source zip or its folder (Moonlander), a QMK keymap folder or its keymap.json, a Layout Editor .keymap file (Glove80), a karabiner.json (MacBook; read only), or a keyloom layout export")
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
    .command("upgrade")
    .description("read the colours and tap dances a stored layout still holds as Oryx code into the model, as one revision that undoes like any change; changes nothing when there are none")
    .argument("<layout>", "layout ID or name")
    .action(async (ref: string) => {
      const out = await withApp((app) => upgradeLayout(app, ref));
      print(io, format(), {
        json: { changed: out.changed, message: out.message, revision_id: out.changed ? out.revisionId : null },
        ids: out.changed ? [out.revisionId] : [],
        table: out.changed ? `${out.revisionId}\n${out.message}` : out.message,
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
      print(io, format(), {
        json: {
          layout_id: view.layout.id,
          name: view.layout.name,
          board_id: view.layout.boardId,
          revision_id: view.revision.id,
          layout: { ...view.document, layers: selectLayers(view, opts.layer) },
        },
        ids: [view.layout.id],
        table: `${view.layout.id}  ${view.layout.name}  ${view.layout.boardId}  ${view.revision.id}\n\n${grids}`,
      });
    });

  layout
    .command("export")
    .description("write a layout as a keyloom layout document, which `config new --from import` reads back")
    .argument("<layout>", "layout ID or name")
    .requiredOption("--out <file>", "the JSON file to write")
    .option("--rev <revision>", "a revision ID instead of the head")
    .action(async (ref: string, opts: { out: string; rev?: string }) => {
      const out = await withApp((app) => exportLayout(app, ref, { out: opts.out, ...(opts.rev === undefined ? {} : { revisionId: opts.rev }) }));
      print(io, format(), {
        json: { layout_id: out.layoutId, name: out.name, board_id: out.boardId, revision_id: out.revisionId, path: out.path },
        ids: [out.path],
        table: `${out.path}\n${out.name} (${out.layoutId}) on ${out.boardId}, revision ${out.revisionId}`,
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

  registerChangeCommands(program, { io, format, withApp });
  registerChatCommands(program, { io, format, withApp }, chat);
  registerReviewCommand(program, { io, format, withApp }, chat);
  registerProviderCommands(program, { io, format, quiet: () => globals().quiet === true, withApp });
  registerDecisionCommands(program, { io, format, withApp });

  program
    .command("serve")
    .alias("web")
    .description("start the local web app and open it in the browser")
    .option("--port <port>", "port on 127.0.0.1; 0 picks a free one", String(DEFAULT_PORT))
    .option("--no-open", "don't open the browser")
    .option("--exit-on-stdin-close", "stop when standard input closes, so a parent that dies can't leave this server running (the desktop app uses it)")
    .option("--reuse", "if keyloom is already serving this data directory, print its URL and exit 0 instead of failing (the desktop app uses it)")
    .option("--replace", "if another keyloom is serving this data directory, stop it (after it finishes any keyboard write) and serve from this one; refused if that server is newer")
    .option("--client-protocol <n>", "the desktop protocol the caller was built for (the desktop app passes it); refuses to start if this keyloom speaks another, and makes --reuse refuse a server that does")
    .option("--board-dev <board>", "contributors: show a board's keys with their position numbers instead of your layouts; takes a board ID under ./boards or a board folder")
    .option("--provider <provider>", `model provider for new chats: ${PROVIDERS.join(", ")} (default: the config, then the first one with a credential)`)
    .action(async (opts: { port: string; open: boolean; exitOnStdinClose?: boolean; reuse?: boolean; replace?: boolean; clientProtocol?: string; boardDev?: string; provider?: string }) => {
      const provider = opts.provider === undefined ? undefined : parseProvider(opts.provider);
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port must be 0-65535, got "${opts.port}"`);
      if (opts.reuse && opts.replace) throw new UsageError("--reuse attaches to a running server and --replace stops it; pass one");
      let clientProtocol: number | undefined;
      if (opts.clientProtocol !== undefined) {
        clientProtocol = Number(opts.clientProtocol);
        if (!/^\d+$/.test(opts.clientProtocol)) throw new UsageError(`--client-protocol must be a whole number, got "${opts.clientProtocol}"`);
        // Before anything is started or stopped: a caller built for another protocol would misread this server.
        if (clientProtocol !== DESKTOP_PROTOCOL) {
          throw new IncompatibleError("client_protocol_mismatch", `the desktop app was built for keyloom desktop protocol ${clientProtocol}, but this keyloom ${pkg.version} speaks protocol ${DESKTOP_PROTOCOL}. The app and its keyloom are from different releases; reinstall the app (or install the matching keyloom).`);
        }
      }
      const start = (app: App | undefined) => {
        try {
          return opts.boardDev === undefined ? serve(app as App, { port, open: opts.open, ...(provider ? { provider } : {}), ...(handsFree ? { handsFree } : {}), ...(syncDeps ? { syncDeps } : {}) }) : serveBoardDev(opts.boardDev, { port, open: opts.open });
        } catch (err) {
          if ((err as { code?: string }).code === "EADDRINUSE") throw new UsageError(`port ${port} is in use; pass --port`);
          throw err;
        }
      };
      // Serve until interrupted; withApp closes the database after the server stops.
      let releaseReplace = () => {};
      const untilInterrupted = async (app: App | undefined) => {
        // Before the server takes a request, so no edit sees a layout whose kept code is not yet read (D-361).
        if (app !== undefined) {
          await backfillLayerRefs(app, (m) => io.err(`${m}\n`));
          // After the numbers are read, which it relies on (D-391).
          await backfillConditionalLayers(app, (m) => io.err(`${m}\n`));
        }
        const running = start(app);
        // Announced before the URL is printed, so whoever reads the URL can already find the record. --board-dev has no database or sync engine to protect.
        const forget = app === undefined ? () => {} : announceServer(app.dataDir, running.url, { version: pkg.version, protocol: DESKTOP_PROTOCOL });
        // A racing --replace may look at the directory again now.
        releaseReplace();
        io.err(`keyloom is running at ${running.url}\nPress Ctrl-C to stop.\n`);
        await new Promise<void>((resolve) => {
          const stop = () => resolve();
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
          if (opts.exitOnStdinClose) {
            // A parent that dies closes the pipe, whatever killed it (D-321). Resuming is what makes the stream report the end.
            process.stdin.once("end", stop);
            process.stdin.once("close", stop);
            process.stdin.resume();
          }
        });
        forget();
        process.stdin.pause();
        running.stop();
        if (running.drain) {
          const slow = setTimeout(() => io.err("Finishing a keyboard sync that is writing; don't unplug the keyboard.\n"), 1000);
          await running.drain();
          clearTimeout(slow);
        }
      };
      if (opts.boardDev === undefined) {
        // Before the database opens: a second server would also run the migrations and a second sync engine (D-323).
        const dir = dataDirOf(globals().dataDir);
        const outcome = await resolveExistingServer({ dir, reuse: opts.reuse === true, replace: opts.replace === true, clientProtocol, mine: { version: pkg.version, protocol: DESKTOP_PROTOCOL }, say: io.err });
        if (outcome.attached) return;
        releaseReplace = outcome.release;
      }
      if (opts.boardDev !== undefined) {
        // Fails now, with the fix, rather than on the first request.
        await boardDevView(opts.boardDev);
        await untilInterrupted(undefined);
      } else {
        try {
          await withApp(untilInterrupted);
        } finally {
          releaseReplace();
        }
      }
    });

  registerFirmwareCommands(program, { io, format, quiet: () => globals().quiet === true, withApp, ...(handsFree ? { handsFree } : {}) });
  const syncCommandDeps = { io, format, quiet: () => globals().quiet === true, withApp, ...(handsFree ? { handsFree } : {}), ...(syncDeps ? { syncDeps } : {}) };
  registerSyncCommands(program, syncCommandDeps);
  registerConfigCommands(program, syncCommandDeps, keyboards ?? {});
  registerVersionCommands(program, syncCommandDeps);
  registerRemapCommands(program, { io, format, withApp, ...(handsFree ? { handsFree } : {}) });
  registerKeyboardCommands(program, { io, format, quiet: () => globals().quiet === true, withApp, ...(handsFree ? { handsFree } : {}), ...(keyboards ? { keyboards } : {}) });
  registerEmulateCommand(program, { io, format, quiet: () => globals().quiet === true, withApp });
  registerLabCommands(program, { io, format, quiet: () => globals().quiet === true, withApp, ...(lab ? { cli: lab } : {}) });

  program
    .command("doctor")
    .description("check the database, device helper, model credential and firmware toolchain")
    .option("--device-helper-only", "check only the installed helper pair, without device discovery or network/toolchain probes")
    .action(async (options: { deviceHelperOnly?: boolean }) => {
      const helper = await runDeviceHelperCheck();
      const checks = options.deviceHelperOnly ? [helper] : [
        helper,
        ...runDoctor(globals().dataDir === undefined ? {} : { dataDir: globals().dataDir as string }),
        ...(await runCredentialChecks()),
        ...(await runToolchainChecks()),
        ...(await runKeyboardChecks(handsFree)),
        ...(await runRemapperChecks(handsFree?.remapper)),
      ];
      print(io, format(), {
        json: { ok: checks.every((c) => c.ok), checks },
        table: checks.map((c) => `${c.ok ? (c.warn ? "warn" : "ok  ") : "FAIL"}  ${c.name}: ${c.detail}`).join("\n"),
      });
      if (checks.some((c) => !c.ok)) state.exitCode = EXIT.bug;
    });

  return program;
}

const layoutJson = (r: { id: string; name: string; boardId: string; headRevisionId: string; createdAt: number; updatedAt: number }) => ({
  id: r.id, name: r.name, board_id: r.boardId, head_revision_id: r.headRevisionId, created_at: r.createdAt, updated_at: r.updatedAt,
});

/** Runs the CLI and returns the exit code; never throws. */
export async function runCli(argv: string[], io: Io = stdIo(), chat: ChatDeps = {}, handsFree?: HandsFreeOverrides, syncDeps?: SyncDeps, lab?: LabCliDeps, keyboards?: KeyboardCliDeps): Promise<number> {
  const state = { exitCode: EXIT.ok as number, dataDir: "" };
  const program = buildProgram(io, state, chat, handsFree, syncDeps, lab, keyboards);
  let commandError: unknown;
  let hasCommandError = false;
  let commandResult: number = EXIT.ok;
  try {
    await program.parseAsync(argv, { from: "user" });
    commandResult = state.exitCode;
  } catch (err) {
    if (err instanceof CommanderError) {
      // Help and version are not failures; other commander errors already printed their message.
      commandResult = err.code === "commander.helpDisplayed" || err.code === "commander.help" || err.code === "commander.version"
        ? EXIT.ok
        : EXIT.usage;
    } else {
      commandError = err;
      hasCommandError = true;
    }
  }

  const jsonErrors = (program.opts<Globals>().format ?? defaultFormat(io)) !== "table";
  let cleanupFailed = false;
  try { await shutdownDeviceConnections(); }
  catch { cleanupFailed = true; }

  const classified = hasCommandError
    ? classify(commandError, state.dataDir || (program.opts<Globals>().dataDir ?? ""))
    : undefined;
  if (cleanupFailed) {
    const warning = "keyboard helper termination could not be confirmed; restart keyloom before using the keyboard connection again";
    if (classified && !jsonErrors) io.err(`error: ${classified.message}\n`);
    io.err(jsonErrors
      ? `${JSON.stringify({ schema_version: SCHEMA_VERSION, error: { code: "cleanup_unconfirmed", message: warning } })}\n`
      : `${warning}\n`);
    return EXIT.bug;
  }
  if (classified) {
    io.err(jsonErrors
      ? `${JSON.stringify({ schema_version: SCHEMA_VERSION, error: { code: classified.kind, message: classified.message } })}\n`
      : `error: ${classified.message}\n`);
    return classified.code;
  }
  return commandResult;
}

/** Runs the CLI for this process's arguments and exits with its code. */
export async function main(): Promise<never> {
  const code = await runCli(process.argv.slice(2));
  // On Windows a piped stdout is written asynchronously, and exiting at once loses it (seen as an
  // empty `keyloom --version`). A zero-length write's callback runs after everything queued before it.
  // The callback also runs with an error on a closed stream; a reader that never drains gets 5 s, not forever.
  const flushed = (stream: NodeJS.WriteStream) => new Promise<void>((resolve) => stream.write("", () => resolve()));
  await Promise.race([Promise.all([flushed(process.stdout), flushed(process.stderr)]), new Promise((resolve) => setTimeout(resolve, 5_000).unref())]);
  process.exit(code);
}

if (import.meta.main) await main();
