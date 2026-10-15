// The sync engine's state machine against a fake world (17#auto-sync, D-160 to D-169): batching, one at a time, an Apply during a
// sync, every way a sync can fail, a keyboard that goes away, firmware that isn't keyloom's, pause, and a restart mid-sync.
import { afterEach, describe, expect, test } from "bun:test";
import { UsageError } from "../../src/app/index.ts";
import { SyncEngine } from "../../src/app/sync-engine.ts";
import { activeSyncs, claimSync, finishSync, getBoardSync, lastSyncOfBoard, newSyncId, progressSync, recentSyncs, recordHandsFreeProof } from "../../src/persistence/syncs.ts";
import { proposeChange } from "../../src/app/index.ts";
import { BOARD, type SyncWorld, gate, skewedClock, syncWorld, waitFor } from "../helpers/fake-sync.ts";
import { setKey } from "../helpers/ops.ts";

let current: SyncWorld | undefined;
afterEach(async () => {
  await current?.stopAll();
  current = undefined;
});

async function world(opts: Parameters<typeof syncWorld>[0] = {}): Promise<SyncWorld> {
  current = await syncWorld(opts);
  return current;
}

const kind = (w: SyncWorld, e: SyncEngine) => w.stateOf(e)?.kind;
const settled = async (w: SyncWorld, e: SyncEngine, want = "in_sync") => waitFor(() => kind(w, e) === want, `state ${want}; it is ${JSON.stringify(w.stateOf(e))}`);

describe("a keyboard that runs the head", () => {
  test("is in sync, and nothing is built for it", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine();
    await e.start();
    expect(kind(w, e)).toBe("in_sync");
    await Bun.sleep(120);
    expect(w.calls.builds).toEqual([]);
    expect(w.calls.flashes).toEqual([]);
  });

  test("an edit that was undone is in sync again without a build: the document is what the keyboard runs, not the revision's name", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine({ quietMs: 10_000 });
    await e.start();
    const { undo } = await import("../../src/app/index.ts");
    w.apply();
    expect(w.stateOf(e)).toMatchObject({ kind: "behind", changes: 1 });
    undo(w.app, w.layoutId);
    // The head is a new revision (undo appends), but its document is the one the keyboard runs.
    expect(w.stateOf(e)?.kind).toBe("in_sync");
  });
});

describe("batching and one at a time", () => {
  test("three quick Applies become one build and one verified flash of the last one", async () => {
    const w = await world();
    w.flashed();
    const clock = skewedClock();
    const QUIET = 10_000;
    const e = w.engine({ quietMs: QUIET, tickMs: 600_000, now: clock.now });
    await e.start();
    w.apply();
    w.apply();
    const last = w.apply();
    // However slowly the three Applies ran, no time has passed for the engine, so it is still waiting.
    await e.tick();
    expect(w.stateOf(e)).toMatchObject({ kind: "behind", changes: 3, why: "waiting" });
    expect(w.calls.builds).toEqual([]);
    clock.advance(QUIET);
    await e.tick();
    await settled(w, e);
    expect(w.calls.builds.map((b) => b.revisionId)).toEqual([last]);
    expect(w.calls.flashes).toHaveLength(1);
    const run = lastSyncOfBoard(w.app.db, BOARD);
    expect(run).toMatchObject({ status: "succeeded", revisionId: last, trigger: "auto" });
    // The wait started at the last Apply, not the first: a burst keeps being a burst while it goes on.
    expect((run?.startedAt ?? 0) - (run?.appliedAt ?? 0)).toBeGreaterThanOrEqual(QUIET);
  });

  test("an Apply during a build stops that build and syncs the head once, not both", async () => {
    const w = await world();
    w.flashed();
    w.world.buildGate = gate();
    const e = w.engine();
    await e.start();
    w.apply();
    await waitFor(() => w.calls.builds.length === 1, "the first build to start");
    const second = w.apply();
    w.world.buildGate = undefined;
    await waitFor(() => w.calls.flashes.length === 1, "one flash");
    await settled(w, e);
    expect(w.calls.builds).toHaveLength(2);
    expect(w.calls.flashes).toEqual([w.calls.builds[1]?.buildId as string]);
    expect(w.calls.builds[1]?.revisionId).toBe(second);
    const runs = recentSyncs(w.app.db);
    expect(runs.map((r) => [r.status, r.failure])).toEqual([["succeeded", null], ["cancelled", "superseded"]]);
    expect(w.peak()).toBe(1);
  });

  test("an Apply during a flash lets that flash finish, then queues exactly one more sync", async () => {
    const w = await world();
    w.flashed();
    w.world.flashGate = gate();
    const e = w.engine();
    await e.start();
    w.apply();
    await waitFor(() => w.calls.flashes.length === 1, "the first flash to start");
    w.apply();
    const last = w.apply();
    // Nothing starts while the flash runs: two builds never overlap, and a keyboard is never flashed twice at once.
    await Bun.sleep(100);
    expect(w.calls.builds).toHaveLength(1);
    w.world.flashGate.open();
    w.world.flashGate = undefined;
    await waitFor(() => w.calls.flashes.length === 2, "the second flash");
    await settled(w, e);
    expect(w.calls.builds).toHaveLength(2);
    expect(w.calls.builds[1]?.revisionId).toBe(last);
    await Bun.sleep(100);
    expect(w.calls.flashes).toHaveLength(2);
    expect(w.peak()).toBe(1);
  });

  test("a steady stream of Applies and ticks never runs two syncs at once", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    for (let i = 0; i < 6; i++) {
      w.apply();
      await Bun.sleep(12);
    }
    await settled(w, e);
    await Bun.sleep(60);
    expect(w.peak()).toBe(1);
    expect(activeSyncs(w.app.db)).toEqual([]);
  });
});

describe("failures leave the keyboard alone and say why", () => {
  test("a failed build never reaches the keyboard; the state is behind with the error, and it is not retried by itself", async () => {
    const w = await world();
    const before = w.flashed();
    w.world.buildError = "compile error in keymap.c";
    const e = w.engine();
    await e.start();
    w.apply();
    await waitFor(() => w.stateOf(e)?.kind === "behind" && (w.stateOf(e) as { error: string | null }).error !== null, "the failure");
    expect(w.stateOf(e)).toMatchObject({ kind: "behind", changes: 1, why: "failed", error: "compile error in keymap.c" });
    expect(w.calls.flashes).toEqual([]);
    expect(w.world.reading).toMatchObject({ state: "keyloom" });
    await Bun.sleep(150);
    expect(w.calls.builds).toHaveLength(1);
    // A new Apply is a new revision, so it is tried.
    w.world.buildError = undefined;
    w.apply();
    await settled(w, e);
    expect(w.calls.builds).toHaveLength(2);
    expect(before).toBeTruthy();
  });

  test("a flash that fails is behind with the error and is not repeated by itself", async () => {
    const w = await world();
    w.flashed();
    w.world.flashMode = "fail";
    const e = w.engine();
    await e.start();
    w.apply();
    await waitFor(() => w.stateOf(e)?.kind === "behind" && (w.stateOf(e) as { why: string }).why === "failed", "the failure");
    expect(w.stateOf(e)).toMatchObject({ error: "zapp exited with code 1" });
    await Bun.sleep(150);
    expect(w.calls.flashes).toHaveLength(1);
  });

  test("a flash the flasher could not verify is not in sync", async () => {
    const w = await world();
    w.flashed();
    w.world.flashMode = "unverified";
    const e = w.engine();
    await e.start();
    w.apply();
    await waitFor(() => lastSyncOfBoard(w.app.db, BOARD)?.status === "failed", "the failure");
    expect(w.stateOf(e)).toMatchObject({ kind: "behind", why: "failed" });
    expect((w.stateOf(e) as { error: string }).error).toContain("no marker");
    expect(lastSyncOfBoard(w.app.db, BOARD)).toMatchObject({ status: "failed", failure: "verify" });
  });

  test("a flash that reports success while the keyboard still runs the old marker is not in sync", async () => {
    const w = await world();
    w.flashed();
    w.world.flashMode = "wrong_marker";
    const e = w.engine();
    await e.start();
    w.apply();
    await waitFor(() => lastSyncOfBoard(w.app.db, BOARD)?.status === "failed", "the failure");
    expect(lastSyncOfBoard(w.app.db, BOARD)).toMatchObject({ failure: "verify" });
    expect(lastSyncOfBoard(w.app.db, BOARD)?.error).toContain("not running build");
    expect(w.stateOf(e)?.kind).toBe("behind");
  });
});

describe("a keyboard that goes away", () => {
  test("unplugged mid-flash: not connected, and when it is plugged back in it is synced again", async () => {
    const w = await world();
    const old = w.flashed();
    w.world.flashMode = "unplug";
    const e = w.engine();
    await e.start();
    const head = w.apply();
    await settled(w, e, "not_connected");
    expect(lastSyncOfBoard(w.app.db, BOARD)).toMatchObject({ status: "failed", failure: "disconnected" });
    // Back on the old firmware, as after a write that never reached it.
    w.world.flashMode = "ok";
    w.world.reading = { state: "keyloom", keys: [old.slice(-12)], boardRevision: "reva" };
    await settled(w, e);
    expect(w.calls.flashes).toHaveLength(2);
    expect(lastSyncOfBoard(w.app.db, BOARD)).toMatchObject({ status: "succeeded", revisionId: head });
  });

  test("unplugged during the build: nothing is flashed", async () => {
    const w = await world();
    w.flashed();
    w.world.buildGate = gate();
    const e = w.engine();
    await e.start();
    w.apply();
    await waitFor(() => w.calls.builds.length === 1, "the build");
    w.world.reading = { state: "absent" };
    w.world.buildGate.open();
    await settled(w, e, "not_connected");
    expect(w.calls.flashes).toEqual([]);
    expect(lastSyncOfBoard(w.app.db, BOARD)).toMatchObject({ failure: "disconnected" });
  });

  test("a keyboard left in its bootloader needs a hand, with the way out", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine();
    await e.start();
    w.world.reading = { state: "bootloader" };
    await settled(w, e, "needs_hand");
    expect(w.stateOf(e)).toMatchObject({ kind: "needs_hand", reason: expect.stringContaining("bootloader") });
  });
});

describe("firmware that isn't keyloom's", () => {
  test("is never replaced by itself, however often it is applied", async () => {
    const w = await world();
    w.world.reading = { state: "other", detail: "USB serial QxKPz/zLQ3Md" };
    const e = w.engine();
    await e.start();
    w.apply();
    w.apply();
    await Bun.sleep(200);
    expect(w.stateOf(e)).toMatchObject({ kind: "not_keyloom", detail: "USB serial QxKPz/zLQ3Md" });
    expect(w.calls.builds).toEqual([]);
    expect(w.calls.flashes).toEqual([]);
  });

  test("Sync now refuses it and names the deliberate way", async () => {
    const w = await world();
    w.world.reading = { state: "other", detail: "USB serial QxKPz/zLQ3Md" };
    const e = w.engine();
    await expect(e.syncNow(w.layoutId)).rejects.toThrow(/never replaces that by itself.*keyloom flash/);
    expect(w.calls.flashes).toEqual([]);
  });

  test("a keyboard that changes to someone else's firmware between the decision and the start is left alone", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine({ pollMs: 60_000 });
    await e.start();
    w.apply();
    // The first read after the Apply is the one that confirms the decision to start; by then the firmware is not keyloom's.
    const reads = w.calls.reads;
    w.world.onRead = (n) => {
      if (n > reads) w.world.reading = { state: "other", detail: "USB serial something" };
    };
    await Bun.sleep(200);
    expect(w.calls.builds).toEqual([]);
    expect(w.stateOf(e)?.kind).toBe("not_keyloom");
  });

  test("a keyloom build this copy has no record of is not replaced by itself, but Sync now may", async () => {
    const w = await world();
    w.world.reading = { state: "keyloom", keys: ["ZZZZZZZZZZZZ"], boardRevision: "reva" };
    const e = w.engine();
    await e.start();
    w.apply();
    await Bun.sleep(150);
    expect(w.stateOf(e)).toMatchObject({ kind: "behind", why: "unknown_build" });
    expect(w.calls.builds).toEqual([]);
    const r = await e.syncNow(w.layoutId);
    expect(r.kind).toBe("started");
    if (r.kind === "started") await r.done;
    expect(w.calls.flashes).toHaveLength(1);
  });
});

describe("auto-sync is a choice per board that needs proof", () => {
  test("without a verified hands-free flash it does not start, and cannot be turned on", async () => {
    const w = await world({ proven: false });
    w.flashed();
    const e = w.engine();
    await e.start();
    w.apply();
    await Bun.sleep(150);
    expect(w.stateOf(e)).toMatchObject({ kind: "behind", why: "unproven" });
    expect(w.calls.builds).toEqual([]);
    expect(() => e.setAutoSync(BOARD, true)).toThrow(UsageError);
    // Sync now still works: it is the deliberate path that produces the proof.
    const r = await e.syncNow(w.layoutId);
    if (r.kind === "started") await r.done;
    expect(w.calls.flashes).toHaveLength(1);
  });

  test("once proven it follows the proof, and off stays off", async () => {
    const w = await world({ proven: false });
    w.flashed();
    const e = w.engine();
    await e.start();
    recordHandsFreeProof(w.app.db, BOARD, "bld_x");
    w.apply();
    await settled(w, e);
    expect(w.calls.flashes).toHaveLength(1);
    e.setAutoSync(BOARD, false);
    w.apply();
    await Bun.sleep(150);
    expect(w.stateOf(e)).toMatchObject({ kind: "behind", why: "auto_off" });
    expect(w.calls.flashes).toHaveLength(1);
    expect(getBoardSync(w.app.db, BOARD)).toMatchObject({ autoSync: false });
    e.setAutoSync(BOARD, true);
    await settled(w, e);
    expect(w.calls.flashes).toHaveLength(2);
  });

  test("a choice survives a new engine, as it does a restart", async () => {
    const w = await world();
    w.flashed();
    w.engine().setAutoSync(BOARD, false);
    const e = w.engine();
    await e.start();
    w.apply();
    await Bun.sleep(120);
    expect(w.calls.builds).toEqual([]);
  });
});

describe("pause", () => {
  test("a paused board is not synced; resume syncs what waited", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine();
    await e.start();
    e.setPaused(BOARD, true);
    w.apply();
    await Bun.sleep(150);
    expect(w.stateOf(e)).toMatchObject({ kind: "behind", why: "paused" });
    expect(w.calls.builds).toEqual([]);
    e.setPaused(BOARD, false);
    await settled(w, e);
    expect(w.calls.flashes).toHaveLength(1);
  });

  test("pausing during a build stops it before the keyboard is touched", async () => {
    const w = await world();
    w.flashed();
    w.world.buildGate = gate();
    const e = w.engine();
    await e.start();
    w.apply();
    await waitFor(() => w.calls.builds.length === 1, "the build");
    e.setPaused(BOARD, true);
    await waitFor(() => lastSyncOfBoard(w.app.db, BOARD)?.status === "cancelled", "the cancellation");
    expect(w.calls.flashes).toEqual([]);
    expect(w.stateOf(e)).toMatchObject({ kind: "behind", why: "paused" });
  });

  test("pausing during a flash does not stop it: a half-written keyboard is worse than a late pause", async () => {
    const w = await world();
    w.flashed();
    w.world.flashGate = gate();
    const e = w.engine();
    await e.start();
    w.apply();
    await waitFor(() => w.calls.flashes.length === 1, "the flash");
    e.setPaused(BOARD, true);
    await Bun.sleep(60);
    expect(w.stateOf(e)?.kind).toBe("syncing");
    w.world.flashGate.open();
    await waitFor(() => lastSyncOfBoard(w.app.db, BOARD)?.status === "succeeded", "the flash to finish");
  });

  test("Sync now works while paused", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine();
    await e.start();
    e.setPaused(BOARD, true);
    w.apply();
    const r = await e.syncNow(w.layoutId);
    expect(r.kind).toBe("started");
    if (r.kind === "started") expect((await r.done).status).toBe("succeeded");
  });
});

describe("a flash that needs a hand", () => {
  test("shows the instruction while it waits; when no hand comes it stays needs a hand, with the same words, and is not retried", async () => {
    const w = await world();
    w.flashed();
    w.world.flashMode = "needs_hand";
    w.world.flashGate = gate();
    const e = w.engine();
    await e.start();
    w.apply();
    await settled(w, e, "needs_hand");
    expect(w.stateOf(e)).toMatchObject({ kind: "needs_hand", instruction: expect.stringContaining("Press the reset button") });
    w.world.flashGate.open();
    await waitFor(() => lastSyncOfBoard(w.app.db, BOARD)?.status === "failed", "the flasher giving up");
    expect(lastSyncOfBoard(w.app.db, BOARD)).toMatchObject({ failure: "needs_hand", error: expect.stringContaining("Nothing was flashed") });
    expect(w.stateOf(e)).toMatchObject({ kind: "needs_hand", instruction: expect.stringContaining("Press the reset button") });
    await Bun.sleep(150);
    expect(w.calls.flashes).toHaveLength(1);
  });

  test("stopping while it waits for a hand cancels it, because nothing has been written", async () => {
    const w = await world();
    w.flashed();
    w.world.flashMode = "needs_hand";
    const e = w.engine();
    await e.start();
    w.apply();
    await settled(w, e, "needs_hand");
    await e.stop();
    expect(lastSyncOfBoard(w.app.db, BOARD)).toMatchObject({ status: "cancelled" });
  });
});

describe("Sync now", () => {
  test("starts one sync and a second call while it runs joins it", async () => {
    const w = await world({ proven: false });
    w.flashed();
    w.world.flashGate = gate();
    const e = w.engine();
    w.apply();
    const first = await e.syncNow(w.layoutId);
    expect(first.kind).toBe("started");
    await waitFor(() => w.calls.flashes.length === 1, "the flash");
    const second = await e.syncNow(w.layoutId);
    expect(second.kind).toBe("already_running");
    w.world.flashGate.open();
    if (first.kind === "started") await first.done;
    expect(w.calls.flashes).toHaveLength(1);
  });

  test("a call for a newer head while one runs is queued, and runs once", async () => {
    const w = await world({ proven: false });
    w.flashed();
    w.world.flashGate = gate();
    const e = w.engine();
    await e.start();
    w.apply();
    const first = await e.syncNow(w.layoutId);
    await waitFor(() => w.calls.flashes.length === 1, "the flash");
    w.apply();
    expect((await e.syncNow(w.layoutId)).kind).toBe("queued");
    expect((await e.syncNow(w.layoutId)).kind).toBe("queued");
    w.world.flashGate.open();
    w.world.flashGate = undefined;
    if (first.kind === "started") await first.done;
    await waitFor(() => w.calls.flashes.length === 2, "the queued sync");
    await Bun.sleep(100);
    expect(w.calls.flashes).toHaveLength(2);
  });

  test("an engine that was never started does what it was asked and nothing more, even with a newer Apply and auto-sync on", async () => {
    const w = await world();
    w.flashed();
    w.apply();
    w.world.flashGate = gate();
    const oneShot = w.engine();
    const first = await oneShot.syncNow(w.layoutId);
    await waitFor(() => w.calls.flashes.length === 1, "the flash");
    w.apply();
    // Long enough that the quiet time has passed, so only the engine's own restraint is left to keep it from syncing again.
    await Bun.sleep(100);
    w.world.flashGate.open();
    if (first.kind === "started") await first.done;
    await Bun.sleep(200);
    expect(w.calls.flashes).toHaveLength(1);
    expect(w.calls.builds).toHaveLength(1);
  });

  test("when nothing is behind it says so and does nothing", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine();
    expect((await e.syncNow(w.layoutId)).kind).toBe("in_sync");
    expect(w.calls.builds).toEqual([]);
  });

  test("no keyboard is a usage error naming the board", async () => {
    const w = await world();
    const e = w.engine();
    await expect(e.syncNow(w.layoutId)).rejects.toThrow(/no Moonlander is attached/);
  });

  test("two engines racing to start (the server and a CLI) start one sync between them", async () => {
    const w = await world({ proven: false });
    w.flashed();
    w.apply();
    w.world.flashGate = gate();
    const a = w.engine();
    const b = w.engine();
    const results = await Promise.allSettled([a.syncNow(w.layoutId), b.syncNow(w.layoutId)]);
    const started = results.filter((r) => r.status === "fulfilled" && r.value.kind === "started");
    const refused = results.filter((r) => r.status === "rejected");
    expect(started).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(String((refused[0] as PromiseRejectedResult).reason.message)).toContain("another keyloom sync is running");
    w.world.flashGate.open();
    await waitFor(() => lastSyncOfBoard(w.app.db, BOARD)?.status === "succeeded", "the sync");
    expect(w.calls.flashes).toHaveLength(1);
  });
});

describe("only applied revisions sync", () => {
  test("a proposal, which is a preview of a change not yet applied, starts nothing", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine();
    await e.start();
    proposeChange(w.app, w.layoutId, { ops: setKey(6, "F17"), explanation: "try F17", source: "agent" });
    await Bun.sleep(200);
    expect(w.stateOf(e)?.kind).toBe("in_sync");
    expect(w.calls.builds).toEqual([]);
  });
});

describe("a second layout of the same board", () => {
  test("is not synced by itself: the keyboard is tracked against the layout it runs", async () => {
    const w = await world();
    w.flashed();
    const { importLayout } = await import("../../src/app/index.ts");
    const { FIXTURE_DIR } = await import("../helpers/board.ts");
    const other = await importLayout(w.app, { board: BOARD, source: FIXTURE_DIR, name: "other" });
    const e = w.engine();
    await e.start();
    const view = e.views().find((v) => v.boardId === BOARD);
    expect(view).toMatchObject({ layoutId: w.layoutId, otherLayouts: 1 });
    const { applyOps, getLayout } = await import("../../src/app/index.ts");
    applyOps(w.app, other.layoutId, { baseRevisionId: getLayout(w.app, other.layoutId).revision.id, ops: setKey(6, "F18"), summary: "other layout" });
    await Bun.sleep(150);
    expect(w.calls.builds).toEqual([]);
    expect(w.stateOf(e)?.kind).toBe("in_sync");
  });
});

describe("a restart in the middle of a sync", () => {
  test("a build that was running is over, and the new engine builds and flashes the head once", async () => {
    const w = await world();
    w.flashed();
    w.world.buildGate = gate();
    const first = w.engine();
    await first.start();
    w.apply();
    await waitFor(() => w.calls.builds.length === 1, "the build");
    // The first engine is gone without finishing; its row says building, in this very process.
    await first.stop({ flashGraceMs: 0 });
    // stop() aborted the build; put the row back as a crash would have left it.
    w.app.db.query("UPDATE syncs SET status = 'building', step = 'building', failure = NULL, error = NULL, finished_at = NULL").run();
    expect(activeSyncs(w.app.db)).toHaveLength(1);
    w.world.buildGate = undefined;
    const second = w.engine();
    await second.start();
    await settled(w, second);
    expect(w.calls.builds).toHaveLength(2);
    expect(w.calls.flashes).toHaveLength(1);
    const runs = recentSyncs(w.app.db);
    expect(runs.map((r) => r.status).sort()).toEqual(["failed", "succeeded"]);
    expect(runs.find((r) => r.status === "failed")).toMatchObject({ failure: "interrupted" });
  });

  test("a flash that had finished when the engine stopped is counted from the keyboard's marker and not flashed again", async () => {
    const w = await world();
    w.flashed();
    w.world.flashGate = gate();
    const first = w.engine();
    await first.start();
    const head = w.apply();
    await waitFor(() => w.calls.flashes.length === 1, "the flash");
    const flashedBuild = w.calls.flashes[0] as string;
    await first.stop({ flashGraceMs: 0 });
    // The write landed and the keyboard came back before the server did.
    w.world.reading = { state: "keyloom", keys: [flashedBuild.slice(-12)], boardRevision: "reva" };
    const second = w.engine();
    await second.start();
    expect(kind(w, second)).toBe("in_sync");
    expect(lastSyncOfBoard(w.app.db, BOARD)).toMatchObject({ status: "succeeded", revisionId: head });
    // The first engine's flash returns late; it must not write over what the second one settled.
    w.world.flashGate.open();
    await Bun.sleep(80);
    expect(lastSyncOfBoard(w.app.db, BOARD)).toMatchObject({ status: "succeeded" });
    expect(w.calls.flashes).toHaveLength(1);
    expect(w.calls.builds).toHaveLength(1);
  });

  test("a flash that did not land is over, and the keyboard is synced once more from the build that was made", async () => {
    const w = await world();
    w.flashed();
    w.world.flashGate = gate();
    const first = w.engine();
    await first.start();
    w.apply();
    await waitFor(() => w.calls.flashes.length === 1, "the flash");
    await first.stop({ flashGraceMs: 0 });
    w.world.flashGate = undefined;
    const second = w.engine();
    await second.start();
    await settled(w, second);
    expect(recentSyncs(w.app.db).map((r) => r.status).sort()).toEqual(["failed", "succeeded"]);
    expect(w.calls.flashes).toHaveLength(2);
  });
});

describe("rows that are finished stay finished", () => {
  test("only the first finish counts, and progress after a finish is refused", async () => {
    const w = await world();
    const id = newSyncId();
    const claim = claimSync(w.app.db, { id, boardId: BOARD, layoutId: w.layoutId, revisionId: w.head(), boardRevision: "reva", trigger: "auto", logPath: "logs/x.log", appliedAt: 1, owner: "a" }, () => true);
    expect("claimed" in claim).toBe(true);
    expect(finishSync(w.app.db, id, { status: "failed", failure: "build", error: "first" })).toBe(true);
    expect(finishSync(w.app.db, id, { status: "succeeded" })).toBe(false);
    expect(progressSync(w.app.db, id, { step: "writing" })).toBe(false);
    expect(lastSyncOfBoard(w.app.db, BOARD)).toMatchObject({ status: "failed", error: "first" });
  });

  test("a second claim while one is running is refused, and a claim over a dead process's row takes it over", async () => {
    const w = await world();
    const mk = (id: string) => ({ id, boardId: BOARD, layoutId: w.layoutId, revisionId: w.head(), boardRevision: "reva", trigger: "auto" as const, logPath: "logs/x.log", appliedAt: 1, owner: "a" });
    expect("claimed" in claimSync(w.app.db, mk(newSyncId()), () => true)).toBe(true);
    expect("busy" in claimSync(w.app.db, mk(newSyncId()), () => true)).toBe(true);
    expect("claimed" in claimSync(w.app.db, mk(newSyncId()), () => false)).toBe(true);
    expect(recentSyncs(w.app.db).map((r) => r.failure)).toContain("interrupted");
  });
});

describe("an engine inside a server", () => {
  test("a database that has gone away is reported once and never takes the process down", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine({ tickMs: 5 });
    await e.start();
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
    let rejected = 0;
    const onRejection = () => rejected++;
    process.on("unhandledRejection", onRejection);
    try {
      w.app.db.close();
      await Bun.sleep(150);
    } finally {
      console.error = original;
      process.off("unhandledRejection", onRejection);
    }
    expect(rejected).toBe(0);
    expect(errors.filter((m) => m.includes("could not check the keyboards"))).toHaveLength(1);
  });
});
