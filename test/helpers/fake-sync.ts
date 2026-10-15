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

export async function waitFor(cond: () => boolean, what: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

export type FlashMode = "ok" | "unverified" | "fail" | "unplug" | "needs_hand" | "wrong_marker";

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
    flashMode: "ok" as FlashMode,
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
          finishBuild(app.db, id, { error: world.buildError });
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
        const flashId = newFlashId();
        createFlash(app.db, { id: flashId, buildId: a.buildId, logPath: `logs/${flashId}.log` });
        a.onFlashId(flashId);
        a.onFlasherState("waiting_for_bootloader", "keyloom is restarting the keyboard into its bootloader. There is nothing to press.", undefined);
        if (world.flashMode === "needs_hand") {
          a.onFlasherState("waiting_for_bootloader", "keyloom couldn't restart the keyboard by itself (no raw HID). Press the reset button.", { needsHand: true });
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
          await world.flashGate.promise;
        }
        const fail = (error: string): FlashOutcome => {
          finishFlash(app.db, flashId, { error });
          return { ok: false, flashId, error };
        };
        const pass = (verified: boolean): FlashOutcome => {
          finishFlash(app.db, flashId, null);
          return { ok: true, flashId, verified, note: verified ? `Verified: the keyboard is running build ${a.buildId}.` : null };
        };
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
