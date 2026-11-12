// Whether keyloom's firmware was ever put on a board, from any config: what decides "keyloom sees your {board} once keyloom's firmware is on
// it" for a board with no USB IDs (R6-10, PR #297 review).
import { describe, expect, test } from "bun:test";
import { createBuild, createFlash, finishFlash, keyloomFirmwareWrittenTo, newBuildId } from "../../src/persistence/builds.ts";
import { recordVersion } from "../../src/persistence/versions.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";

describe("keyloomFirmwareWrittenTo", () => {
  test("a finished write of any config's build counts, including one keyloom couldn't confirm; a failed write and other boards don't", async () => {
    const e = await toolchainEnv();
    const db = e.app.db;
    const board = "zsa/moonlander";
    const flash = (error: { error: string; errorCode: string } | null) => {
      const buildId = newBuildId();
      createBuild(db, { id: buildId, revisionId: e.imported.revisionId, layoutId: e.imported.layoutId, boardRevision: "revb", logPath: `logs/build-${buildId}.log` });
      const id = `fl_${buildId}`;
      createFlash(db, { id, buildId, logPath: `logs/flash-${id}.log` });
      finishFlash(db, id, error);
    };
    expect(keyloomFirmwareWrittenTo(db, board)).toBe(false);
    flash({ error: "Cancelled.", errorCode: "cancelled" });
    expect(keyloomFirmwareWrittenTo(db, board)).toBe(false);
    flash({ error: "keyloom couldn't confirm it.", errorCode: "not_confirmed" });
    expect(keyloomFirmwareWrittenTo(db, board)).toBe(true);
    expect(keyloomFirmwareWrittenTo(db, "foostan/corne")).toBe(false);
    e.closeApp();
  });

  test("a version put on the board counts even after a later one ended it", async () => {
    const e = await toolchainEnv();
    const db = e.app.db;
    recordVersion(db, { layoutId: e.imported.layoutId, revisionId: e.imported.revisionId, boardId: "zsa/moonlander", syncId: null, at: 1 });
    db.query("UPDATE versions SET ended_at = 2").run();
    expect(keyloomFirmwareWrittenTo(db, "zsa/moonlander")).toBe(true);
    e.closeApp();
  });
});
