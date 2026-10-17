// A put onto a new board makes that board's first config its config at once (D-334), and that must never be a reason to flash: auto-sync
// stays off for a board until keyloom has flashed it by itself and seen the firmware come back (D-160, 17#auto-sync). Here the Moonlander is
// proven and the Corne is not, and the Corne's keyboard is plugged in running keyloom firmware, the case in which a flash would be easiest.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { applyChange, listChanges, listConfigs } from "../../src/app/index.ts";
import { putConfig } from "../../src/app/keyboard-put.ts";
import type { KeyboardReading } from "../../src/app/sync-keyboard.ts";
import { buildKey } from "../../src/firmware/zmk/handsfree.ts";
import { createBuild, finishBuild, newBuildId } from "../../src/persistence/builds.ts";
import { getBoardConfig } from "../../src/persistence/configs.ts";
import { getBoardSync, recordHandsFreeProof } from "../../src/persistence/syncs.ts";
import { BOARD, type SyncWorld, syncWorld } from "../helpers/fake-sync.ts";

setDefaultTimeout(20_000);

const CORNE = "foostan/corne";
let current: SyncWorld | undefined;
afterEach(async () => {
  await current?.stopAll();
  current = undefined;
});

async function putOnCorne(w: SyncWorld, prove: boolean) {
  w.flashed();
  // The Corne's keyboard is plugged in and runs keyloom firmware keyloom built for the new config's blank start: the reading from
  // which an auto-sync would start once the config has changes the keyboard lacks.
  let corneReading: KeyboardReading = { state: "absent" };
  const e = w.engine({}, { ...w.deps, readKeyboards: async () => new Map([[BOARD, w.world.reading], [CORNE, corneReading]]) });
  await e.start();

  const out = putConfig(w.app, { from: w.layoutId, board: CORNE });
  expect(getBoardConfig(w.app.db, CORNE)).toBe(out.config.id);
  const buildId = newBuildId();
  createBuild(w.app.db, { id: buildId, revisionId: out.config.headRevisionId, layoutId: out.config.id, boardRevision: "default", logPath: `logs/${buildId}.log` });
  finishBuild(w.app.db, buildId, { artifactPath: `artifacts/${buildId}.uf2` });
  corneReading = { state: "keyloom", keys: [buildKey(buildId)], boardRevision: "default" };
  if (prove) recordHandsFreeProof(w.app.db, CORNE, buildId);
  // Apply what the put proposed: the new config's head moves ahead of what the keyboard runs.
  applyChange(w.app, out.proposals[0]!.changeSetId);
  expect(listChanges(w.app, out.config.id).some((c) => c.status === "applied")).toBe(true);
  // Long enough for several quiet periods (40 ms) and ticks (8 ms) of the engine.
  await Bun.sleep(400);
  return { e, out, view: e.views().find((v) => v.boardId === CORNE) };
}

describe("a put onto a new board", () => {
  test("makes its first config the board's config, schedules no sync, and builds and flashes nothing", async () => {
    current = await syncWorld();
    const w = current;
    const { out, view } = await putOnCorne(w, false);
    expect(view).toMatchObject({ layoutId: out.config.id, auto: { on: false, proven: false } });
    expect(view?.state).toMatchObject({ kind: "behind", why: "unproven" });
    expect(getBoardSync(w.app.db, CORNE).provenAt).toBeNull();
    expect(w.calls.builds).toEqual([]);
    expect(w.calls.flashes).toEqual([]);
    expect(listConfigs(w.app).some((c) => c.id === out.config.id)).toBe(true);
  });

  test("the same board, once proven, does sync on its own: the proof is the only thing between a put and a flash", async () => {
    current = await syncWorld();
    const w = current;
    await putOnCorne(w, true);
    expect(w.calls.builds.length).toBeGreaterThan(0);
  });
});
