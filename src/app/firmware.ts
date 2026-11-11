import { requirePlatformSupport } from "../firmware/toolchain/platform-support.ts";
// Use cases for firmware: generate, build and flash (01#modules). A build or flash returns its row
// at once and finishes in the background; callers poll getBuild / getFlash, which is what the web
// app does. The CLI waits with buildAndWait / flashAndWait.
import { join, resolve } from "node:path";
import type { Board } from "../boards/load.ts";
import { writeSource } from "../firmware/qmk/write-source.ts";
import { BuildFailure } from "../firmware/toolchain/build-failure.ts";
import { CheckoutError } from "../firmware/toolchain/checkout.ts";
import type { FlashNote, FlashPermissionCode, FlashState } from "../firmware/toolchain/flash-state.ts";
import { LockTimeoutError, processAlive } from "../firmware/toolchain/lock.ts";
import { LogSink } from "../firmware/toolchain/run.ts";
import { listUsbDevices } from "../firmware/toolchain/usb.ts";
import {
  type BuildRow, type FlashRow, activeFlashes, createBuild, createFlash, finishBuild, finishFlash, findBuild, findFlash, latestSuccessfulBuild,
  newBuildId, newFlashId, setFlashProgress,
} from "../persistence/builds.ts";
import { recordHandsFreeProof } from "../persistence/syncs.ts";
import { appendLog } from "../persistence/log.ts";
import { findLayoutRow, listLayoutRows } from "../persistence/layouts.ts";
import { recordVersion } from "../persistence/versions.ts";
import { cacheDir } from "../persistence/paths.ts";
import { showBoard } from "./boards.ts";
import type { App } from "./context.ts";
import { NotFoundError, UsageError, ValidationFailedError } from "./errors.ts";
import { type GeneratedSource, type HandsFreeOverrides, SourceError, driverFor } from "./firmware-drivers.ts";
import { BoardRevisionNeededError, BuildFailedError, FlashFailedError, FlashNotCancellableError, FlashToolMissingError } from "./firmware-errors.ts";
import { type LayoutView, getLayout } from "./layouts.ts";
import { type FlashPlan, flashPlanFor } from "./firmware-flash-plan.ts";
import { ensureDocker } from "./toolchain.ts";
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
  /** Why it failed as a code the UI acts on: "docker_unavailable" shows the Docker callout (D-488). */
  errorCode: "docker_unavailable" | null;
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
  /** True for a finished flash that isn't verified on a board whose running build keyloom can read: Check the keyboard again (D-501). */
  checkable: boolean;
  logTail: string[];
  logPath: string;
};

/** Why a flash failed, as the UI acts on it (D-501). */
export type FlashErrorCode = FlashPermissionCode | "cancelled";

const LOG_TAIL_LINES = 30;
const WRITING_INSTRUCTION = "Don't unplug the keyboard. Flashing takes a few seconds.";

// What the person must do now, as the flasher last said it. A UF2 flash asks for two different things in a row
// (the right half, then the left), so the text can't come from the status alone. Held in memory because the
// flash runs in this process; a row whose process has gone is reaped, and its text is no longer needed.
const flashInstructions = new Map<string, string | null>();

const buildTasks = new Map<string, Promise<void>>();
const flashTasks = new Map<string, Promise<void>>();
// What a running flash in this process lets the page do: cancel it until the first write, and name the permission it waits on (D-501).
// `wrote` never goes back, so a split board whose first half is written can't be cancelled with its second half waiting.
type FlashControl = { abort: AbortController; wrote: boolean; cancelled: boolean; problem: FlashPermissionCode | null };
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
  return {
    id: row.id, revisionId: row.revisionId, layoutId: row.layoutId, boardRevision: row.boardRevision, status: row.status, error: row.error,
    errorCode: row.errorCode === "docker_unavailable" ? "docker_unavailable" : null,
    flashPlan: board ? flashPlanFor(board, row.boardRevision) : { manual: null, tool: null, canReveal: process.platform === "darwin" },
    startedAt: row.startedAt, finishedAt: row.finishedAt, logTail: await tailOf(logPath),
    artifactPath: row.artifactPath === null ? null : absolute(app, row.artifactPath), logPath,
  };
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
    // Before the checkout: a closed Docker Desktop should not cost a multi-gigabyte clone, and should not be
    // the person's job to fix: keyloom starts the engine it finds and says so in this log (D-486).
    const docker = await ensureDocker({ onProgress: say, ...(signal === undefined ? {} : { signal }) });
    if (!docker.ok) throw new BuildFailure(docker.reason, "docker_unavailable");
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
    const known = err instanceof BuildFailure || err instanceof CheckoutError || err instanceof LockTimeoutError;
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

/** Waits for a build started in this process to finish; resolves at once for one that has already finished or runs elsewhere. */
export async function waitForBuild(app: App, id: string): Promise<BuildView> {
  await buildTasks.get(id);
  return getBuild(app, id);
}

/** Whether a build is running in this process or a flash is in progress anywhere: a sync waits for this, because only one board can be in its bootloader at a time and two builds in one checkout overwrite each other. */
export function firmwareBusy(app: App): boolean {
  if (buildTasks.size > 0) return true;
  return activeFlashes(app.db).map((f) => reapFlash(app, f)).some((f) => f.status === "waiting_for_bootloader" || f.status === "writing");
}

/** Builds and waits. Throws BuildFailedError (exit 7) when the build fails. */
export async function buildAndWait(app: App, ref: string, opts: BuildOptions = {}): Promise<BuildView> {
  const started = await startBuild(app, ref, opts);
  await buildTasks.get(started.id);
  const done = await getBuild(app, started.id);
  if (done.status !== "succeeded") throw new BuildFailedError(`build ${done.id} failed: ${done.error ?? "unknown error"} (log: ${done.logPath})`, done.id, done.logPath, done.errorCode);
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
  const board = boardOfFlash(app, row);
  const instruction = instructionFor(row, board);
  const logTail = await tailOf(logPath);
  const note = row.status === "succeeded" ? (logTail.map((l) => VERIFIED.exec(l)?.[1]).findLast((n) => n !== undefined) ?? null) : null;
  const verified = note !== null && note.includes(`build ${row.buildId}`);
  const control = flashControls.get(row.id);
  const waiting = row.status === "waiting_for_bootloader";
  return {
    id: row.id, buildId: row.buildId, status: row.status, error: row.error, startedAt: row.startedAt, finishedAt: row.finishedAt,
    instruction, note, verified,
    errorCode: row.status === "failed" ? flashErrorCode(row.errorCode) : null,
    instructionCode: waiting ? (control?.problem ?? null) : null,
    cancellable: waiting && control !== undefined && !control.wrote && !control.cancelled,
    checkable: row.status === "succeeded" && !verified && board !== undefined && syncSupported(board),
    logTail, logPath,
  };
}

// A code a later keyloom stored and this one doesn't know reads as none: the sentence still says what happened.
function flashErrorCode(code: string | null): FlashErrorCode | null {
  switch (code) {
    case "cancelled":
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
    if (!(await Bun.file(artifact).exists())) throw new UsageError(`build ${build.id}'s file ${artifact} is gone; build it again`);

    const busy = activeFlashes(app.db).map((f) => reapFlash(app, f)).find((f) => f.status === "waiting_for_bootloader" || f.status === "writing");
    if (busy) throw new UsageError(`flash ${busy.id} is already in progress; wait for it to finish`);

    const layout = findLayoutRow(app.db, build.layoutId);
    const board = showBoard(layout?.boardId ?? "");
    // Checked before a flash row exists, so a missing Zapp is an install to do, not a flash that failed (D-489).
    const tool = board ? flashPlanFor(board, build.boardRevision, { ...(opts.handsFree?.dfu?.tools ? { dfuTools: opts.handsFree.dfu.tools } : {}) }).tool : null;
    if (tool !== null && !tool.installed) throw new FlashToolMissingError(tool.name);

    const id = newFlashId();
    const row = createFlash(app.db, { id, buildId: build.id, logPath: `logs/flash-${id}.log` });
    const control: FlashControl = { abort: new AbortController(), wrote: false, cancelled: false, problem: null };
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

/** Refuses new flashes and waits for accepted starts and running flashes, without surfacing task failures. */
export async function drainManualFlashTasks(app: App): Promise<void> {
  drainingApps.add(app);
  // Accepted starts can register tasks after their artifact check; settle them before taking the task snapshot.
  await Promise.allSettled([...(pendingFlashStarts.get(app) ?? [])]);
  await Promise.allSettled([...flashTasks.values()]);
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
        if (state === "writing") control.wrote = true;
        control.problem = state === "waiting_for_bootloader" ? (note?.problem ?? null) : null;
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
      const errorCode: FlashErrorCode | null = control.cancelled && !control.wrote ? "cancelled" : (result.errorCode ?? null);
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
 * Stops a flash that is waiting for the bootloader, before anything was written (D-501). Refuses once the flasher has said it is
 * writing, as `stop()` does for a sync (D-497): cutting a write off is how a keyboard is left in its bootloader.
 */
export async function cancelFlash(app: App, id: string): Promise<FlashView> {
  const row = findFlash(app.db, id);
  if (!row) throw new NotFoundError(`no flash "${id}"`);
  const control = flashControls.get(id);
  if (control === undefined || (row.status !== "waiting_for_bootloader" && row.status !== "writing")) {
    throw new FlashNotCancellableError("finished", `flash ${id} isn't waiting for the keyboard any more, so there is nothing to cancel`);
  }
  if (control.wrote || row.status === "writing") {
    throw new FlashNotCancellableError("writing", `flash ${id} is already writing to the keyboard; it can't be stopped safely, so it finishes`);
  }
  if (!control.cancelled) {
    control.cancelled = true;
    control.abort.abort();
  }
  await Promise.race([flashTasks.get(id), Bun.sleep(CANCEL_SETTLE_MS)]);
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
  if (done.status !== "succeeded") throw new FlashFailedError(`flash ${done.id} failed: ${done.error ?? "unknown error"} (log: ${done.logPath})`, done.id, done.logPath);
  return done;
}
