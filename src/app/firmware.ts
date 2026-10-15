// Use cases for firmware: generate, build and flash (01#modules). A build or flash returns its row
// at once and finishes in the background; callers poll getBuild / getFlash, which is what the web
// app does. The CLI waits with buildAndWait / flashAndWait.
import { join, resolve } from "node:path";
import type { Board } from "../boards/load.ts";
import { writeSource } from "../firmware/qmk/write-source.ts";
import { BuildFailure } from "../firmware/toolchain/build-failure.ts";
import { CheckoutError } from "../firmware/toolchain/checkout.ts";
import { dockerStatus } from "../firmware/toolchain/docker.ts";
import type { FlashState } from "../firmware/toolchain/flash-state.ts";
import { LockTimeoutError, processAlive } from "../firmware/toolchain/lock.ts";
import type { HandsFreeDeps } from "../firmware/qmk/handsfree-flash.ts";
import { LogSink } from "../firmware/toolchain/run.ts";
import { listUsbDevices } from "../firmware/toolchain/usb.ts";
import {
  type BuildRow, type FlashRow, activeFlashes, createBuild, createFlash, finishBuild, finishFlash, findBuild, findFlash, latestSuccessfulBuild,
  newBuildId, newFlashId, setFlashProgress,
} from "../persistence/builds.ts";
import { findLayoutRow, listLayoutRows } from "../persistence/layouts.ts";
import { cacheDir } from "../persistence/paths.ts";
import { showBoard } from "./boards.ts";
import type { App } from "./context.ts";
import { NotFoundError, UsageError, ValidationFailedError } from "./errors.ts";
import { type GeneratedSource, SourceError, driverFor } from "./firmware-drivers.ts";
import { BuildFailedError, FlashFailedError } from "./firmware-errors.ts";
import { type LayoutView, getLayout } from "./layouts.ts";

// These are the shapes of Build and Flash in src/api/http.ts (a superset: the extra fields are for
// the CLI). app can't import src/api, so test/app/firmware.test.ts checks they stay assignable.
export type BuildView = {
  id: string;
  revisionId: string;
  layoutId: string;
  boardRevision: string;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  /** The last lines of the build log, oldest first. */
  logTail: string[];
  /** Absolute path of the firmware file (.bin or .uf2) once the build has succeeded. */
  artifactPath: string | null;
  /** Absolute path of the full log. */
  logPath: string;
};

export type FlashView = {
  id: string;
  buildId: string;
  status: FlashState;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  /** What the person must do now, such as pressing the reset button. */
  instruction: string | null;
  /** What keyloom confirmed after the flash (read from its log, so it survives a restart), or null. */
  note: string | null;
  logTail: string[];
  logPath: string;
};

const LOG_TAIL_LINES = 30;
const WRITING_INSTRUCTION = "Don't unplug the keyboard. Flashing takes a few seconds.";

// What the person must do now, as the flasher last said it. A UF2 flash asks for two different things in a row
// (the right half, then the left), so the text can't come from the status alone. Held in memory because the
// flash runs in this process; a row whose process has gone is reaped, and its text is no longer needed.
const flashInstructions = new Map<string, string | null>();

const buildTasks = new Map<string, Promise<void>>();
const flashTasks = new Map<string, Promise<void>>();

const absolute = (app: App, rel: string): string => join(app.dataDir, rel);

async function tailOf(path: string): Promise<string[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  // The end of the file is enough, and a build log can run to megabytes.
  const text = await file.slice(Math.max(0, file.size - 64 * 1024)).text();
  return text.split("\n").filter((l) => l.trim() !== "").slice(-LOG_TAIL_LINES);
}

/** `<cache>/keyloom/build/zsa-moonlander`: one pinned checkout per board (01). */
export const checkoutDirFor = (board: Board): string => join(cacheDir(), "build", board.definition.id.replace("/", "-"));

// --- board revision -------------------------------------------------------------------------

/** Rev A and rev B need different binaries, so the build must know which one is on the desk. */
async function resolveBoardRevision(board: Board, requested: string | undefined): Promise<string> {
  const ids = board.definition.revisions.map((r) => r.id);
  if (requested !== undefined) {
    if (!ids.includes(requested)) throw new UsageError(`${board.definition.id} has no revision "${requested}"; use one of: ${ids.join(", ")}`);
    return requested;
  }
  if (ids.length === 1) return ids[0] as string;
  const devices = await listUsbDevices();
  // A product ID alone could belong to another maker's device; when macOS names the maker, it has to be the board's.
  const vendor = board.definition.vendor.toLowerCase();
  const found = board.definition.revisions.filter(
    (r) => r.detect !== null && devices.some((d) => d.productId === r.detect?.usbProductId.toLowerCase() && (d.maker === "" || d.maker.toLowerCase().includes(vendor))),
  );
  if (found.length === 1) return (found[0] as { id: string }).id;
  throw new UsageError(
    `which ${board.definition.name} revision is this for? Pass --board-rev ${ids.join("|")}. ` +
      (found.length === 0 ? "No connected keyboard was recognised, so keyloom can't tell." : `More than one was recognised (${found.map((r) => r.id).join(", ")}).`),
  );
}

// --- generate -------------------------------------------------------------------------------

export function sourceFor(view: LayoutView, boardRevisionId: string): GeneratedSource {
  const driver = driverFor(view.board);
  try {
    return driver.generate(view, boardRevisionId);
  } catch (err) {
    if (err instanceof SourceError) throw new ValidationFailedError(`this layout can't be written as ${driver.name} source: ${err.message}`, { reason: err.message });
    throw err;
  }
}

export type GenerateOutcome = { layoutId: string; revisionId: string; dir: string; files: string[] };

/** Writes the firmware source for a layout revision into `out`, without building it. */
export async function generateFirmware(
  app: App,
  ref: string,
  opts: { rev?: string; out: string; boardRevision?: string },
): Promise<GenerateOutcome> {
  const view = getLayout(app, ref, opts.rev);
  // No hardware detection here: generating needs no connected keyboard, so the first revision stands in unless one is named.
  const source = sourceFor(view, opts.boardRevision ?? (view.board.definition.revisions[0] as { id: string }).id);
  const dir = resolve(opts.out);
  await writeSource(dir, source);
  return { layoutId: view.layout.id, revisionId: view.revision.id, dir, files: source.files.map((f) => f.path) };
}

// --- build ----------------------------------------------------------------------------------

async function toBuildView(app: App, row: BuildRow): Promise<BuildView> {
  const logPath = absolute(app, row.logPath);
  return {
    id: row.id, revisionId: row.revisionId, layoutId: row.layoutId, boardRevision: row.boardRevision, status: row.status, error: row.error,
    startedAt: row.startedAt, finishedAt: row.finishedAt, logTail: await tailOf(logPath),
    artifactPath: row.artifactPath === null ? null : absolute(app, row.artifactPath), logPath,
  };
}

/** A row still marked running whose process has died (a crash, a closed terminal) will never finish; say so. */
function reapBuild(app: App, row: BuildRow): BuildRow {
  if (row.status === "running" && row.pid !== process.pid && !processAlive(row.pid)) {
    finishBuild(app.db, row.id, { error: "keyloom stopped before this build finished." });
    return findBuild(app.db, row.id) ?? row;
  }
  return row;
}

export type BuildOptions = {
  /** A layout revision ID; the head when omitted. */
  revisionId?: string;
  /** `reva` or `revb`; detected from a connected keyboard when omitted. */
  boardRevision?: string;
  /** Every line the build prints. */
  onProgress?: (line: string) => void;
  /** Aborting stops the build and removes its container. */
  signal?: AbortSignal;
};

/**
 * Starts a build of a layout revision and returns its row at once. The build runs on in this process;
 * poll getBuild for its progress.
 */
export async function startBuild(app: App, ref: string, opts: BuildOptions = {}): Promise<BuildView> {
  const view = getLayout(app, ref, opts.revisionId);
  const boardRevision = await resolveBoardRevision(view.board, opts.boardRevision);
  const id = newBuildId();
  const row = createBuild(app.db, { id, revisionId: view.revision.id, layoutId: view.layout.id, boardRevision, logPath: `logs/build-${id}.log` });
  const task = runBuild(app, view, row, opts.onProgress, opts.signal);
  buildTasks.set(id, task);
  void task.finally(() => buildTasks.delete(id));
  return toBuildView(app, row);
}

async function runBuild(app: App, view: LayoutView, row: BuildRow, onProgress: ((line: string) => void) | undefined, signal: AbortSignal | undefined): Promise<void> {
  const log = new LogSink(absolute(app, row.logPath));
  const say = (line: string) => {
    log.line(line);
    onProgress?.(line);
  };
  try {
    say(`keyloom: build ${row.id} of "${view.layout.name}" (${view.revision.id}) for ${view.board.definition.id} ${row.boardRevision}`);
    // Before the checkout: a missing Docker should not first cost a multi-gigabyte clone.
    const docker = await dockerStatus();
    if (!docker.ok) throw new BuildFailure(docker.reason);
    const driver = driverFor(view.board);
    let source: GeneratedSource;
    try {
      source = driver.generate(view, row.boardRevision, row.id);
    } catch (err) {
      if (err instanceof SourceError) throw new BuildFailure(`This layout can't be written as ${driver.name} source: ${err.message}`);
      throw err;
    }
    const artifactRel = `artifacts/${row.id}.${driver.artifactExtension(view.board, row.boardRevision)}`;
    const checkoutDir = checkoutDirFor(view.board);
    await driver.build({
      view, boardRevision: row.boardRevision, source, checkoutDir, imageContextDir: join(cacheDir(), "images", view.board.definition.id.replace("/", "-")),
      artifactPath: absolute(app, artifactRel), log, containerName: `keyloom-${row.id}`, ...(onProgress ? { onLine: onProgress } : {}),
      ...(signal ? { signal } : {}),
    });
    finishBuild(app.db, row.id, { artifactPath: artifactRel });
  } catch (err) {
    const known = err instanceof BuildFailure || err instanceof CheckoutError || err instanceof LockTimeoutError;
    if (!known) log.line(`keyloom: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    const message = known ? (err as Error).message : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    log.line(`keyloom: build failed: ${message}`);
    finishBuild(app.db, row.id, { error: message });
  } finally {
    log.close();
  }
}

export async function getBuild(app: App, id: string): Promise<BuildView> {
  const row = findBuild(app.db, id);
  if (!row) throw new NotFoundError(`no build "${id}"`);
  return toBuildView(app, reapBuild(app, row));
}

/** Builds and waits. Throws BuildFailedError (exit 7) when the build fails. */
export async function buildAndWait(app: App, ref: string, opts: BuildOptions = {}): Promise<BuildView> {
  const started = await startBuild(app, ref, opts);
  await buildTasks.get(started.id);
  const done = await getBuild(app, started.id);
  if (done.status !== "succeeded") throw new BuildFailedError(`build ${done.id} failed: ${done.error ?? "unknown error"} (log: ${done.logPath})`, done.id, done.logPath);
  return done;
}

// --- flash ----------------------------------------------------------------------------------

function instructionFor(row: FlashRow, board: Board | undefined): string | null {
  if (row.status !== "waiting_for_bootloader" && row.status !== "writing") return null;
  const said = flashInstructions.get(row.id);
  if (said !== undefined) return said;
  return row.status === "writing" ? WRITING_INSTRUCTION : board ? driverFor(board).waitingInstruction(board) : null;
}

/** The board a flash is for: flash -> build -> layout -> board. Undefined only if a row refers to something deleted. */
function boardOfFlash(app: App, row: FlashRow): Board | undefined {
  const build = findBuild(app.db, row.buildId);
  const layout = build ? findLayoutRow(app.db, build.layoutId) : undefined;
  return layout ? showBoard(layout.boardId) : undefined;
}

const VERIFIED = /^keyloom: (Verified: .+)$/;

async function toFlashView(app: App, row: FlashRow): Promise<FlashView> {
  const logPath = absolute(app, row.logPath);
  // Read before the first await: the instruction a state change carries must be the one in force when it was announced.
  const instruction = instructionFor(row, boardOfFlash(app, row));
  const logTail = await tailOf(logPath);
  return {
    id: row.id, buildId: row.buildId, status: row.status, error: row.error, startedAt: row.startedAt, finishedAt: row.finishedAt,
    instruction,
    note: row.status === "succeeded" ? (logTail.map((l) => VERIFIED.exec(l)?.[1]).findLast((n) => n !== undefined) ?? null) : null,
    logTail, logPath,
  };
}

function reapFlash(app: App, row: FlashRow): FlashRow {
  if ((row.status === "waiting_for_bootloader" || row.status === "writing") && row.pid !== process.pid && !processAlive(row.pid)) {
    finishFlash(app.db, row.id, { error: "keyloom stopped before this flash finished. Nothing is known about the keyboard's state: reconnect it, and flash again if it doesn't type." });
    return findFlash(app.db, row.id) ?? row;
  }
  return row;
}

export type FlashOptions = {
  /** Flash this build. */
  buildId?: string;
  /** Flash the newest successful build of this layout. */
  layout?: string;
  onProgress?: (line: string) => void;
  /** Called when the flash changes state, including the first state. */
  onState?: (flash: FlashView) => void;
  /** Aborting stops the flasher, so nothing is left waiting for the keyboard. */
  signal?: AbortSignal;
  /** How long to wait for the keyboard to enter its bootloader (default 2 minutes). Short values are for tests. */
  bootloaderWaitMs?: number;
  /** Where a UF2 keyboard's boot drives appear (default: the machine's own, `/Volumes` on macOS). Tests pass a temporary directory. */
  volumesRoot?: string;
  /** How a ZSA keyboard is found and restarted (default: this machine's USB and raw HID). Tests pass fakes. */
  handsFree?: Partial<HandsFreeDeps>;
};

function chooseBuild(app: App, opts: FlashOptions): BuildRow {
  if (opts.buildId !== undefined) {
    const row = findBuild(app.db, opts.buildId);
    if (!row) throw new NotFoundError(`no build "${opts.buildId}"`);
    return reapBuild(app, row);
  }
  let layoutId: string | undefined;
  if (opts.layout !== undefined) {
    const layout = findLayoutRow(app.db, opts.layout);
    if (!layout) throw new NotFoundError(`no layout "${opts.layout}"`);
    layoutId = layout.id;
  } else {
    const all = listLayoutRows(app.db);
    if (all.length !== 1) throw new UsageError(`say what to flash: --build <id> or --layout <layout> (${all.length} layouts saved)`);
    layoutId = (all[0] as { id: string }).id;
  }
  const row = latestSuccessfulBuild(app.db, layoutId);
  if (!row) throw new UsageError(`no successful build of this layout yet; run \`keyloom build ${opts.layout ?? layoutId}\` first`);
  return row;
}

/** Starts flashing a successful build and returns the flash at once, waiting for the bootloader. */
export async function startFlash(app: App, opts: FlashOptions): Promise<FlashView> {
  const build = chooseBuild(app, opts);
  if (build.status !== "succeeded" || build.artifactPath === null) {
    throw new UsageError(`build ${build.id} is ${build.status}${build.error ? ` (${build.error})` : ""}; only a successful build can be flashed`);
  }
  const artifact = absolute(app, build.artifactPath);
  if (!(await Bun.file(artifact).exists())) throw new UsageError(`build ${build.id}'s file ${artifact} is gone; build it again`);

  const busy = activeFlashes(app.db).map((f) => reapFlash(app, f)).find((f) => f.status === "waiting_for_bootloader" || f.status === "writing");
  if (busy) throw new UsageError(`flash ${busy.id} is already in progress; wait for it to finish`);

  const layout = findLayoutRow(app.db, build.layoutId);
  const board = showBoard(layout?.boardId ?? "");

  const id = newFlashId();
  const row = createFlash(app.db, { id, buildId: build.id, logPath: `logs/flash-${id}.log` });
  const task = runFlash(app, row, board, build.boardRevision, artifact, opts);
  flashTasks.set(id, task);
  void task.finally(() => flashTasks.delete(id));
  return toFlashView(app, row);
}

async function runFlash(app: App, row: FlashRow, board: Board, boardRevision: string, artifact: string, opts: FlashOptions): Promise<void> {
  const log = new LogSink(absolute(app, row.logPath));
  const notify = () => {
    const current = findFlash(app.db, row.id);
    if (current && opts.onState) void toFlashView(app, current).then(opts.onState);
  };
  try {
    log.line(`keyloom: flash ${row.id} of build ${row.buildId}`);
    notify();
    const result = await driverFor(board).flash({
      board, boardRevision, buildId: row.buildId, artifactPath: artifact, log,
      ...(opts.handsFree ? { handsFree: opts.handsFree } : {}), ...(opts.onProgress ? { onLine: opts.onProgress } : {}),
      ...(opts.bootloaderWaitMs === undefined ? {} : { bootloaderWaitMs: opts.bootloaderWaitMs }),
      ...(opts.volumesRoot === undefined ? {} : { volumesRoot: opts.volumesRoot }),
      ...(opts.signal ? { signal: opts.signal } : {}),
      onState: (state: FlashState, instruction: string | null) => {
        if (state === "waiting_for_bootloader" || state === "writing") {
          flashInstructions.set(row.id, instruction);
          setFlashProgress(app.db, row.id, state);
          notify();
        }
      },
    });
    finishFlash(app.db, row.id, result.state === "succeeded" ? null : { error: result.error ?? "the flash failed" });
  } catch (err) {
    log.line(`keyloom: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    finishFlash(app.db, row.id, { error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` });
  } finally {
    flashInstructions.delete(row.id);
    log.close();
    notify();
  }
}

export async function getFlash(app: App, id: string): Promise<FlashView> {
  const row = findFlash(app.db, id);
  if (!row) throw new NotFoundError(`no flash "${id}"`);
  return toFlashView(app, reapFlash(app, row));
}

/** Flashes and waits. Throws FlashFailedError (exit 8) when the flash fails or no bootloader appears. */
export async function flashAndWait(app: App, opts: FlashOptions): Promise<FlashView> {
  const started = await startFlash(app, opts);
  await flashTasks.get(started.id);
  const done = await getFlash(app, started.id);
  if (done.status !== "succeeded") throw new FlashFailedError(`flash ${done.id} failed: ${done.error ?? "unknown error"} (log: ${done.logPath})`, done.id, done.logPath);
  return done;
}

