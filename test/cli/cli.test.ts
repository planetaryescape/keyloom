import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runCli } from "../../src/cli/main.ts";
import type { Io } from "../../src/cli/output.ts";
import { FIXTURE_DIR, MOONLANDER_DIR } from "../helpers/board.ts";
import { SLOW_RUNNER_MS } from "../helpers/timeouts.ts";
import { tempDir } from "../helpers/tmp.ts";

type Result = { code: number; out: string; err: string };

async function cli(args: string[], opts: { tty?: boolean } = {}): Promise<Result> {
  let out = "";
  let err = "";
  const io: Io = { out: (t) => void (out += t), err: (t) => void (err += t), isTTY: opts.tty ?? false };
  const code = await runCli(args, io);
  return { code, out, err };
}

const json = (r: Result) => JSON.parse(r.out);

describe("the rung 1 demo", () => {
  test("import prints the layout id first, then the report; layout show prints every layer as a grid", async () => {
    const dir = tempDir();
    const imp = await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", dir], { tty: true });
    expect(imp.code).toBe(0);
    const lines = imp.out.split("\n");
    expect(lines[0]).toMatch(/^lay_[0-9A-Z]{26}$/);
    expect(imp.out).toContain("6 layers x 72 keys");
    expect(imp.out).toContain("native bindings kept as source (23)");
    expect(imp.out).toContain("passthrough kept verbatim (9)");
    expect(imp.out).toContain("keymap.c rgb");

    const show = await cli(["layout", "show", "synchronized", "--data-dir", dir], { tty: true });
    expect(show.code).toBe(0);
    for (let i = 0; i < 6; i++) expect(show.out).toContain(`Layer ${i} (layer-${i})`);
    const base = show.out.split("\n\n")[1] ?? ""; // [0] is the layout header line
    expect(base).toContain("S/⌥");
    expect(base).toContain("TD0");
    expect(base.split("\n").length).toBeGreaterThanOrEqual(7);
  });

  test("layout show --format json prints the IR with schema_version, and by id", async () => {
    const dir = tempDir();
    const imp = JSON.parse((await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", dir, "--format", "json"])).out);
    expect(Object.keys(imp)[0]).toBe("schema_version"); // then the id: the id comes before the report
    expect(Object.keys(imp)[1]).toBe("layout_id");
    const show = json(await cli(["layout", "show", imp.layout_id, "--data-dir", dir]));
    expect(show.schema_version).toBe(1);
    expect(show.layout.schemaVersion).toBe(1);
    expect(show.layout.layers).toHaveLength(6);
    expect(show.layout.layers[0].bindings).toHaveLength(72);
    expect(show.revision_id).toBe(imp.revision_id);
  });

  test("a subprocess run, as the user types it, works from another directory", async () => {
    const dir = tempDir();
    const main = join(import.meta.dir, "../../src/cli/main.ts");
    const run = async (...args: string[]) => {
      const p = Bun.spawn(["bun", main, ...args, "--data-dir", dir], { cwd: tempDir(), stdout: "pipe", stderr: "pipe" });
      return { code: await p.exited, out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text() };
    };
    const imp = await run("import", "--board", "zsa/moonlander", FIXTURE_DIR);
    expect(imp.err).toBe("");
    expect(imp.code).toBe(0);
    const show = await run("layout", "show", "synchronized", "--format", "table");
    expect(show.code).toBe(0);
    expect(show.out).toContain("Layer 5 (layer-5)");
  }, SLOW_RUNNER_MS);

  test("concurrent imports from separate processes all land with distinct names", async () => {
    const dir = tempDir();
    const main = join(import.meta.dir, "../../src/cli/main.ts");
    const procs = Array.from({ length: 3 }, () =>
      Bun.spawn(["bun", main, "import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", dir, "--format", "ids"], { stdout: "pipe", stderr: "pipe" }),
    );
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes).toEqual([0, 0, 0]);
    const list = json(await cli(["layout", "list", "--data-dir", dir]));
    expect(list.layouts.map((l: { name: string }) => l.name).sort()).toEqual(["synchronized", "synchronized-2", "synchronized-3"]);
  }, SLOW_RUNNER_MS);
});

describe("output formats", () => {
  test("default is table on a TTY and json otherwise", async () => {
    const dir = tempDir();
    await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", dir]);
    const piped = await cli(["layout", "list", "--data-dir", dir]);
    expect(json(piped).schema_version).toBe(1);
    const tty = await cli(["layout", "list", "--data-dir", dir], { tty: true });
    expect(tty.out).toStartWith("ID ");
  });

  test("ids prints one id per line; jsonl one object per line; both reject what they can't do", async () => {
    const dir = tempDir();
    await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", dir]);
    await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--name", "second", "--data-dir", dir]);
    const ids = await cli(["layout", "list", "--format", "ids", "--data-dir", dir]);
    expect(ids.out.trim().split("\n")).toHaveLength(2);
    for (const id of ids.out.trim().split("\n")) expect(id).toMatch(/^lay_/);
    const rows = (await cli(["layout", "list", "--format", "jsonl", "--data-dir", dir])).out.trim().split("\n").map((l) => JSON.parse(l));
    expect(rows.map((r) => r.name)).toEqual(["synchronized", "second"]);
    expect(rows[0].schema_version).toBe(1);
    const single = await cli(["doctor", "--format", "ids", "--data-dir", dir]);
    expect(single.code).toBe(2);
  }, SLOW_RUNNER_MS);

  test("--quiet prints only the id after an import", async () => {
    const r = await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", tempDir(), "--quiet"], { tty: true });
    expect(r.out.trim()).toMatch(/^lay_[0-9A-Z]{26}$/);
  });

  test("an unknown --format is a usage error", async () => {
    const r = await cli(["layout", "list", "--format", "xml"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("xml");
  });
});

describe("layout show", () => {
  test("--layer picks a layer by index, id or name, in both formats", async () => {
    const dir = tempDir();
    await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", dir]);
    for (const l of ["3", "layer-3", "Layer 3"]) {
      const r = await cli(["layout", "show", "synchronized", "--layer", l, "--format", "table", "--data-dir", dir]);
      expect(r.out).toContain("Layer 3 (layer-3)");
      expect(r.out).not.toContain("Layer 2 (");
    }
    const j = json(await cli(["layout", "show", "synchronized", "--layer", "3", "--data-dir", dir]));
    expect(j.layout.layers.map((l: { id: string }) => l.id)).toEqual(["layer-3"]);
    const bad = await cli(["layout", "show", "synchronized", "--layer", "constructor", "--data-dir", dir]);
    expect(bad.code).toBe(3);
  });

  test("--rev takes a revision of that layout only", async () => {
    const dir = tempDir();
    const imp = json(await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", dir]));
    expect((await cli(["layout", "show", "synchronized", "--rev", imp.revision_id, "--data-dir", dir])).code).toBe(0);
    expect((await cli(["layout", "show", "synchronized", "--rev", "rev_nope", "--data-dir", dir])).code).toBe(3);
  });
});

describe("exit codes", () => {
  test("not found is 3, with a JSON error body when the format is json", async () => {
    const dir = tempDir();
    const r = await cli(["layout", "show", "ghost", "--data-dir", dir]);
    expect(r.code).toBe(3);
    expect(JSON.parse(r.err)).toEqual({ schema_version: 1, error: { code: "not_found", message: 'no layout "ghost"' } });
    const t = await cli(["layout", "show", "ghost", "--data-dir", dir], { tty: true });
    expect(t.code).toBe(3);
    expect(t.err).toBe('error: no layout "ghost"\n');
  });

  test("usage errors are 2: unknown option, missing board, missing file, empty name", async () => {
    const dir = tempDir();
    expect((await cli(["--nope"])).code).toBe(2);
    expect((await cli(["import", FIXTURE_DIR, "--data-dir", dir])).code).toBe(2); // no --board
    expect((await cli(["import", "--board", "zsa/moonlander", "--data-dir", dir])).code).toBe(2); // no file
    expect((await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--name", " ", "--data-dir", dir])).code).toBe(2);
    expect((await cli(["import", "--board", "zsa/moonlander", "/no/such/file", "--data-dir", dir])).code).toBe(2);
  });

  test("an unknown board is 3", async () => {
    expect((await cli(["import", "--board", "no/such", FIXTURE_DIR, "--data-dir", tempDir()])).code).toBe(3);
    expect((await cli(["boards", "show", "no/such"])).code).toBe(3);
  });

  test("help is not a failure", async () => {
    const r = await cli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("import");
  });

  test("--version prints the package version", async () => {
    const r = await cli(["--version"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("an unexpected error is 1 and names a log file", async () => {
    const dir = tempDir();
    // A data dir that is a file makes the database impossible to open: not the user's mistake in the CLI's eyes.
    const file = join(dir, "afile");
    await Bun.write(file, "x");
    const r = await cli(["layout", "list", "--data-dir", file]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("unexpected error");
  });
});

describe("boards", () => {
  test("list, show", async () => {
    const list = json(await cli(["boards", "list"]));
    // Contributors add boards as data (rung 8), so this names the two BK owns rather than the whole list.
    expect(list.boards).toEqual(expect.arrayContaining([
      { id: "moergo/glove80", name: "Glove80", firmware: "zmk", key_count: 80 },
      { id: "zsa/moonlander", name: "Moonlander", firmware: "qmk", key_count: 72 },
    ]));
    const ids = (list.boards as Array<{ id: string }>).map((b) => b.id);
    expect(ids).toEqual([...ids].sort());
    const show = await cli(["boards", "show", "zsa/moonlander", "--format", "table"]);
    expect(show.out).toContain("reva: build qmk-docker, flash zapp, USB PID 0x1969");
    expect(show.out).toContain("revb: build qmk-docker, flash zapp, USB PID 0x1972");
    expect(show.out).toContain("key positions:");
    const j = json(await cli(["boards", "show", "zsa/moonlander"]));
    expect(j.geometry.keys).toHaveLength(72);
  });

  test("check passes on the Moonlander and exits 4 on a broken board", async () => {
    const ok = await cli(["boards", "check", MOONLANDER_DIR, "--offline", "--format", "table"]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("ok");
    const root = tempDir();
    const dir = join(root, "zsa", "moonlander");
    await Bun.$`mkdir -p ${dir} && cp ${MOONLANDER_DIR}/* ${dir}/`.quiet();
    const board = await Bun.file(join(dir, "board.json")).json();
    board.keyCount = 71;
    await Bun.write(join(dir, "board.json"), JSON.stringify(board));
    const bad = await cli(["boards", "check", dir, "--offline", "--format", "table"]);
    expect(bad.code).toBe(4);
    expect(bad.out).toContain("keyCount is 71");
    expect(bad.out).toContain("failed");
  });
});

describe("doctor", () => {
  test("a missing database is fine and is not created; a real one passes every check", async () => {
    const dir = tempDir();
    const fresh = await cli(["doctor", "--data-dir", join(dir, "new"), "--format", "table"]);
    // The toolchain checks depend on this machine (Docker running); the database ones don't.
    expect(fresh.out).toContain("ok    database: ");
    expect(fresh.out).toContain("does not exist yet");
    expect(await Bun.file(join(dir, "new", "keyloom.db")).exists()).toBe(false);
    await cli(["import", "--board", "zsa/moonlander", FIXTURE_DIR, "--data-dir", dir]);
    const r = json(await cli(["doctor", "--data-dir", dir]));
    const names = ["data directory", "database integrity", "journal mode", "migrations", "layouts"];
    const database = r.checks.filter((c: { name: string }) => names.includes(c.name));
    expect(database.map((c: { name: string }) => c.name)).toEqual(names);
    expect(database.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(database.at(-1).detail).toBe("1");
    // Docker, zapp and the checkout follow the database checks.
    expect(r.checks.map((c: { name: string }) => c.name)).toContain("docker");
    expect(r.checks.map((c: { name: string }) => c.name)).toContain("zapp");
  }, SLOW_RUNNER_MS);

  test("a database from a newer keyloom fails the migration check with exit 1", async () => {
    const dir = tempDir();
    await cli(["layout", "list", "--data-dir", dir]); // creates it
    const { Database } = await import("bun:sqlite");
    const db = new Database(join(dir, "keyloom.db"));
    db.run("DELETE FROM schema_migrations");
    db.close();
    const r = await cli(["doctor", "--data-dir", dir, "--format", "table"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL  migrations");
  }, SLOW_RUNNER_MS);
});
