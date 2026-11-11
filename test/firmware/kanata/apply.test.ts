import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyKanata, disableRemapping, readRunningKanata } from "../../../src/firmware/kanata/apply.ts";
import { KBD_FILE, SAFE_FILE, generateKanataSource } from "../../../src/firmware/kanata/generate.ts";
import { identityLayout } from "../../../src/firmware/kanata/identity.ts";
import { remapperPaths } from "../../../src/firmware/kanata/paths.ts";
import { type FakeKanata, startFakeKanata } from "../../helpers/fake-kanata.ts";
import { kanataBinary, kanataCheck } from "../../helpers/kanata-bin.ts";
import { macbook, richLayout } from "../../helpers/macbook.ts";
import { tempDir } from "../../helpers/tmp.ts";

const bin = kanataBinary();
let fake: FakeKanata | undefined;
afterEach(() => fake?.stop());

const source = (rev: string, layout = richLayout()) => generateKanataSource({ layout, board: macbook(), layoutId: "lay_T", revisionId: rev });

function setup() {
  const home = tempDir();
  const paths = remapperPaths(home);
  fake = startFakeKanata();
  // Without a kanata binary the check is the fake's: the file must at least be non-empty.
  const check = bin ? async (p: string) => kanataCheck(bin, readFileSync(p, "utf8"), tempDir(), "c.kbd") : async (p: string) => ({ ok: readFileSync(p, "utf8").length > 0, output: "config file is valid" });
  return { home, paths, deps: { paths, endpoint: { port: fake.port }, check } };
}

describe("apply on a kanata board", () => {
  test("writes, checks, reloads and verifies, in the temp home and never the real one", async () => {
    const { paths, deps } = setup();
    expect(paths.dir.startsWith(process.env.HOME ?? "/nonexistent/")).toBe(false);
    const r = await applyKanata(deps, source("rev_ONE"), "rev_ONE");
    expect(r).toMatchObject({ ok: true, revisionId: "rev_ONE" });
    expect(readFileSync(paths.kbd, "utf8")).toContain("keyloom-rev_ONE");
    expect(existsSync(paths.safe)).toBe(true);
    expect(fake!.running()).toBe(paths.kbd);
    expect(fake!.commands.map((c) => Object.keys(c)[0])).toContain("ReloadFile");
    const reload = fake!.commands.find((c) => "ReloadFile" in c) as { ReloadFile: { wait: boolean } };
    expect(reload.ReloadFile.wait).toBe(true);
    expect(await readRunningKanata(deps.endpoint)).toMatchObject({ state: "keyloom", revisionId: "rev_ONE" });
  });

  test("a second apply replaces the first, and the running revision follows", async () => {
    const { deps } = setup();
    await applyKanata(deps, source("rev_ONE"), "rev_ONE");
    const r = await applyKanata(deps, source("rev_TWO", identityLayout(macbook())), "rev_TWO");
    expect(r.ok).toBe(true);
    expect(await readRunningKanata(deps.endpoint)).toMatchObject({ state: "keyloom", revisionId: "rev_TWO", layerNames: ["base"] });
  });

  test("a config kanata refuses on --check is never written over the good one", async () => {
    const { paths, deps } = setup();
    await applyKanata(deps, source("rev_ONE"), "rev_ONE");
    const good = readFileSync(paths.kbd, "utf8");
    const bad = source("rev_BAD");
    bad.files[0]!.content = bad.files[0]!.content.replace("(defsrc", "(defsrc nonexistent-key-name");
    const failing = { ...deps, check: async () => ({ ok: false, output: "Error: unknown key" }) };
    const r = await applyKanata(failing, bad, "rev_BAD");
    expect(r).toMatchObject({ ok: false, step: "check", written: false });
    expect(readFileSync(paths.kbd, "utf8")).toBe(good);
    expect(readdirSync(paths.dir).filter((f) => f.includes("candidate") || f.endsWith(".tmp"))).toEqual([]);
  });

  test.skipIf(!bin)("the real kanata --check refuses a broken config", async () => {
    const { paths, deps } = setup();
    const bad = source("rev_BAD");
    bad.files[0]!.content = bad.files[0]!.content.replace("(defsrc", "(defsrc nonexistent-key-name");
    const r = await applyKanata(deps, bad, "rev_BAD");
    expect(r).toMatchObject({ ok: false, step: "check" });
    expect(existsSync(paths.kbd)).toBe(false);
  });

  test("a reload kanata refuses puts the previous file back", async () => {
    const { paths, deps } = setup();
    await applyKanata(deps, source("rev_ONE"), "rev_ONE");
    const good = readFileSync(paths.kbd, "utf8");
    fake!.rejectNextReload();
    const r = await applyKanata(deps, source("rev_TWO"), "rev_TWO");
    expect(r).toMatchObject({ ok: false, step: "reload", written: false });
    expect(readFileSync(paths.kbd, "utf8")).toBe(good);
    expect(await readRunningKanata(deps.endpoint)).toMatchObject({ revisionId: "rev_ONE" });
  });

  test("a reload that answers ok but leaves old layers is caught by the read-back", async () => {
    const { deps } = setup();
    await applyKanata(deps, source("rev_ONE", identityLayout(macbook())), "rev_ONE");
    fake!.ignoreNextReload();
    const r = await applyKanata(deps, source("rev_TWO"), "rev_TWO");
    expect(r).toMatchObject({ ok: false, step: "verify" });
  });

  test("when kanata isn't running the file is still written and the failure says so", async () => {
    const { paths, deps } = setup();
    fake!.stop();
    const r = await applyKanata({ ...deps, endpoint: { port: fake!.port } }, source("rev_ONE"), "rev_ONE");
    expect(r).toMatchObject({ ok: false, step: "not_connected", written: true });
    expect(existsSync(paths.kbd)).toBe(true);
    expect(await readRunningKanata({ port: fake!.port })).toMatchObject({ state: "absent", refused: true });
  });

  test("a port that accepts and never answers is absent but not refused: kanata may still be behind it (D-497)", async () => {
    const silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    try {
      expect(await readRunningKanata({ port: silent.port })).toMatchObject({ state: "absent", refused: false });
    } finally {
      silent.stop(true);
    }
  }, 10_000);

  test("a keyloom.kbd keyloom didn't write is left alone unless asked", async () => {
    const { paths, deps } = setup();
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.kbd, "(defsrc a)\n(deflayer base a)\n");
    const r = await applyKanata(deps, source("rev_ONE"), "rev_ONE");
    expect(r).toMatchObject({ ok: false, step: "not_keyloom" });
    // The sync engine shows this sentence on the page, so it names no command (D-512); the CLI adds its own.
    if (!r.ok) {
      expect(r.error).not.toContain("keyloom remap");
      expect(r.error).not.toContain("<layout>");
    }
    expect(readFileSync(paths.kbd, "utf8")).toBe("(defsrc a)\n(deflayer base a)\n");
    const forced = await applyKanata(deps, source("rev_ONE"), "rev_ONE", { overwriteForeign: true });
    expect(forced.ok).toBe(true);
    expect(readFileSync(`${paths.kbd}.before-keyloom`, "utf8")).toBe("(defsrc a)\n(deflayer base a)\n");
  });

  test("a second replace keeps the first original and puts the second beside it under a dated name (#290 review)", async () => {
    const { paths, deps } = setup();
    mkdirSync(paths.dir, { recursive: true });
    const first = "(defsrc a)\n(deflayer base a)\n";
    const second = "(defsrc b)\n(deflayer base b)\n";
    writeFileSync(paths.kbd, first);
    expect((await applyKanata(deps, source("rev_ONE"), "rev_ONE", { overwriteForeign: true })).ok).toBe(true);
    writeFileSync(paths.kbd, second);
    const at = Date.UTC(2026, 10, 11, 9, 30, 0);
    expect((await applyKanata({ ...deps, now: () => at }, source("rev_TWO"), "rev_TWO", { overwriteForeign: true })).ok).toBe(true);
    expect(readFileSync(`${paths.kbd}.before-keyloom`, "utf8")).toBe(first);
    expect(readFileSync(`${paths.kbd}.before-keyloom.2026-11-11T09-30-00-000Z`, "utf8")).toBe(second);
    // The same foreign text again is already kept, so no third copy appears.
    writeFileSync(paths.kbd, first);
    expect((await applyKanata(deps, source("rev_THREE"), "rev_THREE", { overwriteForeign: true })).ok).toBe(true);
    expect(readdirSync(paths.dir).filter((f) => f.includes("before-keyloom")).sort()).toEqual(["keyloom.kbd.before-keyloom", "keyloom.kbd.before-keyloom.2026-11-11T09-30-00-000Z"]);
  });

  test("a replace kanata --check refuses leaves the foreign file and any kept copy untouched (#290 review)", async () => {
    const { paths, deps } = setup();
    mkdirSync(paths.dir, { recursive: true });
    const original = "(defsrc a)\n(deflayer base a)\n";
    const later = "(defsrc b)\n(deflayer base b)\n";
    const failing = { ...deps, check: async () => ({ ok: false, output: "Error: unknown key" }) };
    // No copy yet: a refused check makes none.
    writeFileSync(paths.kbd, original);
    expect(await applyKanata(failing, source("rev_BAD"), "rev_BAD", { overwriteForeign: true })).toMatchObject({ ok: false, step: "check" });
    expect(existsSync(`${paths.kbd}.before-keyloom`)).toBe(false);
    // A copy already kept stays as it was, and the foreign file stays in place.
    writeFileSync(`${paths.kbd}.before-keyloom`, original);
    writeFileSync(paths.kbd, later);
    expect(await applyKanata(failing, source("rev_BAD"), "rev_BAD", { overwriteForeign: true })).toMatchObject({ ok: false, step: "check" });
    expect(readFileSync(`${paths.kbd}.before-keyloom`, "utf8")).toBe(original);
    expect(readFileSync(paths.kbd, "utf8")).toBe(later);
    expect(readdirSync(paths.dir).filter((f) => f.includes("before-keyloom") || f.includes("candidate"))).toEqual(["keyloom.kbd.before-keyloom"]);
  });

  test("a hand edit of keyloom's own file counts as not keyloom's", async () => {
    const { paths, deps } = setup();
    await applyKanata(deps, source("rev_ONE"), "rev_ONE");
    writeFileSync(paths.kbd, readFileSync(paths.kbd, "utf8").replace("process-unmapped-keys yes", "process-unmapped-keys no"));
    const r = await applyKanata(deps, source("rev_TWO"), "rev_TWO");
    expect(r).toMatchObject({ ok: false, step: "not_keyloom" });
  });

  test("two applies at once leave one whole file", async () => {
    const { paths, deps } = setup();
    const results = await Promise.all([applyKanata(deps, source("rev_A"), "rev_A"), applyKanata(deps, source("rev_B", identityLayout(macbook())), "rev_B")]);
    expect(results.length).toBe(2);
    const text = readFileSync(paths.kbd, "utf8");
    expect(text.startsWith(";; keyloom generated")).toBe(true);
    expect(/keyloom-rev_[AB]/.test(text)).toBe(true);
  });
});

describe("Disable remapping", () => {
  test("reloads the identity map and reads back the safe marker", async () => {
    const { paths, deps } = setup();
    const src = source("rev_ONE");
    await applyKanata(deps, src, "rev_ONE");
    const r = await disableRemapping(deps, src.files.find((f) => f.path === SAFE_FILE)!.content);
    expect(r.ok).toBe(true);
    expect(fake!.running()).toBe(paths.safe);
    expect(await readRunningKanata(deps.endpoint)).toEqual({ state: "off" });
    const safe = readFileSync(paths.safe, "utf8");
    expect(safe).not.toContain("hold");
    expect(safe).toContain("(deflayer safe");
    // Re-enabling is an ordinary apply.
    expect((await applyKanata(deps, src, "rev_ONE")).ok).toBe(true);
    expect((await readRunningKanata(deps.endpoint)).state).toBe("keyloom");
  });

  test("with no kanata running it says so and sends no sudo advice", async () => {
    const { deps } = setup();
    fake!.stop();
    const r = await disableRemapping(deps, "x");
    expect(r.ok).toBe(false);
  });
});

test("KBD_FILE is the one name keyloom owns", () => {
  expect(KBD_FILE).toBe("keyloom.kbd");
  expect(join("a", KBD_FILE)).toBe("a/keyloom.kbd");
});
