// Use case: what would this layout type for a sequence of key presses, run on the real firmware logic (10#emulate-prints-what-a-layout-types-for-a-sequence-of-key-presses).
import { join } from "node:path";
import { EmulationError } from "../firmware/emulate/error.ts";
import { ScriptError, parseScript } from "../firmware/emulate/script.ts";
import type { EmulationResult } from "../firmware/emulate/types.ts";
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
import { getLayout } from "./layouts.ts";

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
  const board = view.board.definition;
  const emulator = board.firmware === "kanata" ? undefined : EMULATORS[board.firmware];
  if (!emulator) throw new UsageError(`emulating ${board.firmware.toUpperCase()} boards isn't available yet`);
  let events;
  try {
    events = parseScript(opts.script, { keyCount: board.keyCount });
  } catch (err) {
    if (err instanceof ScriptError) throw new UsageError(err.message);
    throw err;
  }

  const id = `emu_${Date.now().toString(36)}`;
  const logRel = `logs/emulate-${id}.log`;
  const logPath = join(app.dataDir, logRel);
  const log = new LogSink(logPath);
  try {
    // Before the checkout: a missing Docker should not first cost a multi-gigabyte download.
    const docker = await dockerStatus();
    if (!docker.ok) throw new BuildFailure(docker.reason);
    const slug = board.id.replace("/", "-");
    // No hardware detection: the emulator needs no connected keyboard, so the first revision stands in unless one is named.
    const boardRevision = opts.boardRevision ?? (board.revisions[0] as { id: string }).id;
    const result = await emulator({
      board,
      boardRevision,
      source: sourceFor(view, boardRevision),
      events,
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
    log.close();
  }
}
