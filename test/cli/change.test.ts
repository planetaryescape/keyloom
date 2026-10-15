import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { dropFunctions, setKey } from "../helpers/ops.ts";
import { tempDir } from "../helpers/tmp.ts";

type Result = { code: number; out: string; err: string };

async function cli(args: string[], opts: { tty?: boolean } = {}): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: opts.tty ?? false };
  return { code: await runCli(args, io), out, err };
}
const json = (r: Result) => JSON.parse(r.out);


async function setup() {
  const dir = tempDir();
  const run = (args: string[], opts?: { tty?: boolean }) => cli([...args, "--data-dir", dir], opts);
  const imp = json(await run(["import", "--board", "zsa/moonlander", FIXTURE_DIR]));
  const ops = (name: string, value: unknown) => {
    const file = join(dir, `${name}.json`);
    writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const cell = async (position: number) => {
    const shown = json(await run(["layout", "show", imp.layout_id, "--layer", "layer-0"]));
    return shown.layout.layers[0].bindings[position];
  };
  return { dir, run, ops, cell, layoutId: imp.layout_id as string, base: imp.revision_id as string };
}

describe("the rung 2 loop: check, propose, apply, undo", () => {
  test("changes a key and puts it back", async () => {
    const { run, ops, cell, layoutId, base } = await setup();
    const f17 = ops("f17", setKey(6, "F17"));

    const check = await run(["change", "check", layoutId, "--ops", f17]);
    expect(check.code).toBe(0);
    expect(json(check)).toMatchObject({ schema_version: 1, ok: true, validation: { ok: true, diff: { changed: [{ layerId: "layer-0", position: 6 }] } } });

    const propose = await run(["change", "propose", layoutId, "--ops", f17, "--explain", "F17 on key 6"]);
    expect(propose.code).toBe(0);
    const cs = json(propose);
    expect(cs.change_set_id).toMatch(/^cs_/);
    expect(cs.change_set).toMatchObject({ status: "proposed", base_revision_id: base, explanation: "F17 on key 6" });

    expect(await cell(6)).toEqual({ kind: "key", code: "F16" }); // propose changed nothing

    const apply = await run(["change", "apply", cs.change_set_id]);
    expect(apply.code).toBe(0);
    const applied = json(apply);
    expect(applied.revision_id).toMatch(/^rev_/);
    expect(await cell(6)).toEqual({ kind: "key", code: "F17" });

    const undone = json(await run(["undo", layoutId, "--rev", applied.revision_id]));
    expect(undone).toMatchObject({ schema_version: 1, undoes_revision_id: applied.revision_id });
    expect(await cell(6)).toEqual({ kind: "key", code: "F16" });
  });

  test("table output leads with the new ID, and show/list/reject work", async () => {
    const { run, ops, layoutId } = await setup();
    const file = ops("f17", { ops: setKey(6, "F17") }); // the object form is accepted too
    const propose = await run(["change", "propose", layoutId, "--ops", file, "--explain", "why"], { tty: true });
    const id = propose.out.split("\n")[0] ?? "";
    expect(id).toMatch(/^cs_[0-9A-Z]{26}$/);
    expect(propose.out).toContain("set layer-0:6 to key:F17");
    const list = await run(["change", "list", layoutId, "--status", "proposed"], { tty: true });
    expect(list.out).toContain(id);
    expect((await run(["change", "list", layoutId, "--format", "ids"])).out.trim()).toBe(id);
    const show = await run(["change", "show", id], { tty: true });
    expect(show.out).toContain("explanation: why");
    expect(json(await run(["change", "reject", id]))).toMatchObject({ status: "rejected" });
    expect(json(await run(["change", "list", layoutId, "--status", "proposed"])).change_sets).toEqual([]);
    expect((await run(["change", "apply", id])).code).toBe(2); // already rejected
  });
});

describe("exit codes", () => {
  test("a validation failure exits 4 and prints the errors on stdout", async () => {
    const { run, ops, layoutId } = await setup();
    const bad = ops("bad", [...dropFunctions(["key:F16"]), { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "holdTap", tap: { code: "A", mods: ["LSFT"] }, hold: { mods: ["LGUI"] }, profileId: "mod-tap" } }]);
    for (const args of [["change", "check", layoutId, "--ops", bad], ["change", "propose", layoutId, "--ops", bad, "--explain", "x"]]) {
      const r = await run(args);
      expect(r.code).toBe(4);
      expect(json(r)).toMatchObject({ ok: false, validation: { errors: [{ code: "qmk_modtap_basic", slots: [{ layerId: "layer-0", position: 6 }] }] } });
      expect(JSON.parse(r.err).error.code).toBe("validation_failed");
    }
    const table = await run(["change", "check", layoutId, "--ops", bad], { tty: true });
    expect(table.out).toContain("qmk_modtap_basic");
    expect(table.out).toContain("[layer-0:6]");
  });

  // Rung 3 done-check: removing the only route to a layer is refused. On BK's layout layer 4 (the
  // alternate typing layer) is entered only by the toggle key at layer-0 position 65.
  test("removing the only route to a layer exits 4 with layer_unreachable", async () => {
    const { run, ops, layoutId } = await setup();
    const bad = ops("strand", [{ op: "setBinding", at: { layerId: "layer-0", position: 65 }, binding: { kind: "none" } }]);
    const r = await run(["change", "check", layoutId, "--ops", bad]);
    expect(r.code).toBe(4);
    expect(json(r).validation.errors.map((e: { code: string }) => e.code)).toContain("layer_unreachable");
    const table = await run(["change", "check", layoutId, "--ops", bad], { tty: true });
    expect(table.out).toContain("layer_unreachable");
    expect(table.out).toContain("layer-4");
  });

  test("a stale base exits 5, for apply, undo and check --base", async () => {
    const { run, ops, layoutId, base } = await setup();
    const a = json(await run(["change", "propose", layoutId, "--ops", ops("a", setKey(6, "F17")), "--explain", "a"])).change_set_id;
    const b = json(await run(["change", "propose", layoutId, "--ops", ops("b", setKey(6, "F18")), "--explain", "b"])).change_set_id;
    expect((await run(["change", "apply", a])).code).toBe(0);

    const stale = await run(["change", "apply", b]);
    expect(stale.code).toBe(5);
    expect(JSON.parse(stale.err).error).toMatchObject({ code: "stale_base" });
    expect(JSON.parse(stale.err).error.message).toContain("layer-0:6");

    expect((await run(["undo", layoutId, "--rev", base])).code).toBe(5);

    const check = await run(["change", "check", layoutId, "--ops", ops("b", setKey(6, "F18")), "--base", base]);
    expect(check.code).toBe(4);
    expect(json(check).validation.errors[0].code).toBe("stale_base");
  });

  test("not found is 3, bad input is 2", async () => {
    const { run, ops, layoutId } = await setup();
    const good = ops("good", setKey(6, "F17"));
    expect((await run(["change", "show", "cs_ghost"])).code).toBe(3);
    expect((await run(["change", "check", "ghost", "--ops", good])).code).toBe(3);
    expect((await run(["change", "check", layoutId, "--ops", join(tempDir(), "missing.json")])).code).toBe(2);
    expect((await run(["change", "check", layoutId, "--ops", ops("notjson", "x")])).code).toBe(2);
    expect((await run(["change", "check", layoutId, "--ops", ops("bad-op", [{ op: "teleport" }])])).code).toBe(2);
    expect((await run(["change", "check", layoutId, "--ops", ops("empty", [])])).code).toBe(2);
    expect((await run(["undo", layoutId])).code).toBe(2); // the import has nothing before it
    expect((await run(["change", "propose", layoutId, "--ops", good, "--explain", " "])).code).toBe(2);
  });
});

describe("--ops -", () => {
  test("reads the ops from stdin", async () => {
    const dir = tempDir();
    const main = join(import.meta.dir, "../../src/cli/main.ts");
    const imp = await Bun.spawn(["bun", main, "import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", dir, "--format", "json"], { stdout: "pipe" });
    const { layout_id } = JSON.parse(await new Response(imp.stdout).text());
    const p = Bun.spawn(["bun", main, "change", "check", layout_id, "--ops", "-", "--data-dir", dir], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    p.stdin.write(JSON.stringify(setKey(6, "F17")));
    p.stdin.end();
    expect(await p.exited).toBe(0);
    expect(JSON.parse(await new Response(p.stdout).text()).ok).toBe(true);
  });
});
