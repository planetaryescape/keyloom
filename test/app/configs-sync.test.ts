// Which config the sync engine keeps on a keyboard (25, D-300): only the one stored as on the keyboard, whatever else is edited,
// and a switch is one explicit sync. A wrong answer here flashes the wrong config onto a real keyboard, so the failures that matter
// (an edit to another config, a switch in the middle of a sync) each have a test that fails on "newest edited wins".
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { UsageError, applyOps, getLayout, newConfig } from "../../src/app/index.ts";
import type { SyncEngine } from "../../src/app/sync-engine.ts";
import { getBoardConfig, setBoardConfig, setArchivedAt } from "../../src/persistence/configs.ts";
import { recentSyncs } from "../../src/persistence/syncs.ts";
import { listVersionRows } from "../../src/persistence/versions.ts";
import { BOARD, type SyncWorld, gate, syncWorld, waitFor } from "../helpers/fake-sync.ts";
import { setKey } from "../helpers/ops.ts";

setDefaultTimeout(20_000);

let current: SyncWorld | undefined;
afterEach(async () => {
  await current?.stopAll();
  current = undefined;
});

async function world(): Promise<SyncWorld> {
  current = await syncWorld();
  return current;
}

/** An Apply on a specific config, like the editor does on whichever one is open. */
function edit(w: SyncWorld, layoutId: string, code: string): string {
  const head = getLayout(w.app, layoutId).revision.id;
  return applyOps(w.app, layoutId, { baseRevisionId: head, ops: setKey(6, code), summary: `Layer 0, key 6: ${code}` }).revisionId;
}

/** A second config of the board, copied from the first (which stays the one on the keyboard). */
function second(w: SyncWorld, name = "Colemak"): string {
  return newConfig(w.app, { name, from: "config", config: w.layoutId }).id;
}

const settle = async (w: SyncWorld, e: SyncEngine) => waitFor(() => w.stateOf(e)?.kind === "in_sync", `in_sync, it is ${JSON.stringify(w.stateOf(e))}`);

describe("editing a config that is not on the keyboard", () => {
  test("never builds or flashes, however recently it was edited", async () => {
    const w = await world();
    w.flashed();
    const other = second(w);
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    // The second config is the newest edited one: the old engine would now have tracked it and put it on the keyboard.
    edit(w, other, "F18");
    edit(w, other, "F19");
    await Bun.sleep(150);
    expect(w.calls.builds).toEqual([]);
    expect(w.calls.flashes).toEqual([]);
    expect(w.stateOf(e)?.kind).toBe("in_sync");
    expect(e.views().find((v) => v.boardId === BOARD)?.layoutId).toBe(w.layoutId);
  });

  test("editing the config on the keyboard still syncs it, with the other one edited more recently", async () => {
    const w = await world();
    w.flashed();
    const other = second(w);
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    const mine = edit(w, w.layoutId, "F17");
    edit(w, other, "F18");
    await waitFor(() => w.calls.flashes.length === 1, "the flash");
    await settle(w, e);
    expect(w.calls.builds.map((b) => b.revisionId)).toEqual([mine]);
  });

  test("a keyboard that runs the other config is left alone, even when that config is the one edited", async () => {
    const w = await world();
    const other = second(w);
    // The keyboard runs a build of the second config (flashed by hand, say), while the first is stored as on the keyboard.
    w.flashed(getLayout(w.app, other).revision.id);
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    edit(w, other, "F18");
    edit(w, w.layoutId, "F17");
    await Bun.sleep(150);
    // Replacing what runs is BK's choice (`config use`), never auto-sync's, whichever config was edited.
    expect(w.calls.builds).toEqual([]);
    expect(w.calls.flashes).toEqual([]);
    expect(w.stateOf(e)).toMatchObject({ kind: "behind", why: "other_config" });
  });
});

describe("sync now and put on", () => {
  test("a sync of a config that is not on the keyboard is refused and names the command", async () => {
    const w = await world();
    w.flashed();
    const other = second(w);
    const e = w.engine();
    await e.start();
    await expect(e.syncNow(other)).rejects.toThrow(/isn't the config on your .*keyloom config use/);
    expect(getBoardConfig(w.app.db, BOARD)).toBe(w.layoutId);
    expect(w.calls.builds).toEqual([]);
  });

  test("useConfig stores the choice, syncs the new config once, and then only that one auto-syncs", async () => {
    const w = await world();
    w.flashed();
    const other = second(w);
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    const r = await e.useConfig(other);
    expect(r.kind).toBe("started");
    if (r.kind === "started") await r.done;
    expect(getBoardConfig(w.app.db, BOARD)).toBe(other);
    expect(w.calls.builds.map((b) => b.revisionId)).toEqual([getLayout(w.app, other).revision.id]);
    await settle(w, e);
    expect(e.views().find((v) => v.boardId === BOARD)).toMatchObject({ layoutId: other, otherLayouts: 1 });

    // Now the first config is the one that waits.
    edit(w, w.layoutId, "F17");
    await Bun.sleep(100);
    expect(w.calls.builds).toHaveLength(1);
    const mine = edit(w, other, "F19");
    await waitFor(() => w.calls.builds.length === 2, "the second build");
    expect(w.calls.builds[1]?.revisionId).toBe(mine);
  });

  test("two configs on one board switch back and forth, and each switch flashes exactly the chosen config's head", async () => {
    const w = await world();
    w.flashed();
    const colemak = second(w);
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    // Make the two differ, so "which one was flashed" is visible in the revision.
    const qwertyHead = edit(w, w.layoutId, "F17");
    await waitFor(() => w.calls.flashes.length === 1, "the first flash");
    await settle(w, e);
    const colemakHead = edit(w, colemak, "F18");

    const toColemak = await e.useConfig(colemak);
    if (toColemak.kind === "started") await toColemak.done;
    await settle(w, e);
    const toQwerty = await e.useConfig(w.layoutId);
    if (toQwerty.kind === "started") await toQwerty.done;
    await settle(w, e);

    expect(w.calls.builds.map((b) => b.revisionId)).toEqual([qwertyHead, colemakHead, qwertyHead]);
    expect(getBoardConfig(w.app.db, BOARD)).toBe(w.layoutId);
    expect(recentSyncs(w.app.db).filter((s) => s.status !== "succeeded")).toEqual([]);
  });

  test("an unplugged keyboard leaves the choice as it was", async () => {
    const w = await world();
    w.flashed();
    const other = second(w);
    const e = w.engine();
    await e.start();
    w.world.reading = { state: "absent" };
    await expect(e.useConfig(other)).rejects.toBeInstanceOf(UsageError);
    expect(getBoardConfig(w.app.db, BOARD)).toBe(w.layoutId);
  });

  test("an archived config can't be put on", async () => {
    const w = await world();
    w.flashed();
    const other = second(w);
    const { archiveConfig } = await import("../../src/app/index.ts");
    archiveConfig(w.app, other);
    const e = w.engine();
    await e.start();
    await expect(e.useConfig(other)).rejects.toThrow(/archived/);
    expect(getBoardConfig(w.app.db, BOARD)).toBe(w.layoutId);
  });

  test("putting on a config the keyboard already runs only stores the choice", async () => {
    const w = await world();
    const other = second(w);
    w.flashed(getLayout(w.app, other).revision.id); // the copy has the same document as the first
    const e = w.engine();
    await e.start();
    const r = await e.useConfig(other);
    expect(r.kind).toBe("in_sync");
    expect(getBoardConfig(w.app.db, BOARD)).toBe(other);
    expect(w.calls.builds).toEqual([]);
  });
});

describe("a switch in the middle of a sync", () => {
  test("while the first config builds: that build is stopped, never flashed, and only the chosen config reaches the keyboard", async () => {
    const w = await world();
    w.flashed();
    const colemak = second(w);
    edit(w, colemak, "F18");
    w.world.buildGate = gate();
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    edit(w, w.layoutId, "F17");
    await waitFor(() => w.calls.builds.length === 1, "the first config's build");
    const toColemak = await e.useConfig(colemak);
    expect(toColemak.kind).toBe("queued");
    w.world.buildGate.open();
    w.world.buildGate = undefined;
    await waitFor(() => w.calls.flashes.length === 1, "one flash");
    await settle(w, e);
    expect(w.calls.builds).toHaveLength(2);
    expect(w.calls.flashes).toEqual([w.calls.builds[1]?.buildId as string]);
    expect(w.calls.builds[1]?.revisionId).toBe(getLayout(w.app, colemak).revision.id);
    expect(recentSyncs(w.app.db).map((s) => [s.layoutId === colemak, s.status])).toEqual([[true, "succeeded"], [false, "cancelled"]]);
    expect(getBoardConfig(w.app.db, BOARD)).toBe(colemak);
  });

  test("after the build finishes and before the flash: the flash does not happen", async () => {
    const w = await world();
    w.flashed();
    const colemak = second(w);
    const e = w.engine({ quietMs: 5, tickMs: 600_000 });
    await e.start();
    // The switch lands during the read of USB that sits between the build and the flash, where no tick can have noticed it yet.
    w.world.onRead = () => {
      if (w.calls.builds.length === 1 && getBoardConfig(w.app.db, BOARD) === w.layoutId) setBoardConfig(w.app.db, BOARD, colemak);
    };
    edit(w, w.layoutId, "F17");
    await new Promise((r) => setTimeout(r, 30));
    await e.tick();
    await waitFor(() => recentSyncs(w.app.db).some((s) => s.status === "cancelled"), "the sync to be cancelled");
    const cancelled = recentSyncs(w.app.db).find((s) => s.status === "cancelled");
    expect(cancelled).toMatchObject({ layoutId: w.layoutId, failure: "superseded", error: "another config was put on the keyboard" });
    // The build of the config that was taken off the keyboard is never flashed, and nothing replaces it by itself:
    // the keyboard now runs another config than the one stored, which only an explicit put-on changes.
    await e.tick();
    await Bun.sleep(50);
    expect(w.calls.flashes).toEqual([]);
    expect(w.calls.builds).toHaveLength(1);
  });

  test("a verified flash that finishes after a switch is recorded as what is on the keyboard", async () => {
    const w = await world();
    w.flashed();
    const colemak = second(w);
    w.world.flashGate = gate();
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    const mine = edit(w, w.layoutId, "F17");
    await waitFor(() => w.calls.flashes.length === 1, "the flash to start");
    const queued = await e.useConfig(colemak);
    expect(queued.kind).toBe("queued");
    w.world.flashGate.open();
    w.world.flashGate = undefined;
    await waitFor(() => w.calls.flashes.length === 2, "the second config's flash");
    await settle(w, e);
    // A flash that had started was let finish (it is what the keyboard ran for a while), then the chosen config replaced it.
    const first = listVersionRows(w.app.db, w.layoutId).find((v) => v.revisionId === mine);
    expect(first?.putOnAt).not.toBeNull();
    expect(first?.endedAt).not.toBeNull();
    const last = listVersionRows(w.app.db, colemak);
    expect(last).toHaveLength(1);
    expect(last[0]?.endedAt).toBeNull();
  });
});

describe("two choices at once", () => {
  test("the later choice wins, and the keyboard ends on it", async () => {
    const w = await world();
    w.flashed();
    const colemak = second(w);
    edit(w, colemak, "F18");
    w.world.buildGate = gate();
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    const [first, last] = await Promise.all([e.useConfig(colemak), e.useConfig(w.layoutId)]);
    expect(first.kind).toBe("started");
    expect(last.kind).toBe("queued");
    w.world.buildGate.open();
    w.world.buildGate = undefined;
    await waitFor(() => recentSyncs(w.app.db).every((s) => s.status !== "building"), "the first build to end");
    await settle(w, e);
    await Bun.sleep(50);
    expect(getBoardConfig(w.app.db, BOARD)).toBe(w.layoutId);
    // The keyboard already ran the first config, so the second choice needs no flash; the first choice's build was stopped before it got there.
    expect(w.calls.flashes).toEqual([]);
    expect(recentSyncs(w.app.db).map((s) => s.status)).toEqual(["cancelled"]);
  });
});

describe("versions are recorded by verified syncs only", () => {
  test("a verified sync records a version that stays open until another replaces it", async () => {
    const w = await world();
    w.flashed();
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    const rev = edit(w, w.layoutId, "F17");
    await waitFor(() => w.calls.flashes.length === 1, "the flash");
    await settle(w, e);
    const v = listVersionRows(w.app.db, w.layoutId);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ revisionId: rev, boardId: BOARD, endedAt: null });
    expect(v[0]?.putOnAt).toBeGreaterThan(0);
    const next = edit(w, w.layoutId, "F18");
    await waitFor(() => w.calls.flashes.length === 2, "the second flash");
    await settle(w, e);
    const all = listVersionRows(w.app.db, w.layoutId).sort((a, b) => (a.putOnAt ?? 0) - (b.putOnAt ?? 0));
    expect(all.map((x) => x.revisionId)).toEqual([rev, next]);
    expect(all[0]?.endedAt).toBe(all[1]?.putOnAt as number);
    expect(all[1]?.endedAt).toBeNull();
  });

  for (const mode of ["fail", "unverified", "wrong_marker", "unplug", "needs_hand"] as const) {
    test(`a flash that ends as ${mode} records no version`, async () => {
      const w = await world();
      w.flashed();
      w.world.flashMode = mode;
      // A flash that needs a hand waits for one; opening the gate is the flasher giving up (fake-sync.ts).
      if (mode === "needs_hand") w.world.flashGate = gate();
      const e = w.engine({ quietMs: 5, tickMs: 2 });
      await e.start();
      edit(w, w.layoutId, "F17");
      await waitFor(() => w.calls.flashes.length >= 1, "the flash");
      w.world.flashGate?.open();
      await waitFor(() => recentSyncs(w.app.db)[0]?.status !== "building" && recentSyncs(w.app.db)[0]?.status !== "flashing", "the sync to end");
      expect(listVersionRows(w.app.db, w.layoutId)).toEqual([]);
    });
  }

  test("a failed build records no version", async () => {
    const w = await world();
    w.flashed();
    w.world.buildError = "the compiler said no";
    const e = w.engine({ quietMs: 5, tickMs: 2 });
    await e.start();
    edit(w, w.layoutId, "F17");
    await waitFor(() => recentSyncs(w.app.db)[0]?.status === "failed", "the build to fail");
    expect(listVersionRows(w.app.db, w.layoutId)).toEqual([]);
  });
});


describe("boards with archived configs", () => {
  test("a board with only archived configs disappears and returns when restored", async () => {
    const w = await world();
    w.app.db.query("DELETE FROM board_config WHERE board_id = ?").run(BOARD);
    setArchivedAt(w.app.db, w.layoutId, Date.now());
    const e = w.engine();
    expect((await e.snapshot()).some((b) => b.boardId === BOARD)).toBe(false);
    expect(w.calls.builds).toEqual([]);
    expect(w.calls.flashes).toEqual([]);
    setArchivedAt(w.app.db, w.layoutId, null);
    expect((await e.snapshot()).find((b) => b.boardId === BOARD)?.layoutId).toBe(w.layoutId);
  });

  test("the missing-selection fallback never selects a newer archived config", async () => {
    const w = await world();
    const other = second(w);
    setArchivedAt(w.app.db, other, Date.now());
    w.app.db.query("DELETE FROM board_config WHERE board_id = ?").run(BOARD);
    const e = w.engine();
    expect((await e.snapshot()).find((b) => b.boardId === BOARD)?.layoutId).toBe(w.layoutId);
  });
});
