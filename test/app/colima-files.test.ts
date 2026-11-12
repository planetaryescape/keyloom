// Fix Colima's files (D-533): the checks before the password dialog, the root script, how its answer is read, and the use case around it.
// No test asks for a password or touches a real Colima: the osascript runner, the stop and the engine start are fakes, and the root script
// runs only as this account, against a temporary folder, with a stand-in chown that records what it would change.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ColimaFilesPlan, type PlanDeps, adminRunner, colimaFilesPlan, colimaFilesScript, colimaFixFailure, parseAccountHome, runColimaRootSteps } from "../../src/app/colima-files.ts";
import { dockerAccessFix, dockerReadiness, ensureDocker, fixColimaFiles, restartDocker } from "../../src/app/toolchain.ts";
import type { DockerStatus } from "../../src/firmware/toolchain/docker.ts";
import { buildBlockedReason, dockerView } from "../../src/web/release/release-words.ts";

const colima = { name: "Colima", command: ["colima", "restart", "--profile", "work"] };
const deps = (over: Partial<PlanDeps> = {}): PlanDeps => ({ home: "/Users/someone", accountHome: "/Users/someone", uid: 501, kind: () => "dir", ...over });

describe("the checks before the password dialog", () => {
  test("a Colima with a usual home gets a plan: its profile and the account's ~/.colima", () => {
    expect(colimaFilesPlan(colima, deps())).toEqual({ ok: true, plan: { colimaHome: "/Users/someone/.colima", uid: 501, profile: "work" } });
    expect(colimaFilesPlan({ name: "Colima", command: ["colima", "start"] }, deps())).toMatchObject({ ok: true, plan: { profile: null } });
  });

  test("the home folder comes from the account record, and a $HOME that points elsewhere changes nothing (#300 review)", () => {
    expect(parseAccountHome("someone:********:501:20::0:0:Some One:/Users/someone:/bin/zsh\n", 501)).toBe("/Users/someone");
    // A full name with a colon in it can't shift the home field, and another account's line is not this one's.
    expect(parseAccountHome("someone:********:501:20::0:0:Some: One:/Users/someone:/bin/zsh", 501)).toBe("/Users/someone");
    expect(parseAccountHome("other:********:502:20::0:0:Other:/Users/other:/bin/zsh", 501)).toBeNull();
    expect(parseAccountHome("garbage", 501)).toBeNull();
    expect(colimaFilesPlan(colima, deps({ home: "/Users/Shared" }))).toMatchObject({ ok: false, reason: expect.stringContaining("/Users/Shared, not your own, /Users/someone") });
    expect(colimaFilesPlan(colima, deps({ accountHome: null }))).toMatchObject({ ok: false, reason: expect.stringContaining("home folder") });
  });

  test("anything keyloom can't vouch for stops before the dialog, with the reason", () => {
    expect(colimaFilesPlan({ name: "OrbStack", command: ["open", "-a", "OrbStack"] }, deps())).toMatchObject({ ok: false });
    expect(colimaFilesPlan({ name: "Colima", command: ["colima", "start", "--profile", "x; rm -rf /"] }, deps())).toMatchObject({ ok: false, reason: expect.stringContaining("profile") });
    expect(colimaFilesPlan(colima, deps({ uid: 0 }))).toMatchObject({ ok: false });
    expect(colimaFilesPlan(colima, deps({ home: "/", accountHome: "/" }))).toMatchObject({ ok: false });
    expect(colimaFilesPlan(colima, deps({ kind: () => "symlink" }))).toMatchObject({ ok: false, reason: expect.stringContaining("link") });
    expect(colimaFilesPlan(colima, deps({ kind: () => "missing" }))).toMatchObject({ ok: false, reason: expect.stringContaining("~/.colima") });
  });

  test("the script refuses values that skipped the checks", () => {
    const plan: ColimaFilesPlan = { colimaHome: "/h/.colima", uid: 501, profile: null };
    expect(() => colimaFilesScript({ ...plan, uid: 0 })).toThrow();
    expect(() => colimaFilesScript({ ...plan, profile: "$(id)" })).toThrow();
  });

  test("root runs only macOS's own tools, with a PATH the person can't write, and never colima (#300 review)", () => {
    const script = colimaFilesScript({ colimaHome: "/h/.colima", uid: 501, profile: "work" });
    expect(script).toContain("PATH=/usr/bin:/bin:/usr/sbin:/sbin; export PATH");
    expect(script).not.toMatch(/colima'? (stop|start)/);
    // Every command the script runs, after the shell's own words, is an absolute path in a system folder.
    const commands = [...script.matchAll(/(?:^|[;|(]\s*|\$\(|-execdir |-exec |exec )(\/[\w/.-]+)/gm)].map((m) => m[1]);
    expect(commands.length).toBeGreaterThan(10);
    for (const command of commands) expect(command).toMatch(/^\/(usr\/bin|bin|usr\/sbin)\//);
  });
});

describe("how the dialog's answer is read", () => {
  const plan: ColimaFilesPlan = { colimaHome: "/Users/someone/.colima", uid: 501, profile: null };

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
    const linked = "0:900: execution error: keyloom colima fix stopped (colima_linked_file): A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: /Users/someone/.colima/x (1)";
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: linked }))).toEqual({ ok: false, code: "colima_linked_file", reason: "A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: /Users/someone/.colima/x" });
    // A file name with -128 in it is the file's name, not a closed dialog (#300 review).
    const named = "0:900: execution error: keyloom colima fix stopped (colima_linked_file): A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: /Users/someone/.colima/default/disk-128 (1)";
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: named }))).toMatchObject({ code: "colima_linked_file", reason: expect.stringContaining("disk-128") });
    // The number, not the words: macOS words the cancel line in the person's language.
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: "0:250: execution error: Der Benutzer hat abgebrochen. (-128)\n" }))).toMatchObject({ code: "cancelled" });
    const running = "execution error: keyloom colima fix stopped (colima_vm_running): A copy of Colima started as an administrator is still running, and keyloom won't run Colima as one to stop it, so nothing changed. (1)";
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: running }))).toMatchObject({ ok: false, code: "colima_vm_running" });
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: "something odd\n" }))).toEqual({ ok: false, code: "failed", reason: "macOS couldn't fix Colima's files: something odd" });
    expect(colimaFixFailure("keyloom colima fix stopped (not_a_code): x")).toBeNull();
  });

  test("the real runner refuses under bun test, so a forgotten fake never opens a password dialog", async () => {
    await expect(adminRunner(["osascript", "-e", "beep"])).rejects.toThrow("refusing");
  });
});

// The script uses macOS's own find and chown, so it runs only there. It runs as this account, so nothing it does can need root: a stand-in
// chown records what root's would change, and "gives a folder to root" by taking its owner's write, which is what a root-owned folder
// without group or other write is to the person.
describe.skipIf(process.platform !== "darwin")("the root script, run as this account against a temporary folder", () => {
  // The real path: the script checks that it is in ~/.colima's real folder, and macOS's temporary folder sits behind a link.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kl-colima-")));
  afterAll(() => {
    // A failed run can leave a stand-in "root" folder without its owner's write.
    Bun.spawnSync(["/bin/chmod", "-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  });
  const uid = process.getuid?.() ?? 0;
  // Another account's uid makes every file here one to give back, which is the case each check guards.
  const other = uid + 1;

  /** A home folder, whose name a shell would misread unquoted, with a ~/.colima holding a profile folder, a file and a subfolder. */
  function setup(name: string, chownBody?: string) {
    const base = join(root, name);
    const home = join(base, "it's $(touch pwned) home");
    const dir = join(home, ".colima");
    mkdirSync(join(dir, "work", "sub"), { recursive: true });
    writeFileSync(join(dir, "work", "colima.yaml"), "cpu: 2\n");
    writeFileSync(join(dir, "work", "sub", "disk"), "disk\n");
    const bin = join(base, "bin");
    mkdirSync(bin);
    const log = join(base, "chown.log");
    let chown: string | undefined;
    if (chownBody !== undefined) {
      chown = join(bin, "chown");
      writeFileSync(chown, `#!/bin/sh\nLOG='${log}'\n${chownBody}\n`);
      chmodSync(chown, 0o755);
    }
    const plan: ColimaFilesPlan = { colimaHome: dir, uid: other, profile: "work" };
    const run = async (p: ColimaFilesPlan = plan, env: Record<string, string> = {}) => {
      const proc = Bun.spawn(["/bin/sh", "-c", colimaFilesScript(p, chown === undefined ? undefined : { chown })], { cwd: base, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      return { code: await proc.exited, out: `${out}${err}` };
    };
    const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "") : []);
    return { base, home, dir, bin, plan, run, calls };
  }

  // Records each call as "<folder>|<args>". `-h 0` takes the folder's owner write, as root's ownership would; giving a folder back returns
  // it; giving a file records the inode it would change.
  const RECORDING_CHOWN = `owner=$2; shift 2
for f in "$@"; do
  if [ "$owner" = 0 ]; then /bin/chmod u-w "$f"
  elif [ -d "$f" ] && [ ! -L "$f" ]; then /bin/chmod u+w "$f"
  else f="$f inode=$(/usr/bin/stat -f %i "$f")"; fi
  printf '%s|-h %s %s\\n' "$(/bin/pwd -P)" "$owner" "$f" >> "$LOG"
done`;

  test("it runs no colima and no tool from the person's PATH, and files already theirs need nothing", async () => {
    const s = setup("ok");
    // Stand-ins on the PATH the script was started with: root's script must not reach any of them.
    for (const tool of ["colima", "find", "chown", "chmod", "stat", "head", "ps"]) {
      writeFileSync(join(s.bin, tool), `#!/bin/sh\ntouch '${join(s.base, "ran-")}${tool}'\nexit 1\n`);
      chmodSync(join(s.bin, tool), 0o755);
    }
    const r = await s.run({ ...s.plan, uid }, { PATH: `${s.bin}:/usr/bin:/bin:/usr/sbin:/sbin` });
    // As this account, the files are already this account's; root's step 1 can't take a folder as this account, so the run reports it.
    expect(colimaFixFailure(r.out)?.code).toBe("colima_chown_failed");
    expect(readdirSync(s.base).filter((f) => f.startsWith("ran-"))).toEqual([]);
    expect(existsSync(join(s.base, "pwned"))).toBe(false);
  });

  test("a ~/.colima that is a link is refused before anything changes", async () => {
    const s = setup("link", RECORDING_CHOWN);
    const real = join(s.base, "elsewhere");
    mkdirSync(real);
    rmSync(s.dir, { recursive: true });
    symlinkSync(real, s.dir);
    const r = await s.run();
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out)?.code).toBe("colima_dir_missing");
    expect(s.calls()).toEqual([]);
  });

  test("a file with a second name elsewhere stops it before anything changes, and the reason names it in full (#300 review)", async () => {
    const s = setup("linked", RECORDING_CHOWN);
    linkSync(join(s.dir, "work", "colima.yaml"), join(s.base, "outside"));
    const r = await s.run();
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out)).toEqual({ code: "colima_linked_file", reason: `A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: ${join(s.dir, "work", "colima.yaml")}` });
    expect(s.calls()).toEqual([]);
  });

  test("every folder is root's before any file changes owner, and folders go back bottom up with their modes (#300 review)", async () => {
    const s = setup("order", RECORDING_CHOWN);
    chmodSync(join(s.dir, "work"), 0o775);
    expect(await s.run()).toMatchObject({ code: 0 });
    const calls = s.calls().map((line) => line.replace(/ inode=\d+$/, ""));
    const { dir } = s;
    expect(calls).toEqual([
      `${dir}|-h 0 ./.`, `${dir}|-h 0 ./work`, `${join(dir, "work")}|-h 0 ./sub`,
      `${join(dir, "work", "sub")}|-h ${other} disk`, `${join(dir, "work")}|-h ${other} colima.yaml`,
      `${join(dir, "work")}|-h ${other} ./sub`, `${dir}|-h ${other} ./work`, `${dir}|-h ${other} ./.`,
    ]);
    // Group write went while the folder was root's, so nobody but root could rename in it, and it came back after.
    expect(statSync(join(s.dir, "work")).mode & 0o777).toBe(0o775);
  });

  test("a name the person swaps for a hard link mid-run can't send a chown outside ~/.colima (#300 review)", async () => {
    const secret = join(root, "swap-secret");
    writeFileSync(secret, "root's file\n");
    const secretInode = statSync(secret).ino;
    // The person's move at the worst time: as the first file changes owner, swap that name for a hard link to a file elsewhere.
    const s = setup("swap", `if [ "$2" != 0 ] && [ ! -d "$3" ] && [ ! -e "$LOG.swapped" ]; then
  : > "$LOG.swapped"
  if /bin/mv "$3" "$3.moved" 2>/dev/null && /bin/ln '${secret}' "$3" 2>/dev/null; then echo swapped >> "$LOG.swapped"; else echo refused >> "$LOG.swapped"; fi
fi
${RECORDING_CHOWN}`);
    expect(await s.run()).toMatchObject({ code: 0 });
    expect(readFileSync(`${join(s.base, "chown.log")}.swapped`, "utf8").trim()).toBe("refused");
    const changed = s.calls().flatMap((line) => line.match(/inode=(\d+)$/)?.[1] ?? []).map(Number);
    expect(changed).toHaveLength(2);
    expect(changed).not.toContain(secretInode);
    expect(statSync(secret).nlink).toBe(1);
  });

  test("a folder root can't take stops the walk there: no file changes, and only folders it took go back", async () => {
    const s = setup("partial", `if [ "$2" = 0 ] && [ "$3" = ./work ]; then exit 1; fi\n${RECORDING_CHOWN}`);
    const r = await s.run();
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out)?.code).toBe("colima_chown_failed");
    // Not ./work's subfolder, which the person could still rename in, nor any file.
    expect(s.calls()).toEqual([`${s.dir}|-h 0 ./.`, `${s.dir}|-h ${other} ./.`]);
  });

  test("a Colima VM another account runs from this folder stops it before anything changes", async () => {
    const s = setup("vm", RECORDING_CHOWN);
    const agent = join(s.bin, "limactl");
    symlinkSync("/bin/sleep", agent);
    const vm = Bun.spawn([agent, "30"]);
    try {
      mkdirSync(join(s.dir, "_lima", "colima-work"), { recursive: true });
      writeFileSync(join(s.dir, "_lima", "colima-work", "ha.pid"), `${vm.pid}\n`);
      // The stand-in VM runs as this account, which is "another account" to a plan for `other`.
      const r = await s.run();
      expect(r.code).toBe(1);
      expect(colimaFixFailure(r.out)?.code).toBe("colima_vm_running");
      expect(s.calls()).toEqual([]);
      // The person's own VM is not another account's, and a host agent that has exited holds nothing.
      expect(colimaFixFailure((await s.run({ ...s.plan, uid })).out)?.code).not.toBe("colima_vm_running");
      vm.kill();
      await vm.exited;
      expect(await s.run()).toMatchObject({ code: 0 });
    } finally {
      vm.kill();
    }
  });

  test("a ~/.colima reached through a link is refused before anything changes owner", async () => {
    const s = setup("via-link", RECORDING_CHOWN);
    symlinkSync(s.home, join(s.base, "home-link"));
    const r = await s.run({ ...s.plan, colimaHome: join(s.base, "home-link", ".colima") });
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out)?.code).toBe("colima_dir_missing");
    expect(s.calls()).toEqual([]);
  });

  test("a change macOS refuses is reported with its code", async () => {
    const s = setup("refused");
    const r = await s.run();
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out)?.code).toBe("colima_chown_failed");
  });
});

describe("Fix Colima's files, the use case", () => {
  const refused = async (): Promise<DockerStatus> => ({ ok: false, kind: "no-access", reason: "Docker is running, but keyloom isn't allowed to open its socket." });
  const found = async () => ({ kind: "engine" as const, engine: colima });
  const plan: ColimaFilesPlan = { colimaHome: "/Users/someone/.colima", uid: 501, profile: "work" };
  const free = () => null;

  test("running work or no way to check for it stops it inside the lock, before the password dialog (D-529)", async () => {
    let asked = 0;
    const overrides = { status: refused, detect: found, platform: "darwin" as const, colimaPlan: () => ({ ok: true as const, plan }), adminRun: async () => (asked++, { code: 0, out: "" }) };
    expect(await fixColimaFiles({ blocker: () => "A build is running.", overrides })).toEqual({ ok: false, engine: null, reason: "A build is running.", code: "build_running" });
    expect(await fixColimaFiles({ overrides })).toMatchObject({ ok: false, code: "build_running", reason: expect.stringContaining("can't tell") });
    expect(asked).toBe(0);
  });

  test("it asks for the password, then stops and starts Colima as the person for the same profile and waits for Docker", async () => {
    const steps: string[] = [];
    const progress: string[] = [];
    const result = await fixColimaFiles({
      blocker: free,
      onProgress: (line) => progress.push(line),
      overrides: {
        status: refused, detect: found, platform: "darwin", colimaPlan: () => ({ ok: true, plan }),
        adminRun: async (cmd) => (steps.push(`admin ${cmd[0]}`), { code: 0, out: "" }),
        // Colima's own stop, as the person: it usually has nothing to stop, and a stop that fails still starts it.
        colimaStop: async (command) => (steps.push(command.join(" ")), { ok: false, detail: "colima is not running" }),
        startEngine: async (opts) => {
          const engine = await opts?.detect?.();
          steps.push(`${opts?.relaunch === true ? "relaunch" : "start"} ${engine?.kind === "engine" ? engine.engine.command.join(" ") : ""}`);
          return { ok: true, version: "29", engine: "Colima", waitedMs: 9 };
        },
      },
    });
    expect(result).toEqual({ ok: true, version: "29", engine: "Colima", waitedMs: 9 });
    expect(steps).toEqual(["admin osascript", "colima stop --profile work", "relaunch colima start --profile work"]);
    expect(progress).toContain("keyloom: Colima didn't stop cleanly (colima is not running); starting it anyway");
  });

  test("a linked file comes back with its own code, so the page can leave out the command that would change it", async () => {
    const out = "execution error: keyloom colima fix stopped (colima_linked_file): A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: /Users/someone/.colima/default/disk (1)";
    const result = await fixColimaFiles({ blocker: free, overrides: { status: refused, detect: found, platform: "darwin", colimaPlan: () => ({ ok: true, plan }), adminRun: async () => ({ code: 1, out }) } });
    expect(result).toMatchObject({ ok: false, code: "linked_file", reason: expect.stringContaining(": /Users/someone/.colima/default/disk") });
  });

  test("a closed dialog changes nothing, stops nothing and starts nothing; a start that fails after the fix says the files are fixed", async () => {
    let started = 0;
    let stopped = 0;
    const startEngine = async () => (started++, { ok: false as const, engine: "Colima", reason: "keyloom couldn't start Colima: exit status 1" });
    const colimaStop = async () => (stopped++, { ok: true });
    const base = { status: refused, detect: found, platform: "darwin" as const, colimaPlan: () => ({ ok: true as const, plan }), startEngine, colimaStop };
    expect(await fixColimaFiles({ blocker: free, overrides: { ...base, adminRun: async () => ({ code: 1, out: "execution error: User canceled. (-128)" }) } })).toMatchObject({ ok: false, code: "cancelled" });
    expect(started).toBe(0);
    expect(stopped).toBe(0);
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
    const linked = "A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back: /Users/someone/.colima/default/disk";
    expect(dockerView(refused, false, linked, null, "fix-files", "linked_file")).toMatchObject({ kind: "no-access", command: null, fix: { offered: true, note: expect.stringContaining("check what it is") } });
  });

  test("once Docker needs something else, that readiness decides: a Colima that didn't come up gets Restart Colima", () => {
    const down = { ok: false as const, problem: "daemon-down" as const, reason: "down", engine: "Colima", canStart: true, autoStart: true, install: null, access: null, restartEngine: "Colima" };
    expect(dockerView(down, false, "Colima's files are yours again, but Colima didn't come up.", null, "fix-files")).toMatchObject({ kind: "start-failed", restartEngine: "Colima", retry: null });
    expect(dockerView({ ok: true, version: "29", engine: "Docker", autoStart: true }, false, "old failure", null, "fix-files")).toEqual({ kind: "none" });
  });
});
