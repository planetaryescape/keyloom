// A Moonlander and an engine over fake build and flash functions, for the sync engine's state machine: every
// way the world can change under a sync (an Apply, an unplug, a failed build, a stopped engine) is a method
// here, and nothing reaches Docker, zapp or a USB bus. Builds and flashes still leave real rows in the database,
// because what the keyboard runs is found by looking its marker up there.
import { type App, applyOps, getLayout, importLayout, openApp } from "../../src/app/index.ts";
import type { BuildOutcome, FlashOutcome, SyncDeps } from "../../src/app/sync-deps.ts";
import { type SyncOptions, SyncEngine } from "../../src/app/sync-engine.ts";
import type { KeyboardReading } from "../../src/app/sync-keyboard.ts";
import { buildKey } from "../../src/firmware/zmk/handsfree.ts";
import { createBuild, createFlash, finishBuild, finishFlash, newBuildId, newFlashId } from "../../src/persistence/builds.ts";
import { recordHandsFreeProof } from "../../src/persistence/syncs.ts";
import { FIXTURE_DIR } from "./board.ts";
import { setKey } from "./ops.ts";
import { tempDir } from "./tmp.ts";

export const BOARD = "zsa/moonlander";

export type Gate = { promise: Promise<void>; open: () => void };
export const gate = (): Gate => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

/**
 * A clock the engine reads instead of the wall: revisions are stamped with the real time, so this is the real time plus a skew
 * the test moves. Pair it with a `tickMs` too long to fire, and the quiet time passes when the test says so, not when a slow runner does.
 */
export function skewedClock() {
  let skew = 0;
  return { now: () => Date.now() + skew, advance: (ms: number) => void (skew += ms) };
}

// The deadline only matters when the condition never comes, so it is sized for a slow CI runner; a passing wait returns as soon as it holds.
export async function waitFor(cond: () => boolean, what: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

/**
 * `reset_at_stop`: waits for a hand; the stop arrives just as the person presses reset, so the flasher finds the bootloader, refuses
 * the stop as the real one does (D-506), writes, and the write fails. `restart_at_stop`: a UF2 half waits for a hand, keyloom's
 * retry restarts it just as the stop arrives, so the flasher says `inBootloader` and refuses the stop, and then the half's drive
 * goes away before the copy.
 */
export type FlashMode = "ok" | "unverified" | "fail" | "write_timeout" | "unplug" | "needs_hand" | "wrong_marker" | "reset_at_stop" | "restart_at_stop" | "tool_missing";

export async function syncWorld(opts: { engine?: SyncOptions; proven?: boolean } = {}) {
  const app: App = openApp({ dataDir: tempDir() });
  const imported = await importLayout(app, { board: BOARD, source: FIXTURE_DIR });
  const layoutId = imported.layoutId;

  const calls = { builds: [] as Array<{ buildId: string; revisionId: string }>, flashes: [] as string[], reads: 0 };
  let running = 0;
  let peak = 0;
  const world = {
    reading: { state: "absent" } as KeyboardReading,
    /** Held at the start of each build until opened; a build waiting here counts as running. */
    buildGate: undefined as Gate | undefined,
    flashGate: undefined as Gate | undefined,
    buildError: undefined as string | undefined,
    /** The failed build's code, as the real build records it (D-501), such as "docker_unavailable". */
    buildErrorCode: undefined as string | undefined,
    flashMode: "ok" as FlashMode,
    /** The permission a `needs_hand` flash says would let keyloom restart the keyboard itself, as the Moonlander's flasher does (D-501). */
    needsHandProblem: undefined as "permission_input_monitoring" | undefined,
    /** Called on each read of the keyboards, for tests that change the world between a decision and its launch. */
    onRead: undefined as ((n: number) => void) | undefined,
  };

  const keyloom = (buildId: string): KeyboardReading => ({ state: "keyloom", keys: [buildKey(buildId)], boardRevision: "reva" });

  /** A build row for `revisionId` that the keyboard already runs, as after an earlier sync. */
  function flashed(revisionId = getLayout(app, layoutId).revision.id): string {
    const id = newBuildId();
    createBuild(app.db, { id, revisionId, layoutId, boardRevision: "reva", logPath: `logs/${id}.log` });
    finishBuild(app.db, id, { artifactPath: `artifacts/${id}.bin` });
    world.reading = keyloom(id);
    return id;
  }

  const deps: SyncDeps = {
    async readKeyboards() {
      calls.reads++;
      world.onRead?.(calls.reads);
      return new Map([[BOARD, world.reading]]);
    },
    async build(a): Promise<BuildOutcome> {
      running++;
      peak = Math.max(peak, running);
      try {
        const id = newBuildId();
        createBuild(app.db, { id, revisionId: a.revisionId, layoutId: a.layoutId, boardRevision: a.boardRevision, logPath: `logs/${id}.log` });
        a.onBuildId(id);
        calls.builds.push({ buildId: id, revisionId: a.revisionId });
        // A build that is aborted stops where it is, like the real one: its row fails and nothing is returned.
        const aborted = new Promise<"aborted">((resolve) => a.signal.addEventListener("abort", () => resolve("aborted"), { once: true }));
        if (world.buildGate) {
          if ((await Promise.race([world.buildGate.promise.then(() => "open" as const), aborted])) === "aborted") {
            finishBuild(app.db, id, { error: "aborted" });
            return { ok: false, buildId: id, error: "the build was stopped" };
          }
        }
        if (a.signal.aborted) {
          finishBuild(app.db, id, { error: "aborted" });
          return { ok: false, buildId: id, error: "the build was stopped" };
        }
        if (world.buildError) {
          finishBuild(app.db, id, { error: world.buildError, errorCode: world.buildErrorCode ?? null });
          return { ok: false, buildId: id, error: world.buildError };
        }
        finishBuild(app.db, id, { artifactPath: `artifacts/${id}.bin` });
        return { ok: true, buildId: id, reused: false };
      } finally {
        running--;
      }
    },
    async flash(a): Promise<FlashOutcome> {
      running++;
      peak = Math.max(peak, running);
      try {
        calls.flashes.push(a.buildId);
        // zapp isn't installed: the real flash use case throws before it makes a flash row (R9-10).
        if (world.flashMode === "tool_missing") return { ok: false, error: "zapp isn't installed. Install it with `brew install zapp`, then flash again.", code: "flash_tool_missing" };
        const flashId = newFlashId();
        createFlash(app.db, { id: flashId, buildId: a.buildId, logPath: `logs/${flashId}.log` });
        a.onFlashId(flashId);
        a.onFlasherState("waiting_for_bootloader", "keyloom is restarting the keyboard into its bootloader. There is nothing to press.", undefined);
        if (world.flashMode === "reset_at_stop") {
          a.onFlasherState("waiting_for_bootloader", "keyloom couldn't restart the keyboard by itself (no raw HID). Press the reset button.", { needsHand: true });
          await new Promise<void>((resolve) => a.signal.addEventListener("abort", () => resolve(), { once: true }));
          a.onFlasherState("writing", "Don't unplug the keyboard.", undefined);
          finishFlash(app.db, flashId, { error: "zapp exited with code 1" });
          return { ok: false, flashId, error: "zapp exited with code 1" };
        }
        if (world.flashMode === "restart_at_stop") {
          a.onFlasherState("waiting_for_bootloader", "keyloom couldn't restart the right half by itself. Press its bootloader key.", { needsHand: true });
          await new Promise<void>((resolve) => a.signal.addEventListener("abort", () => resolve(), { once: true }));
          a.onFlasherState("waiting_for_bootloader", "keyloom restarted the right half into its bootloader. Writing starts in a moment; don't unplug it.", { inBootloader: true });
          const error = "Not writing to GLV80RHBOOT: the selected drive is no longer mounted at that path.";
          finishFlash(app.db, flashId, { error });
          return { ok: false, flashId, error };
        }
        if (world.flashMode === "needs_hand") {
          const problem = world.needsHandProblem;
          a.onFlasherState("waiting_for_bootloader", problem === undefined ? "keyloom couldn't restart the keyboard by itself (no raw HID). Press the reset button." : "macOS didn't let keyloom restart the keyboard by itself. Press the reset button.", { needsHand: true, ...(problem === undefined ? {} : { problem }) });
          const stopped = new Promise<"aborted">((resolve) => a.signal.addEventListener("abort", () => resolve("aborted"), { once: true }));
          if (world.flashGate) await Promise.race([world.flashGate.promise, stopped]);
          else await stopped;
          if (a.signal.aborted) return { ok: false, error: "Cancelled. Nothing was flashed." };
          // The gate opening without anyone pressing anything is the flasher's own timeout.
          const gaveUp = "No Moonlander in bootloader mode was found within 2 minutes. Nothing was flashed.";
          finishFlash(app.db, flashId, { error: gaveUp });
          return { ok: false, flashId, error: gaveUp };
        } else if (world.flashGate) {
          a.onFlasherState("writing", "Don't unplug the keyboard.", undefined);
          // Like zapp and the DFU tools, an abort here kills the write: the engine must never send one once writing has begun.
          const cut = new Promise<"aborted">((resolve) => a.signal.addEventListener("abort", () => resolve("aborted"), { once: true }));
          if ((await Promise.race([world.flashGate.promise.then(() => "done" as const), cut])) === "aborted") {
            finishFlash(app.db, flashId, { error: "The write was cut off." });
            return { ok: false, flashId, error: "The write was cut off." };
          }
        }
        const fail = (error: string): FlashOutcome => {
          finishFlash(app.db, flashId, { error });
          return { ok: false, flashId, error };
        };
        const pass = (verified: boolean): FlashOutcome => {
          finishFlash(app.db, flashId, null);
          return { ok: true, flashId, verified, note: verified ? `Verified: the keyboard is running build ${a.buildId}.` : null };
        };
        // A Moonlander write that ran past its limit, with its code, as `flashWithZapp` records it (R8-11).
        if (world.flashMode === "write_timeout") {
          const error = "Flashing didn't finish within 3 minutes and was stopped. The keyboard may be left in its bootloader: flash again, or `keyloom flash --build <an earlier build>`.";
          finishFlash(app.db, flashId, { error, errorCode: "write_timeout" });
          return { ok: false, flashId, error };
        }
        switch (world.flashMode) {
          case "fail":
            return fail("zapp exited with code 1");
          case "unplug":
            world.reading = { state: "absent" };
            return fail("the keyboard left USB while it was being written");
          case "unverified":
            world.reading = keyloom(a.buildId);
            return pass(false);
          case "wrong_marker":
            return pass(true);
          case "ok":
            world.reading = keyloom(a.buildId);
            return pass(true);
        }
      } finally {
        running--;
      }
    },
  };

  const engineOptions: SyncOptions = { quietMs: 40, tickMs: 8, pollMs: 15, ...opts.engine };
  const engines: SyncEngine[] = [];
  const engine = (over: SyncOptions = {}, d: SyncDeps = deps): SyncEngine => {
    const e = new SyncEngine(app, d, { ...engineOptions, ...over });
    engines.push(e);
    return e;
  };

  let edit = 0;
  const CODES = ["F17", "F18", "F19"];
  /** An Apply on the editor path: one key set to the next code. */
  function apply(): string {
    const head = getLayout(app, layoutId).revision.id;
    const code = CODES[edit++ % CODES.length] as string;
    return applyOps(app, layoutId, { baseRevisionId: head, ops: setKey(6, code), summary: `Layer 0, key 6: ${code}` }).revisionId;
  }

  if (opts.proven !== false) recordHandsFreeProof(app.db, BOARD, "bld_proof");

  return {
    app, layoutId, world, deps, calls, engine, apply, flashed,
    head: () => getLayout(app, layoutId).revision.id,
    peak: () => peak,
    stateOf: (e: SyncEngine) => e.views().find((v) => v.boardId === BOARD)?.state,
    stopAll: async () => {
      for (const e of engines) await e.stop({ flashGraceMs: 0 });
      world.buildGate?.open();
      world.flashGate?.open();
    },
  };
}

export type SyncWorld = Awaited<ReturnType<typeof syncWorld>>;
