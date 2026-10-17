// keyloom config and keyloom version (10#commands, 25): the JSON contract, the exit codes, and `config use` against the fake world
// of the sync engine tests, so nothing reaches a real keyboard.
import { afterEach, describe, expect, test } from "bun:test";
import { applyOps, getLayout } from "../../src/app/index.ts";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { getBoardConfig } from "../../src/persistence/configs.ts";
import { BOARD, type SyncWorld, syncWorld } from "../helpers/fake-sync.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { defaultKeymapTree, emptyTree } from "../helpers/default-keymaps.ts";
import { setKey } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";

let current: SyncWorld | undefined;
afterEach(async () => {
  await current?.stopAll();
  current = undefined;
});

type Result = { code: number; out: string; err: string };
async function cli(w: SyncWorld, args: string[], fetchText = defaultKeymapTree()): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false };
  const code = await runCli([...args, "--data-dir", w.app.dataDir], io, {}, undefined, w.deps, undefined, { fetchText, cacheDir: tempDir() });
  return { code, out, err };
}
const json = (r: Result) => JSON.parse(r.out);
async function world(): Promise<SyncWorld> {
  current = await syncWorld();
  return current;
}
const edit = (w: SyncWorld, ref: string, code: string) =>
  applyOps(w.app, ref, { baseRevisionId: getLayout(w.app, ref).revision.id, ops: setKey(6, code), summary: `Layer 0, key 7: ${code}` }).revisionId;

describe("keyloom config", () => {
  test("list marks the config on the keyboard; new makes a copy that is not on it", async () => {
    const w = await world();
    const made = await cli(w, ["config", "new", "Colemak", "--from", "synchronized", "--format", "json"]);
    expect(made.code).toBe(0);
    expect(json(made)).toMatchObject({
      schema_version: 1,
      config: { name: "Colemak", board_id: BOARD, on_keyboard: false, archived_at: null, copied_from: { layout_id: w.layoutId, layout_name: "synchronized", revision_id: w.head() } },
    });
    const listed = json(await cli(w, ["config", "list", "--format", "json"]));
    expect(listed.configs.map((c: { name: string; on_keyboard: boolean }) => [c.name, c.on_keyboard]).sort()).toEqual([["Colemak", false], ["synchronized", true]]);
    const ids = await cli(w, ["config", "list", "--format", "ids"]);
    expect(ids.out.trim().split("\n")).toHaveLength(2);
  });

  test("new from a revision, from a version and blank; and the refusals are usage errors (2)", async () => {
    const w = await world();
    const first = w.head();
    edit(w, w.layoutId, "F17");
    const old = json(await cli(w, ["config", "new", "Old", "--from", w.layoutId, "--rev", first, "--format", "json"]));
    expect(old.config.copied_from.revision_id).toBe(first);
    const named = json(await cli(w, ["version", "name", w.layoutId, first, "the import", "--format", "json"]));
    const viaVersion = json(await cli(w, ["config", "new", "FromVersion", "--from", w.layoutId, "--from-version", "the import", "--format", "json"]));
    expect(viaVersion.config.copied_from.revision_id).toBe(first);
    expect(named.version.id).toMatch(/^ver_/);
    const blank = await cli(w, ["config", "new", "Steno", "--blank", "--board", BOARD, "--format", "json"]);
    expect(blank.code).toBe(0);
    expect(json(blank).config.copied_from).toBeNull();
    expect(json(blank).note).toContain("default keymap");

    for (const args of [["config", "new", "x"], ["config", "new", "x", "--blank"], ["config", "new", "x", "--blank", "--board", BOARD, "--from", w.layoutId], ["config", "new", "synchronized", "--from", w.layoutId]]) {
      expect((await cli(w, args)).code).toBe(2);
    }
    expect((await cli(w, ["config", "new", "x", "--from", "nope"])).code).toBe(3);
  });

  test("blank without a default keymap falls back to the Base layer and says why", async () => {
    const w = await world();
    const blank = await cli(w, ["config", "new", "Steno", "--blank", "--board", "foostan/corne"], emptyTree);
    expect(blank.code).toBe(0);
    expect(blank.out).toContain("no default keymap");
    expect(getLayout(w.app, "Steno").document.layers.map((l) => l.name)).toEqual(["Base"]);
  });

  test("new --from import reads a file into a config that is not on the keyboard, and use then puts it there", async () => {
    const w = await world();
    w.flashed();
    const made = await cli(w, ["config", "new", "Imported", "--from", "import", FIXTURE_DIR, "--board", BOARD, "--format", "json"]);
    expect(made.code).toBe(0);
    expect(json(made)).toMatchObject({ config: { name: "Imported", board_id: BOARD, on_keyboard: false, copied_from: null }, note: expect.stringContaining("Imported") });
    const id = json(made).config.id as string;
    expect(getLayout(w.app, id).revision.origin).toBe("import");
    expect(getBoardConfig(w.app.db, BOARD)).toBe(w.layoutId);
    const used = await cli(w, ["config", "use", "Imported", "--format", "json"]);
    expect(used.code).toBe(0);
    expect(json(used)).toMatchObject({ status: "synced", layout_id: id });
    expect(getBoardConfig(w.app.db, BOARD)).toBe(id);
    expect(w.calls.flashes).toHaveLength(1);
  });

  test("new --from import needs the file and the board, and refuses a taken name or a missing file", async () => {
    const w = await world();
    for (const args of [["config", "new", "x", "--from", "import", "--board", BOARD], ["config", "new", "x", "--from", "import", FIXTURE_DIR], ["config", "new", "x", "--from", "import", FIXTURE_DIR, "--board", BOARD, "--rev", "r"], ["config", "new", "x", "--from", w.layoutId, FIXTURE_DIR]]) {
      expect((await cli(w, args)).code).toBe(2);
    }
    const taken = await cli(w, ["config", "new", "synchronized", "--from", "import", FIXTURE_DIR, "--board", BOARD]);
    expect(taken.code).toBe(2);
    expect(taken.err).toContain("already exists; pick another name");
    expect((await cli(w, ["config", "new", "x", "--from", "import", "/nope/nothing", "--board", BOARD])).code).toBe(2);
  });

  test("rename, archive, restore and delete", async () => {
    const w = await world();
    await cli(w, ["config", "new", "Colemak", "--from", w.layoutId]);
    expect(json(await cli(w, ["config", "rename", "Colemak", "Colemak DH", "--format", "json"])).config.name).toBe("Colemak DH");
    expect(json(await cli(w, ["config", "archive", "Colemak DH", "--format", "json"])).config.archived_at).toEqual(expect.any(Number));
    expect(json(await cli(w, ["config", "list", "--format", "json"])).configs).toHaveLength(1);
    expect(json(await cli(w, ["config", "list", "--archived", "--format", "json"])).configs).toHaveLength(2);
    expect(json(await cli(w, ["config", "restore", "Colemak DH", "--format", "json"])).config.archived_at).toBeNull();
    expect((await cli(w, ["config", "delete", "Colemak DH", "wrong"])).code).toBe(2);
    expect(json(await cli(w, ["config", "delete", "Colemak DH", "Colemak DH", "--format", "json"])).deleted.name).toBe("Colemak DH");
    expect(json(await cli(w, ["config", "list", "--format", "json"])).configs).toHaveLength(1);
  });

  test("the config on the keyboard can't be archived or deleted (2)", async () => {
    const w = await world();
    const a = await cli(w, ["config", "archive", w.layoutId]);
    expect(a.code).toBe(2);
    expect(a.err).toContain("put another on");
    expect((await cli(w, ["config", "delete", "synchronized", "synchronized"])).code).toBe(2);
  });

  test("use puts a config on the keyboard with one sync, and sync status names it", async () => {
    const w = await world();
    w.flashed();
    await cli(w, ["config", "new", "Colemak", "--from", w.layoutId]);
    const colemak = (json(await cli(w, ["config", "list", "--format", "json"])).configs as Array<{ id: string; name: string }>).find((c) => c.name === "Colemak")?.id as string;
    edit(w, colemak, "F18");
    const used = await cli(w, ["config", "use", "Colemak", "--format", "json"]);
    expect(used.code).toBe(0);
    expect(json(used)).toMatchObject({ status: "synced", layout_id: colemak });
    expect(getBoardConfig(w.app.db, BOARD)).toBe(colemak);
    expect(w.calls.flashes).toHaveLength(1);

    const status = json(await cli(w, ["sync", "status", "--format", "json"]));
    expect(status.boards[0]).toMatchObject({ board_id: BOARD, config_id: colemak, config_name: "Colemak", other_configs: 1, state: "in_sync" });
    const table = await cli(w, ["sync", "status", "--format", "table"]);
    expect(table.out).toContain("Colemak");

    // The other config is refused by sync, with the way to put it on.
    const refused = await cli(w, ["sync", "synchronized"]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("keyloom config use synchronized");
  });

  test("use on an unplugged keyboard is a usage error and leaves the choice alone", async () => {
    const w = await world();
    await cli(w, ["config", "new", "Colemak", "--from", w.layoutId]);
    const r = await cli(w, ["config", "use", "Colemak"]);
    expect(r.code).toBe(2);
    expect(getBoardConfig(w.app.db, BOARD)).toBe(w.layoutId);
  });
});

describe("keyloom version", () => {
  test("list shows versions after a verified sync, with the revisions between them", async () => {
    const w = await world();
    w.flashed();
    const a = w.apply();
    expect((await cli(w, ["sync", w.layoutId])).code).toBe(0);
    const b = w.apply();
    const c = w.apply();
    expect((await cli(w, ["sync", w.layoutId])).code).toBe(0);
    const out = json(await cli(w, ["version", "list", w.layoutId, "--format", "json"]));
    expect(out.pending).toEqual([]);
    expect(out.versions.map((v: { revision_id: string }) => v.revision_id)).toEqual([c, a]);
    expect(out.versions[0]).toMatchObject({ current: true, ended_at: null, revisions: [{ revision_id: b }] });
    expect(out.versions[1].ended_at).toBe(out.versions[0].put_on_at);
    const table = await cli(w, ["version", "list", w.layoutId, "--format", "table"]);
    expect(table.out).toContain("on the keyboard since");
    const jsonl = (await cli(w, ["version", "list", w.layoutId, "--format", "jsonl"])).out.trim().split("\n");
    expect(jsonl).toHaveLength(2);
  });

  test("name, restore and compare: restore goes back as a new revision and compare shows what it undoes", async () => {
    const w = await world();
    w.flashed();
    const first = w.head();
    w.apply();
    const head = w.apply();
    const named = json(await cli(w, ["version", "name", w.layoutId, first, "before the tweak", "--format", "json"]));
    expect(named.version).toMatchObject({ name: "before the tweak", put_on_at: null });

    const compared = await cli(w, ["version", "compare", w.layoutId, "before the tweak", "--format", "json"]);
    expect(compared.code).toBe(0);
    expect(json(compared)).toMatchObject({ same: false, from: { revision_id: first }, to: { revision_id: head }, keys: [{ position: 6, layer_id: "layer-0" }] });
    expect((await cli(w, ["version", "compare", w.layoutId, "before the tweak", "--format", "table"])).out).toContain("1 key differs");

    const restored = await cli(w, ["version", "restore", w.layoutId, "before the tweak", "--format", "json"]);
    expect(restored.code).toBe(0);
    expect(json(restored)).toMatchObject({ restored_revision_id: first, revision_id: expect.stringMatching(/^rev_/) });
    expect(json(await cli(w, ["version", "compare", w.layoutId, "before the tweak", "--format", "json"])).same).toBe(true);
    expect((await cli(w, ["version", "compare", w.layoutId, "before the tweak", "--format", "table"])).out).toContain("is the same as the head");
    // Going back to the head again is refused.
    expect((await cli(w, ["version", "restore", w.layoutId, "before the tweak"])).code).toBe(2);
    expect((await cli(w, ["version", "restore", w.layoutId, "no such version"])).code).toBe(3);
  });

  test("the program's own --version still prints the version", async () => {
    const w = await world();
    const r = await cli(w, ["--version"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
