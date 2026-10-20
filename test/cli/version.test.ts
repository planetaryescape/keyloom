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
import { setBoardConfig } from "../../src/persistence/configs.ts";

describe("keyloom version commands", () => {
  test("version list includes stay duration; restoring the active config only creates a revision", async () => {
    const { dir, app } = await optionOptionApp();
    setBoardConfig(app.db, "zsa/moonlander", getLayout(app, "bk").layout.id);
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

    // Make a change first so we aren't at the same revision
    applyOps(app, "bk", { baseRevisionId: getLayout(app, "bk").revision.id, ops: [{ op: "setBinding", at: { layerId: "layer-0", position: 33 }, binding: { kind: "key", code: "A" } }], summary: "test edit" });

    const restored = await cli(["version", "restore", "bk", "first-version", "--json", "--data-dir", dir]);
    expect(restored.code).toBe(0);
    expect(JSON.parse(restored.out)).toEqual({ schema_version: 1, revision_id: getLayout(app, "bk").revision.id, restored_revision_id: headRev });
    expect(app.db.query("SELECT * FROM syncs").all()).toEqual([]);

    applyOps(app, "bk", { baseRevisionId: getLayout(app, "bk").revision.id, ops: [{ op: "setBinding", at: { layerId: "layer-0", position: 33 }, binding: { kind: "key", code: "B" } }], summary: "test edit 2" });
    const table = await cli(["version", "restore", "bk", "first-version", "--format", "table", "--data-dir", dir]);
    expect(table.code).toBe(0);
    expect(table.out).not.toContain("sync queued");
    const help = await cli(["version", "restore", "--help"]);
    expect(help.out).not.toContain("--no-sync");
    app.db.close();
  });
});
