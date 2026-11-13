import { requirePlatformSupport } from "../firmware/toolchain/platform-support.ts";
// Use cases for firmware: generate, build and flash (01#modules). A build or flash returns its row
// at once and finishes in the background; callers poll getBuild / getFlash, which is what the web
// app does. The CLI waits with buildAndWait / flashAndWait.
import { join, resolve } from "node:path";
import type { Board } from "../boards/load.ts";
import { writeSource } from "../firmware/qmk/write-source.ts";
import { BuildFailure, type BuildErrorCode, DETERMINISTIC_BUILD_CODES, ENGINE_RESTART_BUILD_CODES, isBuildErrorCode } from "../firmware/toolchain/build-failure.ts";
import { keyboardWriteInProgress } from "../firmware/toolchain/write-guard.ts";
import { CheckoutError } from "../firmware/toolchain/checkout.ts";
import type { FlashNote, FlashPermissionCode, FlashState } from "../firmware/toolchain/flash-state.ts";
import { LockAbortedError, LockTimeoutError, processAlive } from "../firmware/toolchain/lock.ts";
import { commandArg } from "./command-words.ts";
import { LogSink } from "../firmware/toolchain/run.ts";
import { listUsbDevices } from "../firmware/toolchain/usb.ts";
import {
  type BuildRow, type FlashRow, activeFlashes, builtRevisionIds, createBuild, createFlash, finishBuild, finishFlash, findBuild, findFlash, latestSuccessfulBuild,
  newBuildId, newFlashId, runningBuilds, setFlashProgress,
} from "../persistence/builds.ts";
import { recordHandsFreeProof } from "../persistence/syncs.ts";
import { appendLog } from "../persistence/log.ts";
import { findLayoutRow, listLayoutRows, revisionChain } from "../persistence/layouts.ts";
import { recordVersion } from "../persistence/versions.ts";
import { cacheDir } from "../persistence/paths.ts";
import { showBoard } from "./boards.ts";
import type { App } from "./context.ts";
import { NotFoundError, UsageError, ValidationFailedError } from "./errors.ts";
import { type GeneratedSource, type HandsFreeOverrides, SourceError, driverFor } from "./firmware-drivers.ts";
import { BoardRevisionNeededError, BuildFailedError, BuildFileGoneError, BuildNotCancellableError, FlashFailedError, FlashNotCancellableError, FlashToolMissingError } from "./firmware-errors.ts";
import { type LayoutView, getLayout } from "./layouts.ts";
import { type FlashPlan, flashPlanFor } from "./firmware-flash-plan.ts";
import { containerWorkRunning, ensureDocker, forcedRestartEngine } from "./toolchain.ts";
import { syncSupported } from "./sync-keyboard.ts";

// These are the shapes of Build and Flash in src/api/http.ts (a superset: the extra fields are for
// the CLI). app can't import src/api, so test/app/firmware.test.ts checks they stay assignable.
export type BuildView = {
  id: string;
  revisionId: string;
  layoutId: string;
  boardRevision: string;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  /**
   * Why it failed as a code the UI acts on: "docker_unavailable" shows the Docker callout (D-488); "cancelled" is a stop the person asked
   * for (R3-10); "compile_error" and "too_large" fail the same way every time, so the UI offers `lastBuilt` instead of Build again (R5-02).
   */
  errorCode: BuildErrorCode | null;
  /** For a build that fails the same way every time: the newest earlier revision in its history that built, or null (R5-02). */
  lastBuilt: { revisionId: string; summary: string } | null;
  /** For a build that failed on the engine's own state (`stale_mount`, `stuck_container`): the engine keyloom can restart, or null (R6-09). */
  restartEngine: string | null;
  /**
   * For `folder_not_shared`: the folder Docker couldn't see and the engine that decides what it shares (Colima or a Mac app), or null
   * when keyloom can't tell which engine runs (D-536).
   */
  folderNotShared: { folder: string; engine: string | null } | null;
  /** What flashing this build will need, so the dialog knows before anyone clicks (D-489, D-490). */
  flashPlan: FlashPlan;
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
  /** True only when the flasher read back this exact build marker from the keyboard. */
  verified: boolean;
  /** Why it failed, as a code the UI acts on (D-501): a permission to grant, or a cancel before anything was written. */
  errorCode: FlashErrorCode | null;
  /** While it waits: the permission that stopped keyloom restarting the keyboard itself, so the page can open its pane. */
  instructionCode: FlashPermissionCode | null;
  /** True while it waits for the bootloader and nothing has been written, in this process: Cancel is safe (D-501). */
  cancellable: boolean;
  /**
   * True for a written flash that isn't verified, on a board whose running build keyloom can read: Check the keyboard again (D-501). That
   * is a success without a verified line, or a failure whose write finished and only the confirmation failed (`not_confirmed`).
   */
  checkable: boolean;
  logTail: string[];
  logPath: string;
};

/** Why a flash failed, as the UI acts on it (D-501). */
export type FlashErrorCode = FlashPermissionCode | "cancelled" | "not_confirmed" | "write_timeout";

const LOG_TAIL_LINES = 30;
const WRITING_INSTRUCTION = "Don't unplug the keyboard. Flashing takes a few seconds.";

// What the person must do now, as the flasher last said it. A UF2 flash asks for two different things in a row
// (the right half, then the left), so the text can't come from the status alone. Held in memory because the
// flash runs in this process; a row whose process has gone is reaped, and its text is no longer needed.
const flashInstructions = new Map<string, string | null>();

const buildTasks = new Map<string, Promise<void>>();
// What stops a build running in this process (R3-10). A build never flashes, so stopping one can't reach a keyboard; a sync that was
// going to flash it sees a failed build and doesn't.
const buildControllers = new Map<string, AbortController>();
const flashTasks = new Map<string, Promise<void>>();
// What a running flash in this process lets the page do: cancel it until the keyboard is in its bootloader, and name the permission it
// waits on (D-501). `committed` is set when the flasher writes or says keyloom put the keyboard in its bootloader, and never goes back,
// so a split board whose first half is written can't be cancelled with its second half waiting (D-506). `onCommit` wakes a cancel
// that is waiting to hear whether the flasher stopped or went on to write. `writingNow` follows the flasher's latest state, as the
// sync engine's `committed` does: shutdown cancels a split flash whose next half waits for a hand, so it never holds the stop for
// that half's whole wait while the desktop app kills a server after 30 s. `stopOnWait` is a shutdown that found the flash writing: it
// cancels the flash when the flasher next waits without anything in its bootloader, such as a split board's next half.
type FlashControl = { abort: AbortController; committed: boolean; writingNow: boolean; cancelled: boolean; stopOnWait: boolean; problem: FlashPermissionCode | null; onCommit: () => void };
const flashControls = new Map<string, FlashControl>();
// Shutdown belongs to one App: serve's stop must not refuse flashes for another App in the same process, such as a test run's.
const pendingFlashStarts = new WeakMap<App, Set<Promise<void>>>();
const drainingApps = new WeakSet<App>();

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
  if (board.definition.firmware === "kanata") throw new UsageError(`${board.definition.name} is applied by writing a config file, not built and flashed; use \`keyloom sync\``);
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
  throw new BoardRevisionNeededError(
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
  const board = boardOf(app, row.layoutId);
  const errorCode = isBuildErrorCode(row.errorCode) ? row.errorCode : null;
  return {
    id: row.id, revisionId: row.revisionId, layoutId: row.layoutId, boardRevision: row.boardRevision, status: row.status, error: row.error,
    errorCode,
    lastBuilt: row.status === "failed" && errorCode !== null && DETERMINISTIC_BUILD_CODES.has(errorCode) ? lastBuiltBefore(app, row) : null,
    // Asked only for these failures, so a poll of a running or finished build never looks for the engine.
    restartEngine: row.status === "failed" && errorCode !== null && ENGINE_RESTART_BUILD_CODES.has(errorCode) ? ((await forcedRestartEngine())?.name ?? null) : null,
    folderNotShared: row.status === "failed" && errorCode === "folder_not_shared" && board ? { folder: checkoutDirFor(board), engine: (await forcedRestartEngine())?.name ?? null } : null,
    flashPlan: board ? flashPlanFor(board, row.boardRevision) : { manual: null, tool: null, canReveal: process.platform === "darwin" },
    startedAt: row.startedAt, finishedAt: row.finishedAt, logTail: await tailOf(logPath),
    artifactPath: row.artifactPath === null ? null : absolute(app, row.artifactPath), logPath,
  };
}

/**
 * The newest revision before `row`'s, in its own history, with a build for the same board revision that succeeded (R5-02). Going back to it is the undo with `to`
 * (D-502): a new revision, so the one that failed stays in History.
 */
function lastBuiltBefore(app: App, row: BuildRow): { revisionId: string; summary: string } | null {
  const built = builtRevisionIds(app.db, row.layoutId, row.boardRevision);
  const found = revisionChain(app.db, row.layoutId, row.revisionId).slice(1).find((r) => built.has(r.id));
  return found === undefined ? null : { revisionId: found.id, summary: found.summary };
}

/** The board a build's layout is for, or undefined when the layout or its board has gone. */
function boardOf(app: App, layoutId: string): Board | undefined {
  const boardId = findLayoutRow(app.db, layoutId)?.boardId;
  if (boardId === undefined) return undefined;
  try {
    return showBoard(boardId);
  } catch (err) {
    if (err instanceof NotFoundError) return undefined;
    throw err;
  }
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
  requirePlatformSupport("keyloom build");
  const view = getLayout(app, ref, opts.revisionId);
  const boardRevision = await resolveBoardRevision(view.board, opts.boardRevision);
  const id = newBuildId();
  const row = createBuild(app.db, { id, revisionId: view.revision.id, layoutId: view.layout.id, boardRevision, logPath: `logs/build-${id}.log` });
  const control = new AbortController();
  buildControllers.set(id, control);
  // The caller's signal (a CLI's Ctrl-C, a sync's stop) and the page's Cancel both stop the same build.
  const signal = opts.signal === undefined ? control.signal : AbortSignal.any([opts.signal, control.signal]);
  const task = runBuild(app, view, row, opts.onProgress, signal, control.signal);
  buildTasks.set(id, task);
  void task.finally(() => {
    buildTasks.delete(id);
    buildControllers.delete(id);
  });
  return toBuildView(app, row);
}

const BUILD_STOPPED = "Build stopped.";

async function runBuild(app: App, view: LayoutView, row: BuildRow, onProgress: ((line: string) => void) | undefined, signal: AbortSignal, cancelled: AbortSignal): Promise<void> {
  const log = new LogSink(absolute(app, row.logPath));
  const say = (line: string) => {
    log.line(line);
    onProgress?.(line);
  };
  try {
    say(`keyloom: build ${row.id} of "${view.layout.name}" (${view.revision.id}) for ${view.board.definition.id} ${row.boardRevision}`);
    // Before the checkout: a closed Docker Desktop should not cost a multi-gigabyte clone, and should not be
    // the person's job to fix: keyloom starts the engine it finds and says so in this log (D-486).
    const docker = await ensureDocker({ onProgress: say, signal });
    if (cancelled.aborted) throw new BuildFailure(BUILD_STOPPED, "cancelled");
    if (!docker.ok) throw new BuildFailure(docker.reason, "docker_unavailable");
    const driver = driverFor(view.board);
    let source: GeneratedSource;
    try {
      source = driver.generate(view, row.boardRevision, row.id);
    } catch (err) {
      if (err instanceof SourceError) throw new BuildFailure(`This layout can't be written as ${driver.name} source: ${err.message}`, "source_error");
      throw err;
    }
    const artifactRel = `artifacts/${row.id}.${driver.artifactExtension(view.board, row.boardRevision)}`;
    const checkoutDir = checkoutDirFor(view.board);
    await driver.build({
      view, boardRevision: row.boardRevision, source, checkoutDir, imageContextDir: join(cacheDir(), "images", view.board.definition.id.replace("/", "-")),
      artifactPath: absolute(app, artifactRel), log, containerName: `keyloom-${row.id}`, ...(onProgress ? { onLine: onProgress } : {}),
      signal,
    });
    finishBuild(app.db, row.id, { artifactPath: artifactRel });
    appendLog(app.dataDir, {
      event: "build",
      buildId: row.id,
      layoutId: view.layout.id,
      revisionId: row.revisionId,
      boardId: view.board.definition.id,
      status: "succeeded",
      artifactRel,
    });
  } catch (err) {
    // A Cancel ends the build as stopped, whichever step it interrupted: a checkout, a Docker start or the container (R3-10).
    if (cancelled.aborted) {
      log.line("keyloom: build stopped");
      finishBuild(app.db, row.id, { error: BUILD_STOPPED, errorCode: "cancelled" });
      appendLog(app.dataDir, { event: "build", buildId: row.id, layoutId: view.layout.id, revisionId: row.revisionId, boardId: view.board.definition.id, status: "failed", error: BUILD_STOPPED });
      return;
    }
    const known = err instanceof BuildFailure || err instanceof CheckoutError || err instanceof LockTimeoutError || err instanceof LockAbortedError;
    if (!known) log.line(`keyloom: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    const message = known ? (err as Error).message : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    log.line(`keyloom: build failed: ${message}`);
    finishBuild(app.db, row.id, { error: message, errorCode: err instanceof BuildFailure ? err.code : null });
    appendLog(app.dataDir, {
      event: "build",
      buildId: row.id,
      layoutId: view.layout.id,
      revisionId: row.revisionId,
      boardId: view.board.definition.id,
      status: "failed",
      error: message,
    });
  } finally {
    log.close();
  }
}

export async function getBuild(app: App, id: string): Promise<BuildView> {
  const row = findBuild(app.db, id);
  if (!row) throw new NotFoundError(`no build "${id}"`);
  return toBuildView(app, reapBuild(app, row));
}

/**
 * Stops a build running in this process (R3-10): its Docker start, checkout, wait for another build's lock or container is stopped, and
 * the container removed by the driver's own cleanup. Answers at once with the build as it is now: removing a container on a busy VM can
 * take longer than a request should wait, so the poll (or waitForBuild) sees it end as stopped.
 */
export async function cancelBuild(app: App, id: string): Promise<BuildView> {
  const row = findBuild(app.db, id);
  if (!row) throw new NotFoundError(`no build "${id}"`);
  const control = buildControllers.get(id);
  if (control === undefined) {
    throw new BuildNotCancellableError(row.status === "running" ? `build ${id} runs in another keyloom, so it can't be stopped from here` : `build ${id} has already finished, so there is nothing to stop`);
  }
  control.abort();
  return getBuild(app, id);
}

/** Waits for a build started in this process to finish; resolves at once for one that has already finished or runs elsewhere. */
export async function waitForBuild(app: App, id: string): Promise<BuildView> {
  await buildTasks.get(id);
  return getBuild(app, id);
}

/** Whether a build is running in this process or a flash is in progress anywhere: a sync waits for this, because only one board can be in its bootloader at a time and two builds in one checkout overwrite each other. */
export function firmwareBusy(app: App): boolean {
  return buildTasks.size > 0 || flashing(app);
}

const flashing = (app: App): boolean => activeFlashes(app.db).map((f) => reapFlash(app, f)).some((f) => f.status === "waiting_for_bootloader" || f.status === "writing");

/**
 * What a forced restart would wait for now: the work it would stop ("a build" here or in another live keyloom with the same data
 * directory, then each container run), and whether keyloom is writing to a keyboard. One read for the refusal and for the page's wait.
 */
function engineRestartHolds(app: App): { stopping: string[]; writing: boolean } {
  const building = buildTasks.size > 0 || runningBuilds(app.db).map((row) => reapBuild(app, row)).some((row) => row.status === "running");
  return { stopping: [...(building ? ["a build"] : []), ...containerWorkRunning()], writing: flashing(app) || keyboardWriteInProgress() };
}

/** The refusal of a forced restart, naming what it would stop ("a build", "a lab analysis"). */
export function engineRestartBlocked(running: readonly string[]): string {
  const names = running.length === 1 ? running[0] : `${running.slice(0, -1).join(", ")} and ${running.at(-1)}`;
  const one = running.length === 1;
  return `keyloom is running ${names}, and restarting Docker now would stop ${one ? "it" : "them"}. Restart Docker once ${one ? "that has" : "they have"} finished.`;
}

/**
 * Why Docker can't be restarted for a build now, or null (R6-09). A forced restart stops every container, so it waits for any build
 * here or in another live keyloom, a flash and a keyboard write (the same things a sync waits for, `firmwareBusy`, D-506), and for a lab
 * analysis, a board review's tests or an emulator run in this keyloom. Another keyloom with its own data directory keeps its builds in
 * its own database, so this can't see them (D-529).
 */
export function engineRestartBlocker(app: App): string | null {
  const { stopping: running, writing } = engineRestartHolds(app);
  // A flash or a keyboard write uses no Docker, so a restart wouldn't stop it; the restart still waits, so nothing else happens to the
  // keyboard during a write, and the words say that instead of "would stop it".
  if (!writing) return running.length === 0 ? null : engineRestartBlocked(running);
  const wait = "keyloom is writing to a keyboard. Restart Docker once that has finished, so nothing else happens while it writes.";
  return running.length === 0 ? wait : `${engineRestartBlocked(running)} keyloom is also writing to a keyboard; wait for that too.`;
}

/**
 * Why Docker's build cache can't be freed now, or null (R8-04). A prune takes the cache a running build reads, so it waits for the same
 * work as a forced restart. It stops nothing and restarts nothing, so its words say only what runs and that freeing waits for it, never
 * the restart's sentence (PR #306 review).
 */
export function buildCachePruneBlocker(app: App): string | null {
  const { stopping, writing } = engineRestartHolds(app);
  if (stopping.length === 0 && !writing) return null;
  const names = stopping.length <= 1 ? stopping[0] : `${stopping.slice(0, -1).join(", ")} and ${stopping.at(-1)}`;
  const doing = [...(names === undefined ? [] : [`running ${names}`]), ...(writing ? ["writing to a keyboard"] : [])];
  const one = stopping.length + (writing ? 1 : 0) === 1;
  return `keyloom is ${doing.join(" and ")}. Free Docker's build cache once ${one ? "it has" : "they have"} finished.`;
}

/**
 * What a forced restart waits for now, named for the person ("a build", "a lab analysis", "a keyboard write"), or empty when nothing
 * holds it. The page names it while it waits to restart by itself ("Restarts when the lab analysis ends", R7-04); the refusal itself
 * comes from `engineRestartBlocker`, inside the engine lock.
 */
export function engineRestartWork(app: App): string[] {
  const { stopping, writing } = engineRestartHolds(app);
  return [...stopping, ...(writing ? ["a keyboard write"] : [])];
}

/** Builds and waits. Throws BuildFailedError (exit 7) when the build fails. */
export async function buildAndWait(app: App, ref: string, opts: BuildOptions = {}): Promise<BuildView> {
  const started = await startBuild(app, ref, opts);
  await buildTasks.get(started.id);
  const done = await getBuild(app, started.id);
  if (done.status !== "succeeded") {
    // Only the terminal gets the command: the page has its own Go back for a layout that doesn't fit (D-502).
    const view = getLayout(app, started.layoutId, started.revisionId);
    const hint = misfitHint(view) || sameEveryTimeHint(done, view);
    throw new BuildFailedError(`build ${done.id} failed: ${done.error ?? "unknown error"}${hint} (log: ${done.logPath})`, done.id, done.logPath, done.errorCode);
  }
  return done;
}

/**
 * The way back for a layout whose layers no longer have one binding per key on its board, which no build can fix (R3-11): the last
 * version that fit. Empty for any other layout.
 */
export function misfitHint(view: LayoutView): string {
  const keys = view.board.definition.keyCount;
  if (view.document.layers.every((layer) => layer.bindings.length === keys)) return "";
  const name = commandArg(view.layout.name);
  return `. Its layers no longer match the ${keys} keys of ${view.board.definition.name}; find a version that did with \`keyloom version list ${name}\`, then go back to it with \`keyloom version restore ${name} <version>\``;
}

/**
 * The way back for a build that fails the same way every time (R5-02): a version that was on the keyboard was built. The page offers the
 * last revision that built as Go back instead. Empty for any other failure.
 */
export function sameEveryTimeHint(build: Pick<BuildView, "errorCode">, view: LayoutView): string {
  if (build.errorCode === null || !DETERMINISTIC_BUILD_CODES.has(build.errorCode)) return "";
  const name = commandArg(view.layout.name);
  return `. Building it again fails the same way; find a version that was on the keyboard with \`keyloom version list ${name}\`, then go back to it with \`keyloom version restore ${name} <version>\``;
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
  const board = boardOfFlash(app, row);
  const instruction = instructionFor(row, board);
  // The control's problem, committed and cancelled change with each state too, so they are read with the instruction they go with.
  const control = flashControls.get(row.id);
  const waiting = row.status === "waiting_for_bootloader";
  const instructionCode = waiting ? (control?.problem ?? null) : null;
  const cancellable = waiting && control !== undefined && !control.committed && !control.cancelled;
  const logTail = await tailOf(logPath);
  const note = row.status === "succeeded" ? (logTail.map((l) => VERIFIED.exec(l)?.[1]).findLast((n) => n !== undefined) ?? null) : null;
  const verified = note !== null && note.includes(`build ${row.buildId}`);
  return {
    id: row.id, buildId: row.buildId, status: row.status, error: row.error, startedAt: row.startedAt, finishedAt: row.finishedAt,
    instruction, note, verified,
    errorCode: row.status === "failed" ? flashErrorCode(row.errorCode) : null,
    instructionCode,
    cancellable,
    checkable: ((row.status === "succeeded" && !verified) || (row.status === "failed" && row.errorCode === "not_confirmed")) && board !== undefined && syncSupported(board),
    logTail, logPath,
  };
}

// A code a later keyloom stored and this one doesn't know reads as none: the sentence still says what happened.
function flashErrorCode(code: string | null): FlashErrorCode | null {
  switch (code) {
    case "cancelled":
    case "not_confirmed":
    case "write_timeout":
    case "permission_files_and_folders":
    case "permission_input_monitoring":
      return code;
    default:
      return null;
  }
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
  /** Called with the flasher's own word on each state change, including whether the person must act and whether it is verifying; keyboard sync reads it. */
  onFlasherState?: (state: FlashState, instruction: string | null, note: FlashNote | undefined) => void;
  /** Aborting stops the flasher, so nothing is left waiting for the keyboard. */
  signal?: AbortSignal;
  /** How long to wait for the keyboard to enter its bootloader (default 2 minutes). Short values are for tests. */
  bootloaderWaitMs?: number;
  /** Where a UF2 keyboard's boot drives appear (default: the machine's own, `/Volumes` on macOS). Tests pass a temporary directory. */
  volumesRoot?: string;
  /** How a keyboard is found and restarted (default: this machine's USB, raw HID and serial ports). Tests pass fakes. */
  handsFree?: HandsFreeOverrides;
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
  // A kanata board has no build to flash, so `keyloom build` would only refuse again: its way on is a sync (R3-11).
  const board = boardOf(app, layoutId);
  if (board?.definition.firmware === "kanata") throw new UsageError(`${board.definition.name} is applied by writing a config file, not flashed; use \`keyloom sync ${commandArg(opts.layout ?? layoutId)}\``);
  const row = latestSuccessfulBuild(app.db, layoutId);
  if (!row) throw new UsageError(`no successful build of this layout yet; run \`keyloom build ${opts.layout ?? layoutId}\` first`);
  return row;
}

/** Starts flashing a successful build and returns the flash at once, waiting for the bootloader. */
export async function startFlash(app: App, opts: FlashOptions): Promise<FlashView> {
  if (drainingApps.has(app)) throw new UsageError("keyloom is shutting down; no new flashes can start");
  const pending = Promise.withResolvers<void>();
  const starts = pendingFlashStarts.get(app) ?? new Set<Promise<void>>();
  pendingFlashStarts.set(app, starts);
  starts.add(pending.promise);
  try {
    requirePlatformSupport("keyloom flash");
    const build = chooseBuild(app, opts);
    if (build.status !== "succeeded" || build.artifactPath === null) {
      throw new UsageError(`build ${build.id} is ${build.status}${build.error ? ` (${build.error})` : ""}; only a successful build can be flashed`);
    }
    const artifact = absolute(app, build.artifactPath);
    if (!(await Bun.file(artifact).exists())) throw new BuildFileGoneError(`build ${build.id}'s file ${artifact} is gone; build it again`);

    const busy = activeFlashes(app.db).map((f) => reapFlash(app, f)).find((f) => f.status === "waiting_for_bootloader" || f.status === "writing");
    if (busy) throw new UsageError(`flash ${busy.id} is already in progress; wait for it to finish`);

    const layout = findLayoutRow(app.db, build.layoutId);
    const board = showBoard(layout?.boardId ?? "");
    // Checked before a flash row exists, so a missing Zapp is an install to do, not a flash that failed (D-489).
    const tool = board ? flashPlanFor(board, build.boardRevision, { ...(opts.handsFree?.dfu?.tools ? { dfuTools: opts.handsFree.dfu.tools } : {}) }).tool : null;
    if (tool !== null && !tool.installed) throw new FlashToolMissingError(tool.name);

    const id = newFlashId();
    const row = createFlash(app.db, { id, buildId: build.id, logPath: `logs/flash-${id}.log` });
    const control: FlashControl = { abort: new AbortController(), committed: false, writingNow: false, cancelled: false, stopOnWait: false, problem: null, onCommit: () => undefined };
    flashControls.set(id, control);
    // A longer wait was asked for, so the first instruction says so rather than the default.
    if (opts.bootloaderWaitMs !== undefined && board) flashInstructions.set(id, driverFor(board).waitingInstruction(board, opts.bootloaderWaitMs));
    // The caller's signal (a CLI's Ctrl-C, a sync's stop) and the page's Cancel both stop the same flasher.
    const signal = opts.signal === undefined ? control.abort.signal : AbortSignal.any([opts.signal, control.abort.signal]);
    const task = runFlash(app, row, board, build.boardRevision, artifact, { ...opts, signal }, control);
    flashTasks.set(id, task);
    void task.finally(() => {
      flashTasks.delete(id);
      flashControls.delete(id);
    });
    return toFlashView(app, row);
  } finally {
    starts.delete(pending.promise);
    pending.resolve();
  }
}

/**
 * Refuses new flashes, cancels the ones still waiting for the keyboard, and waits for the rest, without surfacing task failures. A
 * waiting flash would otherwise hold the shutdown with no limit, and the desktop app kills a server that takes over 30 s, leaving
 * Zapp running with no parent to flash whenever the keyboard next enters its bootloader. The flasher has the last word, as for
 * the page's Cancel: a keyboard already in its bootloader is written, and that write is waited for (D-506).
 */
export async function drainManualFlashTasks(app: App): Promise<void> {
  drainingApps.add(app);
  // Accepted starts can register tasks after their artifact check; settle them before taking the task snapshot.
  await Promise.allSettled([...(pendingFlashStarts.get(app) ?? [])]);
  for (const control of flashControls.values()) {
    if (control.cancelled) continue;
    // A write is never cut off; its flash is cancelled when it next waits for a keyboard, or the shutdown would wait out that whole wait.
    if (control.writingNow) control.stopOnWait = true;
    else cancelControl(control);
  }
  await Promise.allSettled([...flashTasks.values()]);
}

function cancelControl(control: FlashControl): void {
  control.cancelled = true;
  control.abort.abort();
}

async function runFlash(app: App, row: FlashRow, board: Board, boardRevision: string, artifact: string, opts: FlashOptions, control: FlashControl): Promise<void> {
  const log = new LogSink(absolute(app, row.logPath));
  // States are told in order and the last one before the flash task ends: each view reads the log, so unchained reads can land
  // out of order ("writing" after "succeeded") or after a caller already has the result.
  let told: Promise<void> = Promise.resolve();
  const notify = () => {
    const current = findFlash(app.db, row.id);
    const onState = opts.onState;
    if (!current || !onState) return;
    const view = toFlashView(app, current);
    told = told.then(() => view).then(onState).catch(() => undefined);
  };
  try {
    log.line(`keyloom: flash ${row.id} of build ${row.buildId}`);
    notify();
    const result = await driverFor(board).flash({
      board, boardRevision, buildId: row.buildId, artifactPath: artifact, log, lastGoodDir: absolute(app, "firmware/last-good"),
      ...(opts.handsFree ? { handsFree: opts.handsFree } : {}), ...(opts.onProgress ? { onLine: opts.onProgress } : {}),
      ...(opts.bootloaderWaitMs === undefined ? {} : { bootloaderWaitMs: opts.bootloaderWaitMs }),
      ...(opts.volumesRoot === undefined ? {} : { volumesRoot: opts.volumesRoot }),
      ...(opts.signal ? { signal: opts.signal } : {}),
      onState: (state: FlashState, instruction: string | null, note?: FlashNote) => {
        opts.onFlasherState?.(state, instruction, note);
        control.writingNow = state === "writing" || note?.inBootloader === true;
        if (state === "writing" || note?.inBootloader) {
          control.committed = true;
          control.onCommit();
        }
        control.problem = state === "waiting_for_bootloader" ? (note?.problem ?? null) : null;
        if (control.stopOnWait && !control.cancelled && state === "waiting_for_bootloader" && !control.writingNow) cancelControl(control);
        if (state === "waiting_for_bootloader" || state === "writing") {
          flashInstructions.set(row.id, instruction);
          setFlashProgress(app.db, row.id, state);
          notify();
        }
      },
    });
    const verified = result.state === "succeeded" && result.output.some((line) => line.startsWith("keyloom: Verified:") && line.includes(`build ${row.buildId}`));
    app.db.transaction(() => {
      // A cancel that stopped the flash before any write is said as one, so the page offers the flash again rather than a failure.
      const errorCode: FlashErrorCode | null = control.cancelled && !control.committed ? "cancelled" : (result.errorCode ?? null);
      finishFlash(app.db, row.id, result.state === "succeeded" ? null : { error: result.error ?? "the flash failed", errorCode });
      if (verified) {
        const build = findBuild(app.db, row.buildId);
        if (build) {
          const flash = findFlash(app.db, row.id);
          recordVersion(app.db, {
            layoutId: build.layoutId, revisionId: build.revisionId, boardId: board.definition.id, syncId: null,
            at: flash?.finishedAt ?? Date.now(),
          });
        }
      }
    })();
    appendLog(app.dataDir, {
      event: "flash",
      flashId: row.id,
      buildId: row.buildId,
      boardId: board.definition.id,
      status: result.state === "succeeded" ? "succeeded" : "failed",
      error: result.state === "succeeded" ? undefined : (result.error ?? "the flash failed"),
    });
    // Auto-sync may turn on only for a board keyloom has reached without hands, and this is the one place that knows (D-160).
    if (result.state === "succeeded" && result.handsFree) recordHandsFreeProof(app.db, board.definition.id, row.buildId);
  } catch (err) {
    log.line(`keyloom: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    finishFlash(app.db, row.id, { error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` });
    appendLog(app.dataDir, {
      event: "flash",
      flashId: row.id,
      buildId: row.buildId,
      boardId: board.definition.id,
      status: "failed",
      error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    flashInstructions.delete(row.id);
    log.close();
    notify();
    await told;
  }
}

export async function getFlash(app: App, id: string): Promise<FlashView> {
  const row = findFlash(app.db, id);
  if (!row) throw new NotFoundError(`no flash "${id}"`);
  return toFlashView(app, reapFlash(app, row));
}

// Long enough for the flasher to stop and say so (Zapp is killed at once, a UF2 wait wakes at once), short enough that the page never hangs on it.
const CANCEL_SETTLE_MS = 3000;

/**
 * Stops a flash that is waiting for the bootloader, before anything was written (D-501). Refuses once the keyboard is in its bootloader,
 * as `stop()` does for a sync (D-497, D-506): cutting a write off is how a keyboard is left in its bootloader with half an image. The
 * flasher has the last word, because Zapp writes without a sign the moment the bootloader appears: it looks at USB before it stops.
 */
export async function cancelFlash(app: App, id: string): Promise<FlashView> {
  const row = findFlash(app.db, id);
  if (!row) throw new NotFoundError(`no flash "${id}"`);
  const control = flashControls.get(id);
  if (control === undefined || (row.status !== "waiting_for_bootloader" && row.status !== "writing")) {
    throw new FlashNotCancellableError("finished", `flash ${id} isn't waiting for the keyboard any more, so there is nothing to cancel`);
  }
  const writing = () => new FlashNotCancellableError("writing", `flash ${id}'s keyboard is in its bootloader and keyloom is writing to it; it can't be stopped safely, so it finishes`);
  if (control.committed || row.status === "writing") throw writing();
  const committed = new Promise<void>((resolve) => {
    control.onCommit = resolve;
  });
  if (!control.cancelled) {
    control.cancelled = true;
    control.abort.abort();
  }
  await Promise.race([flashTasks.get(id), committed, Bun.sleep(CANCEL_SETTLE_MS)]);
  if (control.committed) throw writing();
  return getFlash(app, id);
}

/** Waits for a flash started in this process to finish, and returns it. */
export async function waitForFlash(app: App, id: string): Promise<FlashView> {
  await flashTasks.get(id);
  return getFlash(app, id);
}

/** Flashes and waits. Throws FlashFailedError (exit 8) when the flash fails or no bootloader appears. */
export async function flashAndWait(app: App, opts: FlashOptions): Promise<FlashView> {
  const started = await startFlash(app, opts);
  await flashTasks.get(started.id);
  const done = await getFlash(app, started.id);
  if (done.status !== "succeeded") {
    // The write finished and only the confirmation failed: reading the keyboard again may verify it without another flash.
    const next = done.checkable ? `; \`keyloom flash --check ${done.id}\` reads the keyboard again` : "";
    throw new FlashFailedError(`flash ${done.id} failed: ${done.error ?? "unknown error"} (log: ${done.logPath})${next}`, done.id, done.logPath);
  }
  return done;
}
