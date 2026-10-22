import { requirePlatformSupport } from "../firmware/toolchain/platform-support.ts";
// Use case: what would this layout type for a sequence of key presses, run on the real firmware logic (10#emulate-prints-what-a-layout-types-for-a-sequence-of-key-presses).
import { join } from "node:path";
import { EmulationError } from "../firmware/emulate/error.ts";
import { ScriptError, parseScript } from "../firmware/emulate/script.ts";
import type { EmulationResult, EmulatorEvent } from "../firmware/emulate/types.ts";
import { BuildFailure } from "../firmware/toolchain/build-failure.ts";
import { CheckoutError } from "../firmware/toolchain/checkout.ts";
import { dockerStatus } from "../firmware/toolchain/docker.ts";
import { LockTimeoutError } from "../firmware/toolchain/lock.ts";
import { LogSink } from "../firmware/toolchain/run.ts";
import { cacheDir } from "../persistence/paths.ts";
import type { App } from "./context.ts";
import { EMULATORS } from "./emulators.ts";
import { UsageError } from "./errors.ts";
import { checkoutDirFor, sourceFor } from "./firmware.ts";
import { EmulateFailedError } from "./firmware-errors.ts";
import { type LayoutView, getLayout } from "./layouts.ts";

export type EmulateOptions = {
  /** The key script (10#emulate-prints-what-a-layout-types-for-a-sequence-of-key-presses), such as "hold 31 300 then tap 32". */
  script: string;
  /** A layout revision ID; the head when omitted. */
  revisionId?: string;
  boardRevision?: string;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
};

export type EmulateOutcome = EmulationResult & { layoutId: string; revisionId: string; logPath: string };

export async function emulateLayout(app: App, ref: string, opts: EmulateOptions): Promise<EmulateOutcome> {
  const view = getLayout(app, ref, opts.revisionId);
  let events;
  try {
    events = parseScript(opts.script, { keyCount: view.board.definition.keyCount });
  } catch (err) {
    if (err instanceof ScriptError) throw new UsageError(err.message);
    throw err;
  }
  // No hardware detection: the emulator needs no connected keyboard, so the first revision stands in unless one is named.
  const boardRevision = opts.boardRevision ?? (view.board.definition.revisions[0] as { id: string }).id;
  return emulateEvents(app, view, events, {
    boardRevision, ...(opts.onProgress ? { onProgress: opts.onProgress } : {}), ...(opts.signal ? { signal: opts.signal } : {}),
  });
}

export type EmulateEventsOptions = {
  boardRevision: string;
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
  /** One log for several runs (the typing lab replays one recording many times); each run gets its own when omitted. */
  log?: LogSink;
  /** Quiet time before the first event; see EmulatorInput.leadMs. */
  leadMs?: number;
  /** False keeps the run from being saved for next time; see EmulatorInput.cache. */
  cache?: boolean;
};

/** Runs key events on the real firmware logic for `view`'s document (which a caller may have changed from the stored one). */
export async function emulateEvents(app: App, view: LayoutView, events: readonly EmulatorEvent[], opts: EmulateEventsOptions): Promise<EmulateOutcome> {
  requirePlatformSupport("keyloom emulate");
  const board = view.board.definition;
  const emulator = board.firmware === "kanata" ? undefined : EMULATORS[board.firmware];
  if (!emulator) throw new UsageError(`emulating ${board.firmware.toUpperCase()} boards isn't available yet`);

  const id = `emu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const logRel = `logs/emulate-${id}.log`;
  const logPath = opts.log?.path ?? join(app.dataDir, logRel);
  const log = opts.log ?? new LogSink(logPath);
  try {
    // Before the checkout: a missing Docker should not first cost a multi-gigabyte download.
    const docker = await dockerStatus();
    if (!docker.ok) throw new BuildFailure(docker.reason);
    const slug = board.id.replace("/", "-");
    const result = await emulator({
      board,
      boardRevision: opts.boardRevision,
      source: sourceFor(view, opts.boardRevision),
      events,
      ...(opts.leadMs === undefined ? {} : { leadMs: opts.leadMs }),
      ...(opts.cache === undefined ? {} : { cache: opts.cache }),
      checkoutDir: checkoutDirFor(view.board),
      workDir: join(cacheDir(), "emulate", slug),
      imageContextDir: join(cacheDir(), "images", slug),
      log,
      containerName: `keyloom-${id}`,
      ...(opts.onProgress ? { onLine: opts.onProgress } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return { ...result, layoutId: view.layout.id, revisionId: view.revision.id, logPath };
  } catch (err) {
    const known = err instanceof EmulationError || err instanceof BuildFailure || err instanceof CheckoutError || err instanceof LockTimeoutError;
    if (!known) throw err;
    log.line(`keyloom: emulation failed: ${err.message}`);
    throw new EmulateFailedError(`${err.message} (log: ${logPath})`, logPath);
  } finally {
    if (!opts.log) log.close();
  }
}
