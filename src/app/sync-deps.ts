// What the sync engine does to the outside world, behind one interface so its state machine is tested against fakes:
// read the keyboards, build a revision, flash a build. The default implementation is the build and flash use cases
// and the machine's own USB, which tests and demos replace through `HandsFreeOverrides`.
import { access } from "node:fs/promises";
import type { FlashNote, FlashState } from "../firmware/toolchain/flash-state.ts";
import { latestSuccessfulBuildOfRevision } from "../persistence/builds.ts";
import type { App } from "./context.ts";
import { type FlashOptions, startBuild, startFlash, waitForBuild, waitForFlash } from "./firmware.ts";
import type { HandsFreeOverrides } from "./firmware-drivers.ts";
import { applyToRemapper, disableRemapperFor } from "./remapper.ts";
import { type KeyboardReading, readKeyboards } from "./sync-keyboard.ts";
import { type DetectedKeyboard, detectKeyboards } from "./keyboard-detect.ts";
import type { UsbDevice } from "../firmware/toolchain/usb.ts";

export type BuildOutcome = { ok: true; buildId: string; reused: boolean } | { ok: false; error: string; buildId?: string };
export type FlashOutcome = { ok: true; flashId: string; verified: boolean; note: string | null } | { ok: false; flashId?: string; error: string };

export type RemapperDeps = {
  /** Writes, checks, reloads and verifies one revision on a software remapper. Never throws. */
  apply(a: { layoutId: string; revisionId: string }): Promise<{ ok: true; ms: number } | { ok: false; step: string; error: string }>;
  /** Loads the identity map. Never throws. */
  disable(boardId: string): Promise<{ ok: true } | { ok: false; error: string }>;
};

export type SyncDeps = {
  /** Present when a software-remapper board can be synced; the default implementation is the kanata use cases (21). */
  remapper?: RemapperDeps;
  readKeyboards(): Promise<Map<string, KeyboardReading>>;
  /**
   * The keyboards on USB that keyloom has no board for, from the devices the last `readKeyboards` saw (D-336): the new-keyboard card
   * follows the engine's own reads instead of polling USB again. Read-only.
   */
  newKeyboards?(): Promise<DetectedKeyboard[]>;
  /** Builds `revisionId` for `boardRevision`, or reuses a successful build of exactly that. Never throws; aborting `signal` stops the build and leaves the keyboard alone. */
  build(a: { layoutId: string; revisionId: string; boardRevision: string; signal: AbortSignal; onBuildId: (id: string) => void }): Promise<BuildOutcome>;
  /** Flashes a build. Never throws. `verified` is true only when the flasher saw the keyboard come back running the build. */
  flash(a: { buildId: string; signal: AbortSignal; onFlashId: (id: string) => void; onFlasherState: (state: FlashState, instruction: string | null, note: FlashNote | undefined) => void }): Promise<FlashOutcome>;
};

export type DefaultDepsOptions = Pick<FlashOptions, "volumesRoot" | "bootloaderWaitMs"> & {
  /** How keyboards are found and restarted; the machine's own when omitted. Tests and demos pass fakes. */
  handsFree?: HandsFreeOverrides;
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function appSyncDeps(app: App, opts: DefaultDepsOptions = {}): SyncDeps {
  let devices: UsbDevice[] = [];
  return {
    readKeyboards: () => readKeyboards(opts.handsFree ?? {}, (seen) => {
      devices = seen;
    }),
    newKeyboards: async () => (await detectKeyboards({ usb: async () => devices })).filter((k) => k.status !== "known"),

    remapper: {
      async apply(a) {
        try {
          const r = await applyToRemapper(app, a.layoutId, a.revisionId, opts.handsFree?.remapper ?? {});
          return r.ok ? { ok: true, ms: r.ms } : { ok: false, step: r.step, error: r.error };
        } catch (err) {
          return { ok: false, step: "apply", error: message(err) };
        }
      },
      async disable(boardId) {
        try {
          return await disableRemapperFor(boardId, opts.handsFree?.remapper ?? {});
        } catch (err) {
          return { ok: false, error: message(err) };
        }
      },
    },

    async build(a) {
      try {
        // A build whose flash failed is flashed again, not built again, when its file is still there: the revision has not changed.
        const earlier = latestSuccessfulBuildOfRevision(app.db, a.revisionId, a.boardRevision);
        if (earlier?.artifactPath) {
          const exists = await access(`${app.dataDir}/${earlier.artifactPath}`).then(() => true, () => false);
          if (exists) {
            a.onBuildId(earlier.id);
            return { ok: true, buildId: earlier.id, reused: true };
          }
        }
        const started = await startBuild(app, a.layoutId, {
          revisionId: a.revisionId, boardRevision: a.boardRevision, signal: a.signal,
        });
        a.onBuildId(started.id);
        const done = await waitForBuild(app, started.id);
        if (done.status !== "succeeded") return { ok: false, buildId: done.id, error: done.error ?? "the build failed" };
        return { ok: true, buildId: done.id, reused: false };
      } catch (err) {
        return { ok: false, error: message(err) };
      }
    },

    async flash(a) {
      try {
        const started = await startFlash(app, {
          buildId: a.buildId, signal: a.signal, onFlasherState: a.onFlasherState,
          ...(opts.handsFree ? { handsFree: opts.handsFree } : {}),
          ...(opts.volumesRoot === undefined ? {} : { volumesRoot: opts.volumesRoot }),
          ...(opts.bootloaderWaitMs === undefined ? {} : { bootloaderWaitMs: opts.bootloaderWaitMs }),
        });
        a.onFlashId(started.id);
        const done = await waitForFlash(app, started.id);
        if (done.status !== "succeeded") return { ok: false, flashId: done.id, error: done.error ?? "the flash failed" };
        return { ok: true, flashId: done.id, verified: done.note !== null, note: done.note };
      } catch (err) {
        return { ok: false, error: message(err) };
      }
    },
  };
}
