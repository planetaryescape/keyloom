import { describe, expect, test } from "bun:test";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { optionOptionApp } from "../helpers/option-option.ts";

async function cli(args: string[]) {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  return { code: await runCli(args, io), out, err };
}

import { applyOps, getLayout } from "../../src/app/index.ts";

describe("keyloom version commands", () => {
  test("version list includes stay duration and version restore supports --no-sync", async () => {
    const { dir, app } = await optionOptionApp();
    const headRev = getLayout(app, "bk").revision.id;

    // Name a version first so we have a version milestone
    const nameRes = await cli(["version", "name", "bk", headRev, "first-version", "--data-dir", dir]);
    expect(nameRes.code).toBe(0);

    // List versions in json format
    const listJson = JSON.parse((await cli(["version", "list", "bk", "--json", "--data-dir", dir])).out);
    expect(listJson.versions).toHaveLength(1);
    expect(listJson.versions[0].name).toBe("first-version");
    expect(listJson.versions[0]).toHaveProperty("stay_seconds");
    expect(listJson.versions[0]).toHaveProperty("stay_label");

    // List versions in table format
    const listTable = await cli(["version", "list", "bk", "--format", "table", "--data-dir", dir]);
    expect(listTable.code).toBe(0);
    expect(listTable.out).toContain("first-version");

    // Restore with --no-sync
    // Make a change first so we aren't at the same revision
    applyOps(app, "bk", { baseRevisionId: getLayout(app, "bk").revision.id, ops: [{ op: "setBinding", at: { layerId: "layer-0", position: 33 }, binding: { kind: "key", code: "A" } }], summary: "test edit" });

    const restoreNoSync = JSON.parse((await cli(["version", "restore", "bk", "first-version", "--no-sync", "--data-dir", dir])).out);
    expect(restoreNoSync.sync_status).toBe("skipped");

    // Make another change
    applyOps(app, "bk", { baseRevisionId: getLayout(app, "bk").revision.id, ops: [{ op: "setBinding", at: { layerId: "layer-0", position: 33 }, binding: { kind: "key", code: "B" } }], summary: "test edit 2" });

    // Restore with default sync
    const restoreDefault = JSON.parse((await cli(["version", "restore", "bk", "first-version", "--data-dir", dir])).out);
    expect(["sync_queued", "not_on_keyboard"]).toContain(restoreDefault.sync_status);
  });
});
