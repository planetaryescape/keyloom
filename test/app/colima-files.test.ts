// Fix Colima's files (D-533): the checks before the password dialog, the root script, how its answer is read, and the use case around it.
// No test asks for a password or touches a real Colima: the osascript runner and the engine start are fakes, and the root script runs
// only as this account, against a temporary folder, with a stand-in colima that records its arguments.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ColimaFilesPlan, type PlanDeps, adminRunner, colimaFilesPlan, colimaFilesScript, colimaFixFailure, runColimaRootSteps } from "../../src/app/colima-files.ts";
import { dockerAccessFix, dockerReadiness, ensureDocker, fixColimaFiles, restartDocker } from "../../src/app/toolchain.ts";
import type { DockerStatus } from "../../src/firmware/toolchain/docker.ts";
import { buildBlockedReason, dockerView } from "../../src/web/release/release-words.ts";

const colima = { name: "Colima", command: ["colima", "restart", "--profile", "work"] };
const deps = (over: Partial<PlanDeps> = {}): PlanDeps => ({
  which: (command) => (command === "colima" ? "/opt/homebrew/bin/colima" : command === "limactl" ? "/opt/homebrew/bin/limactl" : null),
  home: "/Users/someone", uid: 501, kind: () => "dir", ...over,
});

describe("the checks before the password dialog", () => {
  test("a Colima with a usual home gets a plan: its profile, colima's own path, and ~/.colima", () => {
    expect(colimaFilesPlan(colima, deps())).toEqual({
      ok: true,
      plan: { colima: "/opt/homebrew/bin/colima", pathDirs: ["/opt/homebrew/bin"], home: "/Users/someone", colimaHome: "/Users/someone/.colima", uid: 501, profile: "work" },
    });
    const elsewhere = colimaFilesPlan({ name: "Colima", command: ["colima", "start"] }, deps({ which: (c) => (c === "colima" ? "/nix/bin/colima" : c === "limactl" ? "/opt/lima/bin/limactl" : null) }));
    expect(elsewhere).toMatchObject({ ok: true, plan: { pathDirs: ["/nix/bin", "/opt/lima/bin"], profile: null } });
  });

  test("anything keyloom can't vouch for stops before the dialog, with the reason", () => {
    expect(colimaFilesPlan({ name: "OrbStack", command: ["open", "-a", "OrbStack"] }, deps())).toMatchObject({ ok: false });
    expect(colimaFilesPlan({ name: "Colima", command: ["colima", "start", "--profile", "x; rm -rf /"] }, deps())).toMatchObject({ ok: false, reason: expect.stringContaining("profile") });
    expect(colimaFilesPlan(colima, deps({ which: () => null }))).toMatchObject({ ok: false, reason: expect.stringContaining("colima command") });
    expect(colimaFilesPlan(colima, deps({ which: () => "colima" }))).toMatchObject({ ok: false });
    expect(colimaFilesPlan(colima, deps({ uid: 0 }))).toMatchObject({ ok: false });
    expect(colimaFilesPlan(colima, deps({ home: "/" }))).toMatchObject({ ok: false });
    expect(colimaFilesPlan(colima, deps({ kind: () => "symlink" }))).toMatchObject({ ok: false, reason: expect.stringContaining("link") });
    expect(colimaFilesPlan(colima, deps({ kind: () => "missing" }))).toMatchObject({ ok: false, reason: expect.stringContaining("~/.colima") });
  });

  test("the script refuses values that skipped the checks", () => {
    const plan: ColimaFilesPlan = { colima: "/c", pathDirs: [], home: "/h", colimaHome: "/h/.colima", uid: 501, profile: null };
    expect(() => colimaFilesScript({ ...plan, uid: 0 })).toThrow();
    expect(() => colimaFilesScript({ ...plan, profile: "$(id)" })).toThrow();
  });
});

describe("how the dialog's answer is read", () => {
  const plan: ColimaFilesPlan = { colima: "/opt/homebrew/bin/colima", pathDirs: ["/opt/homebrew/bin"], home: "/Users/someone", colimaHome: "/Users/someone/.colima", uid: 501, profile: null };

  test("the password dialog is osascript's, with a prompt that says what it does, and success is success", async () => {
    const calls: string[][] = [];
    expect(await runColimaRootSteps(plan, async (cmd) => (calls.push([...cmd]), { code: 0, out: "" }))).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("osascript");
    expect(calls[0]?.[2]).toContain("with administrator privileges");
    expect(calls[0]?.[2]).toContain("give Colima's files in your home folder back to you");
  });

  test("a closed dialog is `cancelled`, the script's own stop is its code, and anything else says what macOS printed", async () => {
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: "0:250: execution error: User canceled. (-128)" }))).toEqual({ ok: false, code: "cancelled", reason: "You cancelled the password dialog, so Colima's files didn't change." });
    const linked = "keyloom: the other copy of Colima didn't stop cleanly\n0:900: execution error: keyloom colima fix stopped (colima_linked_file): A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: /Users/someone/.colima/x (1)";
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: linked }))).toEqual({ ok: false, code: "colima_linked_file", reason: "A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: /Users/someone/.colima/x" });
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: "something odd\n" }))).toEqual({ ok: false, code: "failed", reason: "macOS couldn't fix Colima's files: something odd" });
    expect(colimaFixFailure("keyloom colima fix stopped (not_a_code): x")).toBeNull();
  });

  test("the real runner refuses under bun test, so a forgotten fake never opens a password dialog", async () => {
    await expect(adminRunner(["osascript", "-e", "beep"])).rejects.toThrow("refusing");
  });
});

// The script uses macOS's own find and chown, so it runs only there. It runs as this account, so nothing it does can need root.
describe.skipIf(process.platform !== "darwin")("the root script, run as this account against a temporary folder", () => {
  // The real path: the script checks that it is in ~/.colima's real folder, and macOS's temporary folder sits behind a link.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kl-colima-")));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const uid = process.getuid?.() ?? 0;

  /** A home folder, whose name a shell would misread unquoted, with a ~/.colima and a colima that records how it was called. */
  function setup(name: string) {
    const home = join(root, name, "it's $(touch pwned) home");
    const dir = join(home, ".colima");
    mkdirSync(join(dir, "work"), { recursive: true });
    writeFileSync(join(dir, "work", "colima.yaml"), "cpu: 2\n");
    const bin = join(root, name, "bin");
    mkdirSync(bin);
    const log = join(root, name, "colima.log");
    writeFileSync(join(bin, "colima"), `#!/bin/sh\nprintf '%s|%s\\n' "$HOME" "$*" >> '${log}'\n`);
    chmodSync(join(bin, "colima"), 0o755);
    const plan: ColimaFilesPlan = { colima: join(bin, "colima"), pathDirs: [bin], home, colimaHome: dir, uid, profile: "work" };
    const run = async (p: ColimaFilesPlan = plan, tools?: { chown: string }) => {
      const proc = Bun.spawn(["/bin/sh", "-c", colimaFilesScript(p, tools)], { cwd: join(root, name), stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      return { code: await proc.exited, out: `${out}${err}` };
    };
    const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
    return { home, dir, bin, plan, run, calls };
  }

  test("it stops Colima with the person's HOME and profile, and files already theirs need nothing", async () => {
    const s = setup("ok");
    const r = await s.run();
    expect(r).toMatchObject({ code: 0 });
    expect(s.calls()).toBe(`${s.home}|stop --profile work\n`);
    expect(existsSync(join(root, "ok", "pwned"))).toBe(false);
  });

  test("a ~/.colima that is a link is refused before Colima is stopped", async () => {
    const s = setup("link");
    const real = join(root, "link", "elsewhere");
    mkdirSync(real);
    rmSync(s.dir, { recursive: true });
    symlinkSync(real, s.dir);
    const r = await s.run();
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out)?.code).toBe("colima_dir_missing");
    expect(s.calls()).toBe("");
  });

  test("a file with a second name elsewhere stops it before any file changes owner", async () => {
    const s = setup("linked");
    linkSync(join(s.dir, "work", "colima.yaml"), join(root, "linked", "outside"));
    // Another account's uid makes every file here one to give back, which is the case the link check guards.
    const r = await s.run({ ...s.plan, uid: uid + 1 });
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out)).toMatchObject({ code: "colima_linked_file", reason: expect.stringContaining("colima.yaml") });
  });

  test("~/.colima itself is changed from inside it, never a .colima wherever the script started (#300 review)", async () => {
    const s = setup("start");
    // A decoy where osascript might start: BSD find runs -execdir for its starting point from find's own folder.
    mkdirSync(join(root, "start", ".colima"));
    const log = join(root, "start", "chown.log");
    const chown = join(s.bin, "chown");
    writeFileSync(chown, `#!/bin/sh\nfor f in "$@"; do printf '%s %s\\n' "$(/bin/pwd -P)" "$f"; done >> '${log}'\n`);
    chmodSync(chown, 0o755);
    // Another account's uid makes every file one to give back; the stand-in chown only records where it ran.
    expect(await s.run({ ...s.plan, uid: uid + 1 }, { chown })).toMatchObject({ code: 0 });
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines).toContain(`${s.dir} .`);
    expect(lines).toContain(`${join(s.dir, "work")} colima.yaml`);
    expect(lines).toContain(`${s.dir} work`);
    expect(lines.some((line) => line.startsWith(`${join(root, "start")} `))).toBe(false);
  });

  test("a ~/.colima reached through a link is refused before anything changes owner", async () => {
    const s = setup("via-link");
    symlinkSync(s.home, join(root, "via-link", "home-link"));
    const r = await s.run({ ...s.plan, colimaHome: join(root, "via-link", "home-link", ".colima"), uid: uid + 1 });
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out)?.code).toBe("colima_dir_missing");
  });

  test("a change macOS refuses is reported with its code", async () => {
    const s = setup("refused");
    const r = await s.run({ ...s.plan, uid: uid + 1 });
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out)?.code).toBe("colima_chown_failed");
  });
});

describe("Fix Colima's files, the use case", () => {
  const refused = async (): Promise<DockerStatus> => ({ ok: false, kind: "no-access", reason: "Docker is running, but keyloom isn't allowed to open its socket." });
  const found = async () => ({ kind: "engine" as const, engine: colima });
  const plan: ColimaFilesPlan = { colima: "/opt/homebrew/bin/colima", pathDirs: ["/opt/homebrew/bin"], home: "/Users/someone", colimaHome: "/Users/someone/.colima", uid: 501, profile: "work" };
  const free = () => null;

  test("running work or no way to check for it stops it inside the lock, before the password dialog (D-529)", async () => {
    let asked = 0;
    const overrides = { status: refused, detect: found, platform: "darwin" as const, colimaPlan: () => ({ ok: true as const, plan }), adminRun: async () => (asked++, { code: 0, out: "" }) };
    expect(await fixColimaFiles({ blocker: () => "A build is running.", overrides })).toEqual({ ok: false, engine: null, reason: "A build is running.", code: "build_running" });
    expect(await fixColimaFiles({ overrides })).toMatchObject({ ok: false, code: "build_running", reason: expect.stringContaining("can't tell") });
    expect(asked).toBe(0);
  });

  test("it asks for the password, then starts Colima as the person for the same profile and waits for Docker", async () => {
    const admin: string[][] = [];
    const starts: Array<{ relaunch?: boolean; command: string[] }> = [];
    const result = await fixColimaFiles({
      blocker: free,
      overrides: {
        status: refused, detect: found, platform: "darwin", colimaPlan: () => ({ ok: true, plan }),
        adminRun: async (cmd) => (admin.push([...cmd]), { code: 0, out: "" }),
        startEngine: async (opts) => {
          const engine = await opts?.detect?.();
          starts.push({ ...(opts?.relaunch === undefined ? {} : { relaunch: opts.relaunch }), command: engine?.kind === "engine" ? engine.engine.command : [] });
          return { ok: true, version: "29", engine: "Colima", waitedMs: 9 };
        },
      },
    });
    expect(result).toEqual({ ok: true, version: "29", engine: "Colima", waitedMs: 9 });
    expect(admin).toHaveLength(1);
    expect(starts).toEqual([{ relaunch: true, command: ["colima", "start", "--profile", "work"] }]);
  });

  test("a linked file comes back with its own code, so the page can leave out the command that would change it", async () => {
    const out = "execution error: keyloom colima fix stopped (colima_linked_file): A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: /x (1)";
    const result = await fixColimaFiles({ blocker: free, overrides: { status: refused, detect: found, platform: "darwin", colimaPlan: () => ({ ok: true, plan }), adminRun: async () => ({ code: 1, out }) } });
    expect(result).toMatchObject({ ok: false, code: "linked_file", reason: expect.stringContaining(": /x") });
  });

  test("a closed dialog changes nothing and starts nothing; a start that fails after the fix says the files are fixed", async () => {
    let started = 0;
    const startEngine = async () => (started++, { ok: false as const, engine: "Colima", reason: "keyloom couldn't start Colima: exit status 1" });
    const base = { status: refused, detect: found, platform: "darwin" as const, colimaPlan: () => ({ ok: true as const, plan }), startEngine };
    expect(await fixColimaFiles({ blocker: free, overrides: { ...base, adminRun: async () => ({ code: 1, out: "execution error: User canceled. (-128)" }) } })).toMatchObject({ ok: false, code: "cancelled" });
    expect(started).toBe(0);
    const after = await fixColimaFiles({ blocker: free, overrides: { ...base, adminRun: async () => ({ code: 0, out: "" }) } });
    expect(after).toMatchObject({ ok: false, engine: "Colima", reason: "Colima's files are yours again, but Colima didn't come up. keyloom couldn't start Colima: exit status 1." });
    expect(started).toBe(1);
  });

  test("no dialog opens unless Docker still refuses a Colima on a Mac that keyloom can plan for", async () => {
    let asked = 0;
    const adminRun = async () => (asked++, { code: 0, out: "" });
    const base = { detect: found, platform: "darwin" as const, colimaPlan: () => ({ ok: true as const, plan }), adminRun };
    expect(await fixColimaFiles({ blocker: free, overrides: { ...base, status: async () => ({ ok: true, version: "29" }) } })).toMatchObject({ ok: true });
    expect(await fixColimaFiles({ blocker: free, overrides: { ...base, status: async () => ({ ok: false, kind: "daemon-down", reason: "down" }) } })).toMatchObject({ ok: false, reason: expect.stringContaining("doesn't refuse") });
    expect(await fixColimaFiles({ blocker: free, overrides: { ...base, status: refused, platform: "linux" } })).toMatchObject({ ok: false });
    expect(await fixColimaFiles({ blocker: free, overrides: { ...base, status: refused, detect: async () => ({ kind: "engine", engine: { name: "OrbStack", command: ["open", "-a", "OrbStack"] } }) } })).toMatchObject({ ok: false });
    expect(await fixColimaFiles({ blocker: free, overrides: { ...base, status: refused, colimaPlan: () => ({ ok: false, reason: "~/.colima is a link" }) } })).toEqual({ ok: false, engine: "Colima", reason: "~/.colima is a link" });
    expect(asked).toBe(0);
  });

  test("it is refused while keyloom restarts Docker, and holds the engine while it runs", async () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    const running = fixColimaFiles({ blocker: free, overrides: { status: refused, detect: found, platform: "darwin", colimaPlan: () => ({ ok: true, plan }), adminRun: async () => (await opened, { code: 1, out: "(-128)" }) } });
    await Bun.sleep(1);
    expect(await fixColimaFiles({ blocker: free, overrides: { status: refused } })).toMatchObject({ ok: false, code: "engine_busy", reason: expect.stringContaining("already fixing Colima's files") });
    // Another page follows the fix in its own words while the password dialog is open.
    expect(await dockerReadiness({ status: refused, detect: found, env: {}, platform: "darwin" })).toMatchObject({ engineAction: "fix-files" });
    expect(await restartDocker({ overrides: { status: refused } })).toMatchObject({ ok: false, code: "engine_busy" });
    // A build waits for the fix, so it can't start a container between the fix's check for running work and its stop.
    let buildAsked = false;
    const build = ensureDocker({ overrides: { status: async () => ((buildAsked = true), { ok: true, version: "29" }), env: {} } });
    await Bun.sleep(5);
    expect(buildAsked).toBe(false);
    open();
    expect(await running).toMatchObject({ code: "cancelled" });
    expect(await build).toMatchObject({ ok: true });
  });

  test("readiness offers the button for a Colima on a Mac only", async () => {
    expect(dockerAccessFix("darwin", colima).fixFiles).toBe(true);
    expect(dockerAccessFix("linux", colima).fixFiles).toBe(false);
    expect(dockerAccessFix("darwin", { name: "OrbStack", command: ["open", "-a", "OrbStack"] }).fixFiles).toBe(false);
    expect(await dockerReadiness({ status: refused, detect: found, env: {}, platform: "darwin" })).toMatchObject({ access: { fixFiles: true } });
  });
});

describe("what the page shows (D-533)", () => {
  const access = { command: 'sudo env HOME="$HOME" colima stop; sudo chown -R "$USER" ~/.colima && colima start', note: "Colima's files belong to another account.", restartApp: null, fixFiles: true };
  const refused = { ok: false as const, problem: "no-access" as const, reason: "refused", engine: "Colima", canStart: false, autoStart: true, install: null, access };

  test("a refusing Colima on a Mac offers Fix Colima's files, with the command kept to copy", () => {
    const view = dockerView(refused, false, null, null);
    expect(view).toEqual({ kind: "no-access", command: access.command, note: access.note, restartApp: null, fix: { offered: true, note: null } });
    expect(buildBlockedReason(view)).toBe("Fix Colima's files first.");
    // An older server, without `fixFiles`, keeps the command alone.
    expect(dockerView({ ...refused, access: { command: access.command, note: access.note, restartApp: null } }, false, null, null)).toMatchObject({ fix: null });
  });

  test("while it runs the page says so; a closed dialog or a running build keeps the button, any other failure takes it away", () => {
    expect(dockerView(refused, true, null, null, "fix-files")).toEqual({ kind: "fixing-files" });
    expect(dockerView({ ...refused, engineAction: "fix-files" }, false, null, null)).toEqual({ kind: "fixing-files" });
    expect(buildBlockedReason({ kind: "fixing-files" })).toBe("Waiting for keyloom to fix Colima's files.");
    expect(dockerView(refused, false, "You cancelled the password dialog.", null, "fix-files", "cancelled")).toMatchObject({ kind: "no-access", fix: { offered: true, note: "You closed the password dialog, so nothing changed." } });
    expect(dockerView(refused, false, "A build or flash is running.", null, "fix-files", "build_running")).toMatchObject({ fix: { offered: true, note: expect.stringContaining("once it has finished") } });
    const failed = dockerView(refused, false, "A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: `x`", null, "fix-files");
    expect(failed).toMatchObject({ kind: "no-access", command: access.command, fix: { offered: false, note: "A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: x" } });
    expect(buildBlockedReason(failed)).toBe("Give keyloom access to Docker first.");
    // A linked file keeps the button, which checks again, and drops the command, whose chown -R would change that file.
    expect(dockerView(refused, false, "A file is also linked from somewhere else: /x", null, "fix-files", "linked_file")).toMatchObject({ kind: "no-access", command: null, fix: { offered: true, note: expect.stringContaining("check what it is") } });
  });

  test("once Docker needs something else, that readiness decides: a Colima that didn't come up gets Restart Colima", () => {
    const down = { ok: false as const, problem: "daemon-down" as const, reason: "down", engine: "Colima", canStart: true, autoStart: true, install: null, access: null, restartEngine: "Colima" };
    expect(dockerView(down, false, "Colima's files are yours again, but Colima didn't come up.", null, "fix-files")).toMatchObject({ kind: "start-failed", restartEngine: "Colima", retry: null });
    expect(dockerView({ ok: true, version: "29", engine: "Docker", autoStart: true }, false, "old failure", null, "fix-files")).toEqual({ kind: "none" });
  });
});
