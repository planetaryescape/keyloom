// Keyboard sync on the Glove80 through the real build and flash use cases, with a fake docker, fake serial ports and fake boot drives:
// Apply to both halves restarted, written and checked, the halves that need a hand, and firmware that isn't keyloom's.
import { describe, expect, test, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { type ChangeOp, applyOps, buildAndWait, flashAndWait, getBuild, getLayout } from "../../src/app/index.ts";
import { appSyncDeps } from "../../src/app/sync-deps.ts";
import { SyncEngine } from "../../src/app/sync-engine.ts";
import { buildKey } from "../../src/firmware/zmk/handsfree.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import { getBoardSync, lastSyncOfBoard, recentSyncs } from "../../src/persistence/syncs.ts";
import { OLD_KEY, fakeWorld, glove80Image, serialOf } from "../helpers/fake-zmk-halves.ts";
import { waitFor } from "../helpers/fake-sync.ts";
import { zmkEnv } from "../helpers/zmk.ts";

// waitFor can run up to 15 s on a slow runner (fake-sync.ts); bun's 5 s default would cut it off first.
setDefaultTimeout(20_000);

const BOARD = "moergo/glove80";
const half = (letter: "L" | "R", over: object = {}) => ({ letter, volume: letter === "L" ? "GLV80LHBOOT" : "GLV80RHBOOT", serial: serialOf(OLD_KEY, letter), ...over });

async function setup(halves: Array<ReturnType<typeof half>>, extra: { bootloaderWaitMs?: number } = {}) {
  const e = await zmkEnv();
  const world = fakeWorld({ root: e.volumes, halves });
  const handsFree = { usb: async () => [], zmk: world.deps };
  const base = appSyncDeps(e.app, { handsFree, volumesRoot: e.volumes, ...extra });
  const deps = {
    ...base,
    // The fake docker's firmware has no markers in it; give each build the ones a real build carries.
    build: async (a: Parameters<typeof base.build>[0]) => {
      const r = await base.build(a);
      if (r.ok && !r.reused) await Bun.write(((await getBuild(e.app, r.buildId)).artifactPath) as string, glove80Image(buildKey(r.buildId)));
      return r;
    },
  };
  const proveByHand = async () => {
    const b = await e.run(() => buildAndWait(e.app, "glove80"));
    await Bun.write(b.artifactPath as string, glove80Image(buildKey(b.id)));
    await e.run(() => flashAndWait(e.app, { buildId: b.id, volumesRoot: e.volumes, handsFree }));
    return b;
  };
  // Replaces the key at position 10, dropping whatever it did first (a plain setBinding loses it, D-020).
  let n = 0;
  const apply = (_code?: string) => {
    const view = getLayout(e.app, "glove80");
    const layer = view.document.layers[0];
    const old = layer?.bindings[10];
    const code = ["F13", "F14", "F15"][n++ % 3] as string;
    const ops: ChangeOp[] = [
      ...(old ? bindingFunctions(old, view.document.tapDances) : []).map((function_): ChangeOp => ({ op: "dropFunction", function: function_, reason: "test edit" })),
      { op: "setBinding", at: { layerId: layer?.id as string, position: 10 }, binding: { kind: "key", code } },
    ];
    return applyOps(e.app, "glove80", { baseRevisionId: view.revision.id, ops, summary: `key 11: ${code}` });
  };
  return { e, world, deps, handsFree, proveByHand, apply };
}

describe("Apply to both halves of a Glove80", () => {
  test("the first hands-free flash is the proof; then a sync restarts each half, writes it and checks it came back, with no key combo", async () => {
    const s = await setup([half("L"), half("R")]);
    const first = await s.proveByHand();
    expect(getBoardSync(s.e.app.db, BOARD)).toMatchObject({ provenBuildId: first.id });
    expect(s.world.touches.map((t) => t.baud)).toEqual([1200, 1200]);

    await s.e.run(async () => {
      const engine = new SyncEngine(s.e.app, s.deps, { quietMs: 80, tickMs: 10, pollMs: 30 });
      await engine.start();
      expect(engine.views()[0]?.state.kind).toBe("in_sync");
      const changed = s.apply("W");
      await waitFor(() => lastSyncOfBoard(s.e.app.db, BOARD)?.status === "succeeded", "the sync", 8000);
      await engine.stop();
      const run = lastSyncOfBoard(s.e.app.db, BOARD);
      expect(run).toMatchObject({ trigger: "auto", revisionId: changed.revisionId });
      expect(recentSyncs(s.e.app.db)).toHaveLength(1);
      // Both halves were restarted by touch and flashed with the new build: the key is in each image.
      expect(s.world.touches.map((t) => t.baud)).toEqual([1200, 1200, 1200, 1200]);
      const key = buildKey(run?.buildId as string);
      expect(s.world.flashed.slice(-2).map((f) => f.key)).toEqual([key, key]);
      expect(s.world.halves.map((h) => h.serial)).toEqual([serialOf(key, "L"), serialOf(key, "R")]);
      expect(engine.views()[0]?.state.kind).toBe("in_sync");
      for (const letter of ["L", "R"]) expect(Bun.file(join(s.e.dataDir, "firmware", "last-good", "moergo-glove80", `${letter}.uf2`)).size).toBeGreaterThan(0);
    });
    s.world.stop();
  });

  test("a right half whose own cable is out is a hand to give, with the reason and the instruction, and nothing is retried behind the person's back", async () => {
    const s = await setup([half("L"), half("R", { cabled: false })], { bootloaderWaitMs: 500 });
    await s.e.run(async () => {
      // Proven, as by an earlier flash with both cables in.
      const { recordHandsFreeProof } = await import("../../src/persistence/syncs.ts");
      const old = await buildAndWait(s.e.app, "glove80");
      recordHandsFreeProof(s.e.app.db, BOARD, old.id);
      for (const h of s.world.halves) h.serial = serialOf(buildKey(old.id), h.letter);
      const engine = new SyncEngine(s.e.app, s.deps, { quietMs: 40, tickMs: 10, pollMs: 30 });
      await engine.start();
      s.apply("W");
      await waitFor(() => engine.views()[0]?.state.kind === "needs_hand", "needs a hand", 8000);
      const state = engine.views()[0]?.state;
      expect(state).toMatchObject({ kind: "needs_hand", instruction: expect.stringContaining("couldn't restart the right half by itself") });
      await waitFor(() => lastSyncOfBoard(s.e.app.db, BOARD)?.status === "failed", "the flasher to give up", 8000);
      expect(lastSyncOfBoard(s.e.app.db, BOARD)).toMatchObject({ failure: "needs_hand" });
      expect(engine.views()[0]?.state).toMatchObject({ kind: "needs_hand", instruction: expect.stringContaining("Flash the right half") });
      const touches = s.world.touches.length;
      await Bun.sleep(200);
      expect(s.world.touches.length).toBe(touches);
      await engine.stop();
    });
    s.world.stop();
  });

  test("halves running firmware that isn't keyloom's are never flashed by auto-sync", async () => {
    const s = await setup([half("L", { serial: "moergo.com:GLV80-0123456789ABCDEF" }), half("R", { serial: "moergo.com:GLV80-0123456789ABCDEF" })]);
    await s.e.run(async () => {
      const { recordHandsFreeProof } = await import("../../src/persistence/syncs.ts");
      recordHandsFreeProof(s.e.app.db, BOARD, "bld_x");
      const engine = new SyncEngine(s.e.app, s.deps, { quietMs: 30, tickMs: 10, pollMs: 20 });
      await engine.start();
      s.apply("W");
      await Bun.sleep(250);
      expect(engine.views()[0]?.state.kind).toBe("not_keyloom");
      expect(s.world.touches).toEqual([]);
      expect(s.world.flashed).toEqual([]);
      expect(recentSyncs(s.e.app.db)).toEqual([]);
      await engine.stop();
    });
    s.world.stop();
  });
});
