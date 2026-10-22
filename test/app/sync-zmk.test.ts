// Keyboard sync on the Glove80 through the real build and flash use cases, with a fake docker, fake serial ports and fake boot drives:
// Apply to both halves restarted, written and checked, the halves that need a hand, and firmware that isn't keyloom's.
import { describe, expect, test, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { type ChangeOp, applyOps, buildAndWait, flashAndWait, getBuild, getLayout } from "../../src/app/index.ts";
import { backfillConditionalLayers, backfillLayerRefs } from "../../src/app/index.ts";
import { appSyncDeps } from "../../src/app/sync-deps.ts";
import { SyncEngine } from "../../src/app/sync-engine.ts";
import { buildKey } from "../../src/firmware/zmk/handsfree.ts";
import { withoutLayerNumbers } from "../../src/layout/layer-refs.ts";
import { appendRevision } from "../../src/persistence/revisions.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import { getBoardSync, lastSyncOfBoard, recentSyncs } from "../../src/persistence/syncs.ts";
import { OLD_KEY, fakeWorld, glove80Image, serialOf } from "../helpers/fake-zmk-halves.ts";
import { waitFor } from "../helpers/fake-sync.ts";
import { zmkEnv } from "../helpers/zmk.ts";
import { syncLine, syncNotice } from "../../src/web/sync/words.ts";

// waitFor can run up to 15 s on a slow runner (fake-sync.ts); bun's 5 s default would cut it off first.
setDefaultTimeout(20_000);

const BOARD = "moergo/glove80";
const half = (letter: "L" | "R", over: object = {}) => ({ letter, volume: letter === "L" ? "GLV80LHBOOT" : "GLV80RHBOOT", serial: serialOf(OLD_KEY, letter), ...over });

async function setup(halves: Array<ReturnType<typeof half>>, extra: { bootloaderWaitMs?: number } = {}, after?: Parameters<typeof fakeWorld>[0]["after"]) {
  const e = await zmkEnv();
  const world = fakeWorld({ root: e.volumes, halves, ...(after ? { after } : {}) });
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
  test("an absent left half after failed recovery never reports success or hides the error", async () => {
    let fail = false;
    const s = await setup([half("L"), half("R")], { bootloaderWaitMs: 100 }, (h, key) => fail && h.letter === "L" ? undefined : serialOf(key!, h.letter));
    await s.proveByHand();
    await rm(join(s.e.dataDir, "firmware", "last-good", "moergo-glove80", "R.uf2"));
    fail = true;
    try {
      await s.e.run(async () => {
        const engine = new SyncEngine(s.e.app, s.deps, { quietMs: 40, tickMs: 10, pollMs: 20 });
        const notices: ReturnType<typeof syncNotice>[] = [];
        let previous: ReturnType<typeof engine.views>[number] | undefined;
        engine.subscribe((views) => { const next = views[0]; if (next) { notices.push(syncNotice(previous, next)); previous = next; } });
        await engine.start();
        try {
          s.apply();
          await waitFor(() => lastSyncOfBoard(s.e.app.db, BOARD)?.status === "failed", "incomplete recovery", 8000);
          await engine.tick();
          const view = engine.views()[0]!;
          const error = lastSyncOfBoard(s.e.app.db, BOARD)!.error!;
          expect(view.state.kind).toBe("needs_hand");
          expect(syncLine(view, view.layoutId).detail).toContain(error);
          expect(syncLine(view, view.layoutId).tone).not.toBe("success");
          expect(notices.filter((n) => n?.kind === "success")).toEqual([]);
          expect((await engine.syncNow("glove80")).kind).not.toBe("in_sync");
        } finally { await engine.stop(); }
      });
    } finally { s.world.stop(); }
  });

  test.each(["pause", "stop"])("%s during recovery preserves the failed result and prevents automatic retry", async (action) => {
    let fail = false;
    const s = await setup([half("L"), half("R")], { bootloaderWaitMs: 100 }, (h, key) => fail && h.letter === "L" ? undefined : serialOf(key!, h.letter));
    await s.proveByHand();
    fail = true;
    try {
      await s.e.run(async () => {
        const engine = new SyncEngine(s.e.app, s.deps, { quietMs: 40, tickMs: 10, pollMs: 20 });
        const base = s.deps.flash;
        let requested = false;
        let stopping: Promise<void> | undefined;
        s.deps.flash = (a) => base({ ...a, onFlasherState: (state, instruction, note) => {
          a.onFlasherState(state, instruction, note);
          if (!requested && instruction?.startsWith("Restore the left half")) {
            requested = true;
            if (action === "pause") engine.setPaused(BOARD, true);
            else stopping = engine.stop();
          }
        } });
        await engine.start();
        try {
          s.apply();
          await waitFor(() => !!lastSyncOfBoard(s.e.app.db, BOARD)?.finishedAt, "recovery result", 8000);
          await stopping;
          expect(requested).toBe(true);
          const row = lastSyncOfBoard(s.e.app.db, BOARD)!;
          const error = row.error;
          expect(error).toContain("Rollback of the left half failed");
          expect(row).toMatchObject({ status: "failed", failure: "flash", error: expect.stringContaining("left half is absent or in its bootloader") });
          const count = recentSyncs(s.e.app.db).length;
          if (action === "pause") {
            engine.setPaused(BOARD, false);
            await Bun.sleep(200);
            expect(recentSyncs(s.e.app.db)).toHaveLength(count);
          }
        } finally { await engine.stop(); }
      });
    } finally { s.world.stop(); }
  });

  test("a split flash rolled back to the previous build is failed and behind, and flash again still works", async () => {
    const s = await setup([half("L"), half("R")], { bootloaderWaitMs: 100 });
    const first = await s.proveByHand();
    const transport = await s.world.deps.serial();
    let refuse = true;
    s.world.deps.serial = async () => ({
      ...transport,
      touch: async (path, baud) => {
        if (refuse && path.endsWith("-L")) throw new Error("injected left restart failure");
        await transport.touch(path, baud);
      },
    });
    try {
      await s.e.run(async () => {
        const engine = new SyncEngine(s.e.app, s.deps, { quietMs: 40, tickMs: 10, pollMs: 20 });
        await engine.start();
        try {
          s.apply();
          await waitFor(() => lastSyncOfBoard(s.e.app.db, BOARD)?.status === "failed", "rollback", 8000);
          const row = lastSyncOfBoard(s.e.app.db, BOARD)!;
          expect(row).toMatchObject({ status: "failed", failure: "flash", error: expect.stringContaining("The keyboard is back on the previous build") });
          expect(engine.views()[0]?.state).toMatchObject({ kind: "behind", why: "failed", error: expect.stringContaining("back on the previous build") });
          expect(s.world.halves.map((h) => h.serial)).toEqual([serialOf(buildKey(first.id), "L"), serialOf(buildKey(first.id), "R")]);
          for (const letter of ["L", "R"]) {
            const image = new Uint8Array(await Bun.file(join(s.e.dataDir, "firmware", "last-good", "moergo-glove80", `${letter}.uf2`)).arrayBuffer());
            expect(Buffer.from(image)).toEqual(Buffer.from(glove80Image(buildKey(first.id))));
          }
          const failed = await s.e.app.db.query("SELECT status, error FROM flashes WHERE id = ?").get(row.flashId);
          expect(failed).toMatchObject({ status: "failed", error: expect.stringContaining("back on the previous build") });
          const count = s.world.flashed.length;
          await Bun.sleep(150);
          expect(s.world.flashed.length).toBe(count);

          // An explicit successful flash of old A must not release failed head H for auto-sync.
          refuse = false;
          expect((await flashAndWait(s.e.app, { buildId: first.id, volumesRoot: s.e.volumes, handsFree: s.handsFree })).status).toBe("succeeded");
          await engine.tick();
          expect(engine.views()[0]?.auto.on).toBe(true);
          expect(engine.views()[0]?.state).toMatchObject({ kind: "behind", why: "failed" });
          const attempts = recentSyncs(s.e.app.db).length;
          await Bun.sleep(150);
          expect(recentSyncs(s.e.app.db)).toHaveLength(attempts);
          expect(lastSyncOfBoard(s.e.app.db, BOARD)?.id).toBe(row.id);

          // Reuse the failed build, as the existing flash-again path does.
          refuse = false;
          const retried = await flashAndWait(s.e.app, { buildId: row.buildId!, volumesRoot: s.e.volumes, handsFree: s.handsFree });
          expect(retried.status).toBe("succeeded");
          expect(s.world.halves.map((h) => h.serial)).toEqual([serialOf(buildKey(row.buildId!), "L"), serialOf(buildKey(row.buildId!), "R")]);
          await waitFor(() => engine.views()[0]?.state.kind === "in_sync", "Flash again clears the failed sync", 2000);
          s.apply();
          await waitFor(() => lastSyncOfBoard(s.e.app.db, BOARD)?.status === "succeeded", "auto-sync after Flash again", 8000);
        } finally { await engine.stop(); }
      });
    } finally { s.world.stop(); }
  });

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

describe("a layout whose layer numbers are read after it was flashed (D-378)", () => {
  test("the backfill revision is the build already on the keyboard: nothing is built or flashed, until a real edit", async () => {
    const s = await setup([half("L"), half("R")]);
    // The layout as it was stored before layer numbers were read, which is what BK's keyboard was flashed from.
    const view = getLayout(s.e.app, "glove80");
    appendRevision(s.e.app.db, { layoutId: view.layout.id, expectedHeadId: view.revision.id, layout: withoutLayerNumbers(view.document), origin: "editor", summary: "stored before" });
    const first = await s.proveByHand();
    const flashedAfterProof = s.world.flashed.length;
    const touchesAfterProof = s.world.touches.length;

    await s.e.run(async () => {
      const outcome = await backfillLayerRefs(s.e.app, () => {});
      expect(outcome.map((o) => o.status)).toEqual(["written"]);
      const engine = new SyncEngine(s.e.app, s.deps, { quietMs: 80, tickMs: 10, pollMs: 30 });
      await engine.start();
      // Several quiet periods and keyboard readings with the backfill revision as head.
      await new Promise((r) => setTimeout(r, 600));
      expect(engine.views()[0]?.state.kind).toBe("in_sync");
      expect(recentSyncs(s.e.app.db)).toHaveLength(0);
      expect(s.world.flashed).toHaveLength(flashedAfterProof);
      expect(s.world.touches).toHaveLength(touchesAfterProof);
      expect(getLayout(s.e.app, "glove80").revision.id).not.toBe(first.revisionId);

      // A real edit still syncs as normal.
      const changed = s.apply("W");
      await waitFor(() => lastSyncOfBoard(s.e.app.db, BOARD)?.status === "succeeded", "the sync", 8000);
      await engine.stop();
      expect(lastSyncOfBoard(s.e.app.db, BOARD)).toMatchObject({ trigger: "auto", revisionId: changed.revisionId });
    });
  });
});

describe("a layout whose conditional layers are read into the model after it was flashed (D-391)", () => {
  test("the two backfill revisions are the build already on the keyboard: nothing is built or flashed, until a real edit", async () => {
    const s = await setup([half("L"), half("R")]);
    // The layout as it was stored before conditions were modelled: the container is kept source, and no layer numbers were read.
    const view = getLayout(s.e.app, "glove80");
    const container = 'conditional_layers {\n    compatible = "zmk,conditional-layers";\n    tri_layer {\n        if-layers = <LOWER MAGIC>;\n        then-layer = <3>;\n    };\n};';
    const keptBefore = withoutLayerNumbers({ ...view.document, passthrough: [...view.document.passthrough, { firmware: "zmk", file: "glove80.keymap", anchor: "root:conditional_layers", source: container, refersToLayerIndices: false }] });
    appendRevision(s.e.app.db, { layoutId: view.layout.id, expectedHeadId: view.revision.id, layout: keptBefore, origin: "editor", summary: "stored before" });
    const first = await s.proveByHand();
    const flashedAfterProof = s.world.flashed.length;
    const touchesAfterProof = s.world.touches.length;

    await s.e.run(async () => {
      expect((await backfillLayerRefs(s.e.app, () => {})).map((o) => o.status)).toEqual(["written"]);
      expect((await backfillConditionalLayers(s.e.app, () => {})).map((o) => o.status)).toEqual(["written"]);
      expect(getLayout(s.e.app, "glove80").document.conditionalLayers).toHaveLength(1);
      const engine = new SyncEngine(s.e.app, s.deps, { quietMs: 80, tickMs: 10, pollMs: 30 });
      await engine.start();
      // Several quiet periods and keyboard readings with the second backfill revision as head.
      await new Promise((r) => setTimeout(r, 600));
      expect(engine.views()[0]?.state.kind).toBe("in_sync");
      expect(recentSyncs(s.e.app.db)).toHaveLength(0);
      expect(s.world.flashed).toHaveLength(flashedAfterProof);
      expect(s.world.touches).toHaveLength(touchesAfterProof);
      expect(getLayout(s.e.app, "glove80").revision.id).not.toBe(first.revisionId);

      // A real edit still syncs as normal.
      const changed = s.apply("W");
      await waitFor(() => lastSyncOfBoard(s.e.app.db, BOARD)?.status === "succeeded", "the sync", 8000);
      await engine.stop();
      expect(lastSyncOfBoard(s.e.app.db, BOARD)).toMatchObject({ trigger: "auto", revisionId: changed.revisionId });
    });
  });

  test("a real change made between the proof and the backfill is not skipped: the keyboard is behind", async () => {
    const s = await setup([half("L"), half("R")]);
    const view = getLayout(s.e.app, "glove80");
    const container = 'conditional_layers {\n    compatible = "zmk,conditional-layers";\n    tri_layer {\n        if-layers = <1 2>;\n        then-layer = <3>;\n    };\n};';
    appendRevision(s.e.app.db, { layoutId: view.layout.id, expectedHeadId: view.revision.id, layout: withoutLayerNumbers({ ...view.document, passthrough: [...view.document.passthrough, { firmware: "zmk", file: "glove80.keymap", anchor: "root:conditional_layers", source: container, refersToLayerIndices: false }] }), origin: "editor", summary: "stored before" });
    await s.proveByHand();
    await s.e.run(async () => {
      s.apply("W");
      await backfillLayerRefs(s.e.app, () => {});
      await backfillConditionalLayers(s.e.app, () => {});
      const engine = new SyncEngine(s.e.app, s.deps, { quietMs: 1_000_000, tickMs: 10, pollMs: 30 });
      await engine.start();
      await new Promise((r) => setTimeout(r, 200));
      expect(engine.views()[0]?.state.kind).not.toBe("in_sync");
      await engine.stop();
    });
  });
});
