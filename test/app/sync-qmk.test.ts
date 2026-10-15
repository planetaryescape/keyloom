// Keyboard sync on the Moonlander through the real build and flash use cases, with a fake docker, a fake zapp, a fake USB bus and
// a fake raw HID: Apply to a verified flash with no hands, the hands-free proof that allows auto-sync, and the last good image.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { applyOps, buildAndWait, flashAndWait, getBuild, getLayout } from "../../src/app/index.ts";
import { appSyncDeps } from "../../src/app/sync-deps.ts";
import { SyncEngine } from "../../src/app/sync-engine.ts";
import { buildMarker } from "../../src/firmware/qmk/handsfree.ts";
import { getBoardSync, lastSyncOfBoard, recentSyncs } from "../../src/persistence/syncs.ts";
import { liveKeyboard, REPEATING_ZAPP, stampMarker } from "../helpers/fake-live-keyboard.ts";
import { skewedClock, waitFor } from "../helpers/fake-sync.ts";
import { setKey } from "../helpers/ops.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";

const BOARD = "zsa/moonlander";
const OLD = "keyloom/AAAAAAAAAAAA";

async function setup() {
  const e = await toolchainEnv({ zapp: REPEATING_ZAPP });
  const kb = liveKeyboard(e.root, OLD);
  const env = { BOOTLOADER_FLAG: kb.flag };
  const stamp = async (id: string) => {
    const b = await getBuild(e.app, id);
    kb.state.expected = buildMarker(id);
    await stampMarker(b.artifactPath as string, buildMarker(id));
  };
  const base = appSyncDeps(e.app, { handsFree: kb.deps });
  const deps = {
    ...base,
    // The fake docker's firmware has no marker in it; give each build the one a real build carries.
    build: async (a: Parameters<typeof base.build>[0]) => {
      const r = await base.build(a);
      if (r.ok && !r.reused) await stamp(r.buildId);
      return r;
    },
  };
  return { e, kb, deps, stamp, run: <T>(fn: () => Promise<T>) => e.run(fn, env) };
}

describe("Apply to a verified flash on the Moonlander", () => {
  test("a verified hands-free flash is the proof, and from then on three quick Applies are one build, one flash and no keypress", async () => {
    const s = await setup();
    await s.run(async () => {
      expect(getBoardSync(s.e.app.db, BOARD).provenAt).toBeNull();
      // The first flash by hand of a keyloom build: the keyboard runs an earlier keyloom build, so it needs no key.
      const first = await buildAndWait(s.e.app, "synchronized", { boardRevision: "reva" });
      await s.stamp(first.id);
      const flash = await flashAndWait(s.e.app, { buildId: first.id, handsFree: s.kb.deps });
      expect(flash.note).toContain("Verified");
      expect(getBoardSync(s.e.app.db, BOARD)).toMatchObject({ provenBuildId: first.id });
      expect(getBoardSync(s.e.app.db, BOARD).provenAt).not.toBeNull();
      expect(s.kb.writes).toHaveLength(1);

      const clock = skewedClock();
      const QUIET = 10_000;
      const engine = new SyncEngine(s.e.app, s.deps, { quietMs: QUIET, tickMs: 600_000, pollMs: 30, now: clock.now });
      await engine.start();
      const view = () => engine.views().find((v) => v.boardId === BOARD);
      expect(view()?.state.kind).toBe("in_sync");
      expect(view()?.auto).toMatchObject({ on: true, proven: true });

      const apply = (code: string) => applyOps(s.e.app, "synchronized", { baseRevisionId: getLayout(s.e.app, "synchronized").revision.id, ops: setKey(6, code), summary: `key 6: ${code}` });
      apply("F17");
      apply("F18");
      const last = apply("F19");
      // The quiet time passes when the test says so, however slowly the Applies ran.
      clock.advance(QUIET);
      await engine.tick();
      await waitFor(() => lastSyncOfBoard(s.e.app.db, BOARD)?.status === "succeeded" && lastSyncOfBoard(s.e.app.db, BOARD)?.revisionId === last.revisionId, "the sync", 8000);
      await engine.stop();

      const runs = recentSyncs(s.e.app.db);
      expect(runs).toHaveLength(1);
      const run = runs[0];
      expect(run).toMatchObject({ trigger: "auto", status: "succeeded", revisionId: last.revisionId });
      // One packet for the first flash, one for the sync; nothing was pressed.
      expect(s.kb.writes).toHaveLength(2);
      expect((await Bun.file(s.e.vars.ZAPP_CALLS).text()).trim().split("\n")).toHaveLength(2);
      expect(s.kb.state.serial).toBe(buildMarker(run?.buildId as string));
      expect((await getBuild(s.e.app, run?.buildId as string)).revisionId).toBe(last.revisionId);
      expect(run?.finishedAt).toBeGreaterThan(run?.appliedAt ?? Number.POSITIVE_INFINITY);
      // The sync is in the log with times from Apply on.
      const log = await Bun.file(join(s.e.dataDir, run?.logPath as string)).text();
      expect(log).toContain("since Apply");
      expect(log).toContain("verified");
      // The last good image of the board is what was verified.
      const kept = join(s.e.dataDir, "firmware", "last-good", "zsa-moonlander", "reva.bin");
      expect(Bun.file(kept).size).toBeGreaterThan(0);
      expect(new Uint8Array(await Bun.file(kept).arrayBuffer())).toEqual(new Uint8Array(await Bun.file((await getBuild(s.e.app, run?.buildId as string)).artifactPath as string).arrayBuffer()));
    });
  });

  test("a flash by hand on a keyboard that runs someone else's firmware is not a proof", async () => {
    const e = await toolchainEnv({ zapp: REPEATING_ZAPP });
    const kb = liveKeyboard(e.root, "QxKPz/zLQ3Md");
    await e.run(async () => {
      const b = await buildAndWait(e.app, "synchronized", { boardRevision: "reva" });
      kb.state.expected = buildMarker(b.id);
      await stampMarker(b.artifactPath as string, buildMarker(b.id));
      // The person presses the reset key.
      const flashed = flashAndWait(e.app, { buildId: b.id, handsFree: kb.deps, bootloaderWaitMs: 5000 });
      setTimeout(() => void Bun.write(kb.flag, ""), 300);
      kb.state.mode = "dfu";
      kb.state.listings = 0;
      const f = await flashed;
      expect(f.note).toContain("Verified");
      expect(kb.writes).toEqual([]);
      expect(getBoardSync(e.app.db, BOARD).provenAt).toBeNull();
    }, { BOOTLOADER_FLAG: kb.flag });
  });
});

describe("a keyboard unplugged between the build and the flash", () => {
  test("is left alone, and the sync is tried again when it is plugged back in", async () => {
    const s = await setup();
    await s.run(async () => {
      const first = await buildAndWait(s.e.app, "synchronized", { boardRevision: "reva" });
      await s.stamp(first.id);
      await flashAndWait(s.e.app, { buildId: first.id, handsFree: s.kb.deps });
      const base = s.deps.build;
      let unplugged = false;
      const deps = {
        ...s.deps,
        build: async (a: Parameters<typeof base>[0]) => {
          const r = await base(a);
          if (!unplugged) {
            unplugged = true;
            s.kb.unplug();
          }
          return r;
        },
      };
      const engine = new SyncEngine(s.e.app, deps, { quietMs: 30, tickMs: 10, pollMs: 20 });
      await engine.start();
      applyOps(s.e.app, "synchronized", { baseRevisionId: getLayout(s.e.app, "synchronized").revision.id, ops: setKey(6, "F17"), summary: "key 6: F17" });
      await waitFor(() => lastSyncOfBoard(s.e.app.db, BOARD)?.failure === "disconnected", "the sync to find it gone", 8000);
      expect(s.kb.writes).toHaveLength(1); // only the first flash's packet
      expect(engine.views()[0]?.state.kind).toBe("not_connected");
      s.kb.plugIn();
      await waitFor(() => lastSyncOfBoard(s.e.app.db, BOARD)?.status === "succeeded", "the retry", 8000);
      await engine.stop();
      // The retry flashes the build that was already made; it is not built twice.
      const builds = recentSyncs(s.e.app.db).map((r) => r.buildId);
      expect(new Set(builds).size).toBe(1);
    });
  });
});
