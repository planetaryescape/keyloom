import { describe, expect, test } from "bun:test";
import { openApp, newConfig, getLayout, showConfig, archiveConfig, importLayout } from "../../src/app/index.ts";
import { listKeyboardCollection, removeKeyboard, restoreKeyboard } from "../../src/app/keyboard-collection.ts";
import { appLayoutSource } from "../../src/cli/serve.ts";
import { BOARD, syncWorld, gate, waitFor } from "../helpers/fake-sync.ts";
import { tempDir } from "../helpers/tmp.ts";
import { createBuild, createFlash, finishBuild, finishFlash, newBuildId, newFlashId } from "../../src/persistence/builds.ts";
import { STYLE_FIXTURE } from "../helpers/zmk.ts";

describe("a recoverable keyboard collection", () => {
  test("removal and restore are idempotent, unknown keyboards do not change the collection", () => {
    const app = openApp({ dataDir: tempDir() });
    try {
      newConfig(app, { name: "Synthetic", from: "blank", board: "foostan/corne" });
      const removed = removeKeyboard(app, "foostan/corne", 100);
      expect(removeKeyboard(app, "foostan/corne", 200)).toEqual(removed);
      expect(() => newConfig(app, { name: "Hidden", from: "blank", board: "foostan/corne" })).toThrow(/restore/);
      expect(() => removeKeyboard(app, "unknown/board")).toThrow(/no keyboard/);
      expect(() => restoreKeyboard(app, "unknown/board")).toThrow(/no keyboard/);
      expect(listKeyboardCollection(app)).toHaveLength(1);
      const restored = restoreKeyboard(app, "foostan/corne");
      expect(restoreKeyboard(app, "foostan/corne")).toEqual(restored);
    } finally { app.db.close(); }
  });
  test("removing a keyboard preserves its selected config and history, and restoring never enables auto-sync", () => {
    const app = openApp({ dataDir: tempDir() });
    try {
      const config = newConfig(app, { name: "Synthetic daily", from: "blank", board: "foostan/corne" });
      const before = getLayout(app, config.id);
      expect(removeKeyboard(app, "foostan/corne").removedAt).not.toBeNull();
      expect(listKeyboardCollection(app)[0]?.removedAt).not.toBeNull();
      expect(getLayout(app, config.id).document).toEqual(before.document);
      expect(showConfig(app, config.id).onKeyboard).toBe(true);
      expect(restoreKeyboard(app, "foostan/corne")).toMatchObject({ removedAt: null, paused: true, layoutId: config.id });
      expect(getLayout(app, config.id).revision.id).toBe(before.revision.id);
    } finally { app.db.close(); }
  });

  test("an import cannot create an invisible config for a removed keyboard", async () => {
    const app = openApp({ dataDir: tempDir() });
    try {
      newConfig(app, { name: "Synthetic original", from: "blank", board: "moergo/glove80" });
      removeKeyboard(app, "moergo/glove80");
      await expect(importLayout(app, { board: "moergo/glove80", source: STYLE_FIXTURE, name: "Invisible import" })).rejects.toThrow(/restore/);
      expect(listKeyboardCollection(app)[0]?.configCount).toBe(1);
    } finally { app.db.close(); }
  });

  test("an old archived-only keyboard can be restored without losing any other archived configs", () => {
    const app = openApp({ dataDir: tempDir() });
    try {
      const first = newConfig(app, { name: "Archived first", from: "blank", board: "foostan/corne", selectFirst: false });
      const second = newConfig(app, { name: "Archived second", from: "blank", board: "foostan/corne", selectFirst: false });
      archiveConfig(app, first.id); archiveConfig(app, second.id);
      expect(listKeyboardCollection(app).find((k) => k.boardId === "foostan/corne")?.removedAt).not.toBeNull();
      const restored = restoreKeyboard(app, "foostan/corne");
      expect(restored).toMatchObject({ removedAt: null, paused: true, configCount: 2 });
      expect(showConfig(app, restored.layoutId!).onKeyboard).toBe(true);
      expect([showConfig(app, first.id), showConfig(app, second.id)].filter((c) => c.archivedAt === null)).toHaveLength(1);
    } finally { app.db.close(); }
  });

  test("removed keyboards disappear from the UI source, survive restart, and cannot sync or resume", async () => {
    const w = await syncWorld({ proven: true });
    const engine = w.engine();
    try {
      w.flashed();
      removeKeyboard(w.app, BOARD);
      expect((await appLayoutSource(w.app).list()).some((l) => l.boardId === BOARD)).toBe(false);
      expect(await engine.snapshot()).toEqual([]);
      await expect(engine.syncNow(w.layoutId)).rejects.toThrow(/restore/i);
      expect(() => engine.setPaused(BOARD, false)).toThrow(/restore/i);
      expect(() => engine.setAutoSync(BOARD, true)).toThrow(/restore/i);
      const another = openApp({ dataDir: w.app.dataDir });
      try { expect(listKeyboardCollection(another).find((k) => k.boardId === BOARD)?.removedAt).not.toBeNull(); }
      finally { another.db.close(); }
      restoreKeyboard(w.app, BOARD);
      expect((await appLayoutSource(w.app).list()).some((l) => l.boardId === BOARD)).toBe(true);
      expect((await engine.snapshot())[0]?.auto.paused).toBe(true);
      expect(w.calls.builds).toEqual([]); expect(w.calls.flashes).toEqual([]);
    } finally { await engine.stop(); w.app.db.close(); }
  });

  test("removal refuses an in-progress sync and leaves the collection intact", async () => {
    const w = await syncWorld();
    w.world.reading = { state: "bootloader" };
    w.world.buildGate = gate();
    const engine = w.engine();
    try {
      const started = await engine.syncNow(w.layoutId);
      await waitFor(() => w.calls.builds.length > 0, "the fake build to start");
      expect(() => removeKeyboard(w.app, BOARD)).toThrow(/running/);
      expect(listKeyboardCollection(w.app).find((k) => k.boardId === BOARD)?.removedAt).toBeNull();
      w.world.buildGate.open();
      if (started.kind === "started" || started.kind === "already_running") await started.done;
    } finally { w.world.buildGate.open(); await engine.stop(); w.app.db.close(); }
  });

  test("removal during the preflight read prevents the pending manual sync from launching", async () => {
    const w = await syncWorld();
    w.world.reading = { state: "bootloader" };
    w.world.onRead = () => { removeKeyboard(w.app, BOARD); };
    const engine = w.engine();
    try {
      await expect(engine.syncNow(w.layoutId)).rejects.toThrow(/restore/);
      expect(w.calls.builds).toEqual([]);
      expect(w.calls.flashes).toEqual([]);
    } finally { await engine.stop(); w.app.db.close(); }
  });

  test("a manual flash must finish before a keyboard is removed", () => {
    const app = openApp({ dataDir: tempDir() });
    try {
      const config = newConfig(app, { name: "Synthetic flash", from: "blank", board: "foostan/corne" });
      const build = newBuildId();
      createBuild(app.db, { id: build, revisionId: getLayout(app, config.id).revision.id, layoutId: config.id, boardRevision: "reva", logPath: "logs/fake-build.log" });
      finishBuild(app.db, build, { artifactPath: "artifacts/fake.uf2" });
      const flash = newFlashId();
      createFlash(app.db, { id: flash, buildId: build, logPath: "logs/fake-flash.log" });
      expect(() => removeKeyboard(app, "foostan/corne")).toThrow(/running/);
      expect(listKeyboardCollection(app)[0]?.removedAt).toBeNull();
      finishFlash(app.db, flash, null);
      expect(removeKeyboard(app, "foostan/corne").removedAt).not.toBeNull();
    } finally { app.db.close(); }
  });
});
