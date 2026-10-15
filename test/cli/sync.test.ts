// keyloom sync, sync status and autosync (10#commands), against the fake world of the sync engine tests: the JSON contract,
// the exit codes, and the refusals.
import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { claimSync, finishSync, getBoardSync, newSyncId } from "../../src/persistence/syncs.ts";
import { BOARD, type SyncWorld, syncWorld } from "../helpers/fake-sync.ts";

let current: SyncWorld | undefined;
afterEach(async () => {
  await current?.stopAll();
  current = undefined;
});

type Result = { code: number; out: string; err: string };
async function cli(w: SyncWorld, args: string[]): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  const code = await runCli([...args, "--data-dir", w.app.dataDir], io, {}, undefined, w.deps);
  return { code, out, err };
}
const json = (r: Result) => JSON.parse(r.out);
async function world(opts: Parameters<typeof syncWorld>[0] = {}): Promise<SyncWorld> {
  current = await syncWorld(opts);
  return current;
}

describe("keyloom sync", () => {
  test("puts the head on the keyboard and prints the sync, the build, the flash and the time from Apply", async () => {
    const w = await world();
    w.flashed();
    const head = w.apply();
    const r = await cli(w, ["sync", w.layoutId, "--format", "json"]);
    expect(r.code).toBe(0);
    expect(json(r)).toMatchObject({
      schema_version: 1, status: "synced", board_id: BOARD, layout_id: w.layoutId, revision_id: head, sync_id: expect.stringMatching(/^syn_/), build_id: expect.stringMatching(/^bld_/),
      timings_s: { wait: expect.any(Number), build: expect.any(Number), flash: expect.any(Number), apply_to_verified: expect.any(Number) },
    });
    expect(w.calls.flashes).toHaveLength(1);
    // The default verb is run, so a layout name works the same.
    const again = await cli(w, ["sync", "synchronized", "--format", "json"]);
    expect(again.code).toBe(0);
    expect(json(again)).toMatchObject({ status: "in_sync", sync_id: null, revision_id: head });
    expect(w.calls.flashes).toHaveLength(1);
  });

  test("--quiet prints the sync ID, and --format ids too", async () => {
    const w = await world();
    w.flashed();
    w.apply();
    const r = await cli(w, ["sync", w.layoutId, "--quiet", "--format", "table"]);
    expect(r.out.trim()).toMatch(/^syn_[0-9A-Z]{26}$/);
  });

  test("no keyboard attached is a usage error (2)", async () => {
    const w = await world();
    const r = await cli(w, ["sync", w.layoutId, "--format", "json"]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.err)).toMatchObject({ error: { code: "usage", message: expect.stringContaining("no Moonlander is attached") } });
  });

  test("firmware keyloom didn't build is refused (2) with the deliberate way, and nothing is built", async () => {
    const w = await world();
    w.world.reading = { state: "other", detail: "USB serial QxKPz/zLQ3Md" };
    const r = await cli(w, ["sync", w.layoutId]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("keyloom flash --layout");
    expect(w.calls.builds).toEqual([]);
  });

  test("a failed build is 7, a failed or unverifiable flash is 8, and the log is named", async () => {
    const w = await world();
    w.flashed();
    w.apply();
    w.world.buildError = "compile error";
    const build = await cli(w, ["sync", w.layoutId]);
    expect(build.code).toBe(7);
    expect(build.err).toContain("compile error");
    expect(build.err).toMatch(/logs\/sync-syn_/);
    w.world.buildError = undefined;
    w.world.flashMode = "fail";
    const flash = await cli(w, ["sync", w.layoutId]);
    expect(flash.code).toBe(8);
    w.world.flashMode = "unverified";
    expect((await cli(w, ["sync", w.layoutId])).code).toBe(8);
  });

  test("another sync running is refused, and --wait waits for it", async () => {
    const w = await world();
    w.flashed();
    w.apply();
    // A sync in another live process (the shell that runs this test), as the server's would be.
    const mk = () => claimSync(w.app.db, { id: newSyncId(), boardId: BOARD, layoutId: w.layoutId, revisionId: w.head(), boardRevision: "reva", trigger: "auto", logPath: "logs/x.log", appliedAt: 1, owner: "server", pid: process.ppid }, () => true);
    const claimed = mk();
    expect("claimed" in claimed).toBe(true);
    const refused = await cli(w, ["sync", w.layoutId]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("another keyloom sync is running");
    setTimeout(() => finishSync(w.app.db, (claimed as { claimed: { id: string } }).claimed.id, { status: "succeeded" }), 700);
    const waited = await cli(w, ["sync", w.layoutId, "--wait", "--format", "json"]);
    expect(waited.code).toBe(0);
    expect(json(waited).status).toBe("synced");
  });
});

describe("keyloom sync status", () => {
  test("says each board's state in JSON, with the auto-sync setting and the last sync", async () => {
    const w = await world();
    w.flashed();
    const r = await cli(w, ["sync", "status", "--format", "json"]);
    expect(r.code).toBe(0);
    expect(json(r).boards).toEqual([
      expect.objectContaining({ board_id: BOARD, board_name: "Moonlander", state: "in_sync", auto_sync: expect.objectContaining({ on: true, proven: true }), last_sync: null }),
    ]);
    w.apply();
    const behind = json(await cli(w, ["sync", "status", "--format", "json"])).boards[0];
    expect(behind).toMatchObject({ state: "behind", changes: 1, why: "waiting" });
    w.world.reading = { state: "absent" };
    expect(json(await cli(w, ["sync", "status", "--format", "json"])).boards[0].state).toBe("not_connected");
    const table = await cli(w, ["sync", "status", "--format", "table"]);
    expect(table.out).toContain("not connected");
  });

  test("a layout named status is not mistaken for the verb: sync run takes it", async () => {
    const w = await world();
    w.flashed();
    const r = await cli(w, ["sync", "run", w.layoutId, "--format", "json"]);
    expect(r.code).toBe(0);
  });
});

describe("keyloom autosync", () => {
  test("can't be turned on before a flash keyloom did by itself was verified (2), and says how", async () => {
    const w = await world({ proven: false });
    const r = await cli(w, ["autosync", "on", BOARD]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("auto-sync can turn on once keyloom has flashed this board by itself");
    const status = json(await cli(w, ["autosync", "status", BOARD, "--format", "json"]));
    expect(status).toMatchObject({ board_id: BOARD, auto_sync: "off", proven: false });
  });

  test("once proven it is on by itself; off, pause and resume are remembered", async () => {
    const w = await world();
    expect(json(await cli(w, ["autosync", "status", BOARD, "--format", "json"]))).toMatchObject({ auto_sync: "on", choice: null, proven: true });
    expect(json(await cli(w, ["autosync", "off", BOARD, "--format", "json"]))).toMatchObject({ auto_sync: "off", choice: false });
    expect(getBoardSync(w.app.db, BOARD).autoSync).toBe(false);
    expect(json(await cli(w, ["autosync", "on", BOARD, "--format", "json"]))).toMatchObject({ auto_sync: "on", choice: true });
    expect(json(await cli(w, ["autosync", "pause", BOARD, "--format", "json"]))).toMatchObject({ auto_sync: "off", paused: true });
    expect(json(await cli(w, ["autosync", "resume", BOARD, "--format", "json"]))).toMatchObject({ auto_sync: "on", paused: false });
    const table = await cli(w, ["autosync", "status", BOARD, "--format", "table"]);
    expect(table.out).toContain("Moonlander: auto-sync is on");
  });

  test("a board keyloom can't sync, or doesn't know, is refused", async () => {
    const w = await world();
    expect((await cli(w, ["autosync", "on", "nope/board"])).code).toBe(3);
    expect((await cli(w, ["autosync", "on", "keebio/iris"])).code).toBeGreaterThanOrEqual(2);
  });
});
