// Fix Colima's files (D-533): the checks before the password dialog, the root script, how its answer is read, and the use case around it.
// No test asks for a password or touches a real Colima: the osascript runner, the stop and the engine start are fakes, and the root script
// runs only as this account, against a temporary folder, with a stand-in chown that records what it would change.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLIMA_VM_RUNNING, type ColimaFilesPlan, colimaLinkedFileSeen, type PlanDeps, adminRunner, colimaFilesPlan, colimaFilesScript, colimaFixFailure, parsePsLine, parseAccountHome, realPlanDeps, runColimaRootSteps } from "../../src/app/colima-files.ts";
import { COLIMA_SCAN_INCOMPLETE_HELD, colimaLinkedFileHeld, dockerAccessFix, dockerReadiness, ensureDocker, fixColimaFiles, restartDocker } from "../../src/app/toolchain.ts";
import type { DockerStatus } from "../../src/firmware/toolchain/docker.ts";
import { shellQuote } from "../../src/app/remapper-setup.ts";
import { SCAN_INCOMPLETE_HELD, buildBlockedReason, dockerView, linkedFileAfter, linkedFileHeld } from "../../src/web/release/release-words.ts";

const colima = { name: "Colima", command: ["colima", "restart", "--profile", "work"] };
/** A file name as the root script prints it: hex, so no name can read as a record of its own. */
const hex = (name: string) => Buffer.from(name, "utf8").toString("hex");
const LINKED = "A file in Colima's folder is also linked from somewhere else, so keyloom didn't give the files back";
const deps = (over: Partial<PlanDeps> = {}): PlanDeps => ({ home: "/Users/someone", accountHome: "/Users/someone", uid: 501, kind: () => "dir", hostAgentPids: () => [], processOf: () => null, ...over });

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

  test("another account's Colima VM running from ~/.colima stops it before the password dialog, as the root script would (PR #300 CodeRabbit)", () => {
    const seen: number[] = [];
    const processOf = (pid: number) => (seen.push(pid), pid === 700 ? { uid: 0, comm: "/opt/homebrew/bin/limactl" } : pid === 701 ? { uid: 501, comm: "/opt/homebrew/bin/limactl" } : pid === 702 ? { uid: 0, comm: "/usr/sbin/sshd" } : null);
    expect(colimaFilesPlan(colima, deps({ hostAgentPids: () => ["700"], processOf }))).toEqual({ ok: false, reason: COLIMA_VM_RUNNING, code: "colima_vm_running" });
    // The person's own VM, another program that took the number, a host agent that has gone, and a pid file without a number all pass.
    expect(colimaFilesPlan(colima, deps({ hostAgentPids: () => ["701", "702", "703", "", "70 0", "$(id)"], processOf }))).toMatchObject({ ok: true });
    expect(seen).toEqual([700, 701, 702, 703]);
    expect(parsePsLine("    0 /opt/homebrew/Cellar/lima/1.0/bin/limactl\n")).toEqual({ uid: 0, comm: "/opt/homebrew/Cellar/lima/1.0/bin/limactl" });
    expect(parsePsLine("  501 /Applications/My App.app/Contents/MacOS/limactl")).toEqual({ uid: 501, comm: "/Applications/My App.app/Contents/MacOS/limactl" });
    expect(parsePsLine("")).toBeNull();
  });

  test("the real probes read each instance's pid file, skip links and anything unreadable, and name a running process's owner", () => {
    const home = mkdtempSync(join(tmpdir(), "kl-colima-probe-"));
    try {
      const real = realPlanDeps();
      expect(real.hostAgentPids(join(home, ".colima"))).toEqual([]);
      for (const instance of ["colima", "colima-work", "linked", "empty"]) mkdirSync(join(home, ".colima", "_lima", instance), { recursive: true });
      writeFileSync(join(home, ".colima", "_lima", "colima", "ha.pid"), "4242\nmore\n");
      writeFileSync(join(home, ".colima", "_lima", "colima-work", "ha.pid"), "x");
      writeFileSync(join(home, "elsewhere"), "1\n");
      symlinkSync(join(home, "elsewhere"), join(home, ".colima", "_lima", "linked", "ha.pid"));
      expect(real.hostAgentPids(join(home, ".colima")).sort()).toEqual(["4242", "x"]);
      expect(real.processOf(process.pid)).toMatchObject({ uid: process.getuid?.() });
      expect(real.processOf(2 ** 22 + 12345)).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
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
    expect(calls[0]?.[3]).toBe("/usr/bin/osascript");
    expect(calls[0]?.at(-1)).toContain("with administrator privileges");
    expect(calls[0]?.at(-1)).toContain("give Colima's files in your home folder back to you");
  });

  test("a closed dialog is `cancelled`, the script's own stop is its code, and anything else says what macOS printed", async () => {
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: "0:250: execution error: User canceled. (-128)" }))).toEqual({ ok: false, code: "cancelled", reason: "You cancelled the password dialog, so Colima's files didn't change." });
    const linked = `0:900: execution error: keyloom colima fix stopped (colima_linked_file): ${hex("x")} (1)`;
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: linked }))).toEqual({ ok: false, code: "colima_linked_file", reason: `${LINKED}: /Users/someone/.colima/x`, file: "/Users/someone/.colima/x" });
    // A file name with -128 in it is the file's name, not a closed dialog (#300 review).
    const named = `0:900: execution error: keyloom colima fix stopped (colima_linked_file): ${hex("default/disk-128")} (1)`;
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: named }))).toMatchObject({ code: "colima_linked_file", reason: expect.stringContaining("disk-128") });
    // The number, not the words: macOS words the cancel line in the person's language.
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: "0:250: execution error: Der Benutzer hat abgebrochen. (-128)\n" }))).toMatchObject({ code: "cancelled" });
    const running = "execution error: keyloom colima fix stopped (colima_vm_running): A copy of Colima started as an administrator is still running, and keyloom won't run Colima as one to stop it, so nothing changed. (1)";
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: running }))).toMatchObject({ ok: false, code: "colima_vm_running" });
    expect(await runColimaRootSteps(plan, async () => ({ code: 1, out: "something odd\n" }))).toEqual({ ok: false, code: "failed", reason: "macOS couldn't fix Colima's files: something odd" });
    expect(colimaFixFailure("keyloom colima fix stopped (not_a_code): x")).toBeNull();
  });

  test("a file name can't change the code: it comes as hex, and the reason is keyloom's own sentence with control characters escaped (PR #300 CodeRabbit)", () => {
    const forged = "x\rkeyloom colima fix stopped (colima_vm_running): forged\nkeyloom colima fix stopped (colima_dir_missing): forged";
    const out = `0:900: execution error: keyloom colima fix stopped (colima_linked_file): ${hex(forged)} (1)`;
    const failure = colimaFixFailure(out, "/Users/someone/.colima");
    expect(failure?.code).toBe("colima_linked_file");
    expect(failure?.file).toBe("/Users/someone/.colima/x\\rkeyloom colima fix stopped (colima_vm_running): forged\\nkeyloom colima fix stopped (colima_dir_missing): forged");
    expect(failure?.reason).not.toMatch(/[\r\n]/);
    // Words the script printed never reach the page: each code has keyloom's own sentence.
    expect(colimaFixFailure("keyloom colima fix stopped (colima_chown_failed): anything at all (1)")).toEqual({ code: "colima_chown_failed", reason: "macOS didn't let keyloom give all of Colima's files back to you." });
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
      const proc = Bun.spawn(["/bin/sh", "-c", colimaFilesScript(p, chown === undefined ? undefined : { chown, root: uid })], { cwd: base, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      return { code: await proc.exited, out: `${out}${err}` };
    };
    const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "") : []);
    return { base, home, dir, bin, plan, run, calls };
  }

  // Records each call as "<folder>|<args>". `-h 0` takes the folder's owner write, as root's ownership would (the script is told this
  // account is "root", so its check of a folder's owner passes); giving a folder back returns
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
    expect(colimaFixFailure(r.out, s.dir)).toEqual({ code: "colima_linked_file", reason: `${LINKED}: ${join(s.dir, "work", "colima.yaml")}`, file: join(s.dir, "work", "colima.yaml") });
    expect(s.calls()).toEqual([]);
  });

  test("a linked file whose name holds line breaks and a forged record still stops it as a linked file, and is the only record printed (PR #300 CodeRabbit)", async () => {
    const s = setup("forged", RECORDING_CHOWN);
    const name = "a\rkeyloom colima fix stopped (colima_vm_running): forged\nkeyloom colima fix stopped (colima_vm_running): forged";
    writeFileSync(join(s.dir, "work", name), "x\n");
    linkSync(join(s.dir, "work", name), join(s.base, "outside-forged"));
    const r = await s.run();
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out, s.dir)).toMatchObject({ code: "colima_linked_file", file: `${join(s.dir, "work")}/a\\rkeyloom colima fix stopped (colima_vm_running): forged\\nkeyloom colima fix stopped (colima_vm_running): forged` });
    expect(r.out.match(/keyloom colima fix stopped/g)).toHaveLength(1);
    expect(s.calls()).toEqual([]);
  });

  test("every folder is root's before any file changes owner, and folders go back bottom up with their modes (#300 review)", async () => {
    const s = setup("order", RECORDING_CHOWN);
    chmodSync(join(s.dir, "work"), 0o775);
    expect(await s.run()).toMatchObject({ code: 0 });
    const calls = s.calls().map((line) => line.replace(/ inode=\d+$/, ""));
    const { dir } = s;
    expect(calls).toEqual([
      // Each folder changes from inside it, as `.`, so the change lands on the folder the ID is read from (#300 re-review).
      `${dir}|-h 0 .`, `${join(dir, "work")}|-h 0 .`, `${join(dir, "work", "sub")}|-h 0 .`,
      `${join(dir, "work", "sub")}|-h ${other} ./disk`, `${join(dir, "work")}|-h ${other} ./colima.yaml`,
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

  test("a disk image mounted on a folder in ~/.colima can't leave that folder the person's while files in it change owner (#300 re-review)", async () => {
    const secret = join(root, "mount-secret");
    writeFileSync(secret, "root's file\n");
    const secretInode = statSync(secret).ino;
    // The person's moves: a disk image mounted on ~/.colima/work before the run, so root's change to `work` lands on the image's root
    // folder; then, as soon as that change is made, the image goes, and the real `work` is the person's again. Any file root then hands
    // back by name in it can be swapped for a hard link to a file elsewhere.
    const s = setup("mount", `if [ "$2" = 0 ] && [ ! -e "$LOG.detached" ] && [ "$(cd "$3" 2>/dev/null && /bin/pwd -P)" = "$KL_MNT" ]; then
  : > "$LOG.detached"
  /bin/chmod u-w "$3"
  printf '%s|-h 0 %s (image)\\n' "$(/bin/pwd -P)" "$3" >> "$LOG"
  /usr/bin/hdiutil detach -quiet -force "$KL_MNT" && echo detached >> "$LOG.detached"
  exit 0
fi
if [ "$2" != 0 ] && [ ! -d "$3" ] && /bin/mv "$3" "$3.moved" 2>/dev/null && /bin/ln '${secret}' "$3" 2>/dev/null; then echo swapped >> "$LOG.detached"; fi
${RECORDING_CHOWN}`);
    const mnt = join(s.dir, "work");
    const image = join(s.base, "work.dmg");
    try {
      expect(Bun.spawnSync(["/usr/bin/hdiutil", "create", "-quiet", "-size", "2m", "-fs", "HFS+", "-volname", "kl-colima-test", "-o", image]).exitCode).toBe(0);
      expect(Bun.spawnSync(["/usr/bin/hdiutil", "attach", "-quiet", "-nobrowse", "-noverify", "-noautofsck", "-mountpoint", mnt, image]).exitCode).toBe(0);
      expect(statSync(mnt).dev).not.toBe(statSync(s.dir).dev);
      const r = await s.run(s.plan, { KL_MNT: mnt });
      expect(readFileSync(`${join(s.base, "chown.log")}.detached`, "utf8")).toContain("detached");
      const changed = s.calls().flatMap((line) => line.match(/inode=(\d+)$/)?.[1] ?? []).map(Number);
      expect(changed).not.toContain(secretInode);
      expect(statSync(secret).nlink).toBe(1);
      // It stops, says so, and changes nothing more.
      expect(r.code).toBe(1);
      expect(colimaFixFailure(r.out)?.code).toBe("colima_chown_failed");
    } finally {
      Bun.spawnSync(["/usr/bin/hdiutil", "detach", "-quiet", "-force", mnt]);
    }
  }, 30_000);

  test("a file changes owner only from a folder that is root's, unwritable, without an ACL and recorded; the first that isn't stops it (#300 re-review)", async () => {
    // As the first file changes owner, the other folder holding a file loses one of the things the check asks for.
    const other_folder = `case $(/bin/pwd -P) in */sub) t=..;; *) t=./sub;; esac`;
    const tampers = { acl: `/bin/chmod +a "everyone allow add_file" "$t"`, "group write": `/bin/chmod g+w "$t"` };
    for (const [name, tamper] of Object.entries(tampers)) {
      const s = setup(`check-${name.replace(" ", "-")}`, `if [ "$2" != 0 ] && [ ! -e "$LOG.t" ]; then : > "$LOG.t"; ${other_folder}; ${tamper}; fi\n${RECORDING_CHOWN}`);
      const r = await s.run();
      expect(colimaFixFailure(r.out)?.code).toBe("colima_chown_failed");
      // The first file, and then nothing more but step 3 giving the folders back.
      expect(s.calls().filter((line) => line.includes(" inode="))).toHaveLength(1);
      expect(s.calls().at(-1)).toBe(`${s.dir}|-h ${other} ./.`);
    }
    // A folder that isn't root's: the script is told root is another account, so no folder here passes, and no file changes.
    const s = setup("check-owner", RECORDING_CHOWN);
    const proc = Bun.spawn(["/bin/sh", "-c", colimaFilesScript(s.plan, { chown: join(s.bin, "chown"), root: uid + 7 })], { cwd: s.base, stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(1);
    expect(colimaFixFailure(await new Response(proc.stderr).text())?.code).toBe("colima_chown_failed");
    expect(s.calls().filter((line) => line.includes(" inode="))).toEqual([]);
  });

  test("a folder step 1 never recorded is never one a file changes owner in, even when it was never seen as failing (#300 re-review)", async () => {
    // As root takes `work`, the person's folder of the same name takes its place, the way an unmounted disk image's folder does, and
    // step 1's walk passes it by without a word.
    const s = setup("unrecorded", `if [ "$2" = 0 ] && [ ! -e "$LOG.t" ]; then case $(/bin/pwd -P) in */work)
  : > "$LOG.t"; cd .. && /bin/chmod u+w . && /bin/mv work work.real && /bin/mkdir work && echo planted > work/planted && /bin/chmod u-w . && cd work.real;;
esac; fi
${RECORDING_CHOWN}`);
    const r = await s.run();
    expect(existsSync(join(s.dir, "work", "planted"))).toBe(true);
    expect(colimaFixFailure(r.out)?.code).toBe("colima_chown_failed");
    expect(s.calls().filter((line) => line.includes(" inode=") && line.startsWith(`${join(s.dir, "work")}|`))).toEqual([]);
  });

  /** The folders directly in `folder`, in the order macOS's find walks them, so a test can time the person's move. */
  const walkOrder = (folder: string) =>
    Bun.spawnSync(["/usr/bin/find", "-P", folder, "-mindepth", "1", "-maxdepth", "1", "-type", "d"]).stdout.toString().trim().split("\n").map((p) => p.slice(folder.length + 1));
  /** ~/.colima for `setup(name)`, so a test can make folders, and name them in its stand-in chown, before setup writes it. */
  const colimaOf = (name: string) => join(root, name, "it's $(touch pwned) home", ".colima");
  const q_ = shellQuote;

  test("step 3 gives a folder back only from a parent still root's and recorded, so a folder moved out of reach is passed over (#300 third review)", async () => {
    const outside = join(root, "moved-outside");
    writeFileSync(outside, "root's file\n");
    chmodSync(outside, 0o600);
    const outsideInode = statSync(outside).ino;
    const dir = colimaOf("moved");
    for (const name of ["x1", "x2"]) mkdirSync(join(dir, name), { recursive: true });
    // Q is walked before P, so step 3 reads P after Q has gone back.
    const order = walkOrder(dir).filter((n) => n === "x1" || n === "x2");
    expect(order).toHaveLength(2);
    const [q = "", p = ""] = order;
    const Q = join(dir, q);
    const P = join(dir, p);
    // L's 0777 is recorded, so step 3 would put that mode on whatever ./L is when it gets there.
    mkdirSync(join(Q, "L", "m"), { recursive: true });
    chmodSync(join(Q, "L"), 0o777);
    const stop = join(root, "moved-stop");
    // The person's moves: P is a folder root can't take (uchg), so step 1 passes it by. Once Q is the person's again, L moves into P, and
    // from then on P/L keeps turning into a hard link to a file outside ~/.colima and back.
    const swapper = `i=0; while [ ! -e ${q_(stop)} ] && [ $i -lt 3000 ]; do
  /bin/mv L L.real 2>/dev/null && { /bin/ln ${q_(outside)} L 2>/dev/null; /bin/rm -f L; /bin/mv L.real L; }; i=$((i+1))
done; : > ${q_(`${stop}.done`)}`;
    const s = setup("moved", `if [ "$2" = 0 ] && [ "$(/bin/pwd -P)" = ${q_(P)} ]; then exit 1; fi
( ${RECORDING_CHOWN} )
if [ "$2" != 0 ] && [ "$3" = ./${q} ] && [ "$(/bin/pwd -P)" = ${q_(dir)} ]; then
  /bin/mv ./${q}/L ${q_(join(P, "L"))} && echo moved >> "$LOG.moved"
  (cd ${q_(P)} && ${swapper}) </dev/null >/dev/null 2>&1 &
fi`);
    try {
      const r = await s.run();
      expect(readFileSync(`${join(s.base, "chown.log")}.moved`, "utf8").trim()).toBe("moved");
      expect(colimaFixFailure(r.out)?.code).toBe("colima_chown_failed");
      // Nothing in step 3 ran from P or below it, and the file outside kept its mode and owner.
      expect(s.calls().filter((line) => line.startsWith(`${P}|`) || line.startsWith(`${P}/`))).toEqual([]);
      expect(s.calls().flatMap((line) => line.match(/inode=(\d+)$/)?.[1] ?? []).map(Number)).not.toContain(outsideInode);
      // m, L and Q went back before the move, bottom up, each from a parent that was still root's.
      expect(s.calls().filter((line) => line.startsWith(`${Q}/`) || line.startsWith(`${Q}|`) || line.endsWith(` ./${q}`))).toEqual([
        `${Q}|-h 0 .`, `${join(Q, "L")}|-h 0 .`, `${join(Q, "L", "m")}|-h 0 .`,
        `${join(Q, "L")}|-h ${other} ./m`, `${Q}|-h ${other} ./L`, `${dir}|-h ${other} ./${q}`,
      ]);
    } finally {
      writeFileSync(stop, "");
      for (let i = 0; i < 200 && !existsSync(`${stop}.done`); i++) await Bun.sleep(25);
    }
    expect(statSync(outside).mode & 0o7777).toBe(0o600);
    expect(statSync(outside).nlink).toBe(1);
  }, 30_000);

  test("step 1 takes a folder only from a parent that is root's, so a name in a folder that stopped being root's is never followed (#300 third review)", async () => {
    const outsideDir = join(root, "parent-outside");
    mkdirSync(outsideDir);
    chmodSync(outsideDir, 0o777);
    const C = join(colimaOf("parent"), "c");
    for (const name of ["g1", "g2"]) mkdirSync(join(C, name), { recursive: true });
    const order = walkOrder(C);
    expect(order).toHaveLength(2);
    const [first = "", second = ""] = order;
    // As root takes C's first folder, C is the person's again, as it is when the walk went into C's real folder after a disk image on it
    // took root's change; then C's second folder becomes a link to a folder outside ~/.colima.
    const s = setup("parent", `if [ "$2" = 0 ] && [ "$(/bin/pwd -P)" = ${q_(join(C, first))} ]; then
  cd .. && /bin/chmod u+w . && /bin/mv ${second} ${second}.real && /bin/ln -s ${q_(outsideDir)} ${second} && /bin/chmod g+w . && cd ${first}
fi
${RECORDING_CHOWN}`);
    const r = await s.run();
    expect(colimaFixFailure(r.out)?.code).toBe("colima_chown_failed");
    expect(existsSync(join(C, `${second}.real`))).toBe(true);
    expect(s.calls().filter((line) => line.startsWith(`${outsideDir}|`))).toEqual([]);
    expect(statSync(outsideDir).mode & 0o7777).toBe(0o777);
  });

  test("a folder's whole mode comes back, its sticky bit included (#300 re-review)", async () => {
    const s = setup("sticky", RECORDING_CHOWN);
    // macOS's chmod: Bun's chmodSync drops the sticky bit.
    expect(Bun.spawnSync(["/bin/chmod", "1777", join(s.dir, "work")]).exitCode).toBe(0);
    expect(statSync(join(s.dir, "work")).mode & 0o7777).toBe(0o1777);
    expect(await s.run()).toMatchObject({ code: 0 });
    expect(statSync(join(s.dir, "work")).mode & 0o7777).toBe(0o1777);
  });

  test("a folder root can't take stops the walk there: no file changes, and only folders it took go back", async () => {
    const s = setup("partial", `if [ "$2" = 0 ]; then case $(/bin/pwd -P) in */work) exit 1;; esac; fi\n${RECORDING_CHOWN}`);
    const r = await s.run();
    expect(r.code).toBe(1);
    expect(colimaFixFailure(r.out)?.code).toBe("colima_chown_failed");
    // Not ./work's subfolder, which the person could still rename in, nor any file.
    expect(s.calls()).toEqual([`${s.dir}|-h 0 .`, `${s.dir}|-h ${other} ./.`]);
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

  test("another account's running VM is said without opening the password dialog, and root's own stop says the same (PR #300 CodeRabbit)", async () => {
    let asked = 0;
    const base = { status: refused, detect: found, platform: "darwin" as const, adminRun: async () => (asked++, { code: 0, out: "" }) };
    const before = await fixColimaFiles({ blocker: free, overrides: { ...base, colimaPlan: () => ({ ok: false as const, reason: COLIMA_VM_RUNNING, code: "colima_vm_running" as const }) } });
    expect(before).toEqual({ ok: false, engine: "Colima", reason: COLIMA_VM_RUNNING, code: "vm_running" });
    expect(asked).toBe(0);
    const out = `execution error: keyloom colima fix stopped (colima_vm_running): ${COLIMA_VM_RUNNING} (1)`;
    const atRoot = await fixColimaFiles({ blocker: free, overrides: { ...base, colimaPlan: () => ({ ok: true as const, plan }), adminRun: async () => ({ code: 1, out }) } });
    expect(atRoot).toMatchObject({ ok: false, reason: COLIMA_VM_RUNNING, code: "vm_running" });
  });

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
        adminRun: async (cmd) => (steps.push(`admin ${cmd[3]}`), { code: 0, out: "" }),
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
    expect(steps).toEqual(["admin /usr/bin/osascript", "colima stop --profile work", "relaunch colima start --profile work"]);
    expect(progress).toContain("keyloom: Colima didn't stop cleanly (colima is not running); starting it anyway");
  });

  test("a linked file comes back with its own code, so the page can leave out the command that would change it", async () => {
    const out = `execution error: keyloom colima fix stopped (colima_linked_file): ${hex("default/disk")} (1)`;
    const result = await fixColimaFiles({ blocker: free, overrides: { status: refused, detect: found, platform: "darwin", colimaPlan: () => ({ ok: true, plan }), adminRun: async () => ({ code: 1, out }) } });
    expect(result).toMatchObject({ ok: false, code: "linked_file", reason: expect.stringContaining(": /Users/someone/.colima/default/disk"), file: "/Users/someone/.colima/default/disk" });
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

  test("readiness holds back Colima's command while a linked file is known, so a reload can't show it again (PR #300 CodeRabbit)", async () => {
    const base = { status: refused, detect: found, env: {}, platform: "darwin" as const };
    const linked = `execution error: keyloom colima fix stopped (colima_linked_file): ${hex("x")} (1)`;
    const fixWith = (adminRun: () => Promise<{ code: number; out: string }>) => fixColimaFiles({ blocker: free, overrides: { status: refused, detect: found, platform: "darwin", colimaPlan: () => ({ ok: true, plan }), adminRun, colimaStop: async () => ({ ok: true }), startEngine: async () => ({ ok: true, version: "29", engine: "Colima", waitedMs: 1 }) } });
    // The hold is the server's, so a fix that completes first starts this test from none.
    expect(await fixWith(async () => ({ code: 0, out: "" }))).toMatchObject({ ok: true });
    // The person's own look finds one.
    expect(await dockerReadiness({ ...base, colimaLinkedScan: async () => ({ kind: "found", file: "/Users/someone/.colima/y" }) })).toMatchObject({ access: { command: null, linkedFile: "/Users/someone/.colima/y", fixFiles: true } });
    const none = async () => ({ kind: "none" as const });
    expect(await dockerReadiness({ ...base, colimaLinkedScan: none })).toMatchObject({ access: { command: expect.stringContaining("chown -R") } });
    // Root found one that the look can't see: held until a fix completes, whatever ends the presses between.
    expect(await fixWith(async () => ({ code: 1, out: linked }))).toMatchObject({ code: "linked_file", file: "/Users/someone/.colima/x" });
    expect(await dockerReadiness({ ...base, colimaLinkedScan: none })).toMatchObject({ access: { command: null, linkedFile: "/Users/someone/.colima/x" } });
    await fixWith(async () => ({ code: 1, out: "execution error: User canceled. (-128)" }));
    expect(await dockerReadiness({ ...base, colimaLinkedScan: none })).toMatchObject({ access: { command: null, linkedFile: "/Users/someone/.colima/x" } });
    expect(await fixWith(async () => ({ code: 0, out: "" }))).toMatchObject({ ok: true });
    expect(await dockerReadiness({ ...base, colimaLinkedScan: none })).toMatchObject({ access: { command: expect.stringContaining("chown -R") } });
  });

  test("a linked file a fix finds while the look runs holds the command back in that same answer (PR #300 CodeRabbit)", async () => {
    const base = { status: refused, detect: found, env: {}, platform: "darwin" as const };
    const fixWith = (out: string) => fixColimaFiles({ blocker: free, overrides: { status: refused, detect: found, platform: "darwin", colimaPlan: () => ({ ok: true, plan }), adminRun: async () => ({ code: out === "" ? 0 : 1, out }), colimaStop: async () => ({ ok: true }), startEngine: async () => ({ ok: true, version: "29", engine: "Colima", waitedMs: 1 }) } });
    expect(await fixWith("")).toMatchObject({ ok: true });
    // The look sees nothing, and before it answers, a fix ends at a linked file.
    const lookDuringFix = async () => {
      await fixWith(`execution error: keyloom colima fix stopped (colima_linked_file): ${hex("default/disk")} (1)`);
      return { kind: "none" as const };
    };
    expect(await dockerReadiness({ ...base, colimaLinkedScan: lookDuringFix })).toMatchObject({ access: { command: null, linkedFile: "/Users/someone/.colima/default/disk" } });
    expect(await fixWith("")).toMatchObject({ ok: true });
  });

  test("the command shows only after a look that read all of ~/.colima and found none; one that didn't finish holds it back (D-533)", async () => {
    const base = { status: refused, detect: found, env: {}, platform: "darwin" as const };
    expect(await dockerReadiness({ ...base, colimaLinkedScan: async () => ({ kind: "incomplete" }) })).toMatchObject({ access: { command: null, scanIncomplete: true, fixFiles: true } });
    // The real look, under bun test, reads nothing and says so.
    expect(await dockerReadiness(base)).toMatchObject({ access: { command: null, scanIncomplete: true } });
    // Linux has no look and no button, so its command stays.
    expect(await dockerReadiness({ ...base, platform: "linux" })).toMatchObject({ access: { command: "sudo usermod -aG docker $USER" } });
  });

  test.skipIf(process.platform !== "darwin")("the person's own look finds a file with a second name in ~/.colima, passes over one that is already theirs, and says when it couldn't read a folder", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "kl-colima-look-")));
    const refuse = process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS;
    try {
      mkdirSync(join(home, ".colima", "default"), { recursive: true });
      writeFileSync(join(home, ".colima", "default", "disk"), "disk\n");
      const me = process.getuid?.() ?? 0;
      const at = (uid: number, over: Partial<PlanDeps> = {}) => () => deps({ home, accountHome: home, uid, ...over });
      // Under bun test it reads nothing, and says it didn't finish.
      expect(await colimaLinkedFileSeen(colima, at(me + 1))).toEqual({ kind: "incomplete" });
      delete process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS;
      expect(await colimaLinkedFileSeen(colima, at(me + 1))).toEqual({ kind: "none" });
      linkSync(join(home, ".colima", "default", "disk"), join(home, "other-name"));
      expect(await colimaLinkedFileSeen(colima, at(me + 1))).toEqual({ kind: "found", file: join(home, ".colima", "default", "disk") });
      expect(await colimaLinkedFileSeen(colima, at(me))).toEqual({ kind: "none" });
      // Another account's running VM blocks the fix, not the look (PR #300 CodeRabbit).
      const vm = at(me + 1, { hostAgentPids: () => ["700"], processOf: () => ({ uid: 0, comm: "/opt/homebrew/bin/limactl" }) });
      expect(colimaFilesPlan(colima, vm())).toMatchObject({ ok: false, code: "colima_vm_running" });
      expect(await colimaLinkedFileSeen(colima, vm)).toEqual({ kind: "found", file: join(home, ".colima", "default", "disk") });
      // A folder it can't read hides what is in it, so the look didn't finish, which is not "none" (PR #300 CodeRabbit).
      rmSync(join(home, "other-name"));
      mkdirSync(join(home, ".colima", "locked"));
      chmodSync(join(home, ".colima", "locked"), 0o000);
      try {
        expect(await colimaLinkedFileSeen(colima, at(me + 1))).toEqual({ kind: "incomplete" });
      } finally {
        chmodSync(join(home, ".colima", "locked"), 0o755);
      }
      // A folder it can't vouch for is a look that didn't run.
      expect(await colimaLinkedFileSeen(colima, at(me + 1, { home: "/Users/Shared" }))).toEqual({ kind: "incomplete" });
    } finally {
      if (refuse !== undefined) process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS = refuse;
      rmSync(home, { recursive: true, force: true });
    }
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

  test("after a linked file, a later cancel, refusal or failure never brings back the chown -R command; only a completed fix does (PR #300 CodeRabbit)", () => {
    const file = "/Users/someone/.colima/default/disk";
    const no = (code?: "engine_busy" | "build_running" | "cancelled" | "linked_file" | "vm_running") => ({ ok: false as const, reason: "r", engine: "Colima", ...(code === undefined ? {} : { code }), ...(code === "linked_file" ? { file } : {}) });
    let held = linkedFileAfter(null, "fix-files", no("linked_file"));
    expect(held).toBe(file);
    for (const result of [no("cancelled"), no("build_running"), no("engine_busy"), no("vm_running"), no()]) {
      held = linkedFileAfter(held, "fix-files", result);
      expect(held).toBe(file);
    }
    // A start or restart says nothing about the file, even when Docker comes up.
    held = linkedFileAfter(held, "start", { ok: true, version: "29", engine: "Colima", waitedMs: 1 });
    expect(held).toBe(file);
    expect(linkedFileAfter(held, "fix-files", { ok: true, version: "29", engine: "Colima", waitedMs: 1 })).toBeNull();
    expect(linkedFileAfter(null, "fix-files", no("cancelled"))).toBeNull();

    // What the page shows while it holds: the button, which checks for the file again, no command, and the reason beside whatever ended
    // the last press, naming the file (PR #300 CodeRabbit).
    const why = linkedFileHeld(file);
    expect(dockerView(refused, false, "You cancelled the password dialog.", null, "fix-files", "cancelled", file)).toEqual({ kind: "no-access", command: null, note: access.note, restartApp: null, fix: { offered: true, note: `You closed the password dialog, so nothing changed. ${why}` } });
    expect(dockerView(refused, false, "A build or flash is running.", null, "fix-files", "build_running", file)).toMatchObject({ command: null, fix: { offered: true, note: expect.stringContaining(why) } });
    expect(dockerView(refused, false, "macOS couldn't fix Colima's files: x", null, "fix-files", null, file)).toMatchObject({ command: null, fix: { offered: true, note: `macOS couldn't fix Colima's files: x ${why}` } });
    expect(dockerView(refused, false, null, null, null, null, file)).toMatchObject({ command: null, fix: { offered: true, note: why } });
    // Without it, the cancel shows the command again, as before.
    expect(dockerView(refused, false, "You cancelled the password dialog.", null, "fix-files", "cancelled", null)).toMatchObject({ command: access.command, fix: { note: "You closed the password dialog, so nothing changed." } });
  });

  test("a linked file the server reports holds back the command on a fresh page too, and says why (PR #300 CodeRabbit)", () => {
    const file = "/Users/someone/.colima/x";
    const held = { ...refused, access: { ...access, command: null, linkedFile: file } };
    const view = dockerView(held, false, null, null);
    // The same sentence `keyloom doctor` prints (#300 third review).
    expect(linkedFileHeld(file)).toBe(colimaLinkedFileHeld(file));
    expect(view).toMatchObject({ kind: "no-access", command: null, fix: { offered: true, note: colimaLinkedFileHeld(file) } });
    expect(dockerView(held, false, "You cancelled the password dialog.", null, "fix-files", "cancelled")).toMatchObject({ command: null, fix: { offered: true, note: expect.stringContaining(file) } });
  });

  test("a look that didn't finish holds back the command, says why, and keeps the button as the way on (D-533)", () => {
    const unread = { ...refused, access: { ...access, command: null, scanIncomplete: true } };
    expect(SCAN_INCOMPLETE_HELD).toBe(COLIMA_SCAN_INCOMPLETE_HELD);
    const view = dockerView(unread, false, null, null);
    expect(view).toEqual({ kind: "no-access", command: null, note: access.note, restartApp: null, fix: { offered: true, note: SCAN_INCOMPLETE_HELD } });
    expect(buildBlockedReason(view)).toBe("Fix Colima's files first.");
    // Every way a press ends keeps the button and the reason, since no command is there to copy.
    for (const [problem, code] of [["You cancelled.", "cancelled"], ["A build is running.", "build_running"], [COLIMA_VM_RUNNING, "vm_running"], ["macOS couldn't fix Colima's files: x", null]] as const) {
      expect(dockerView(unread, false, problem, null, "fix-files", code)).toMatchObject({ command: null, fix: { offered: true, note: expect.stringContaining(SCAN_INCOMPLETE_HELD) } });
    }
  });

  test("another account's running VM is said with the way on: the command that stops it, or the button once no command is offered", () => {
    const shown = dockerView(refused, false, COLIMA_VM_RUNNING, null, "fix-files", "vm_running");
    expect(shown).toMatchObject({ kind: "no-access", command: access.command, fix: { offered: false, note: expect.stringContaining("The command below stops that copy, gives the files back and starts Colima as you.") } });
    expect(buildBlockedReason(shown)).toBe("Give keyloom access to Docker first.");
    expect(dockerView(refused, false, COLIMA_VM_RUNNING, null, "fix-files", "vm_running", "/Users/someone/.colima/x")).toMatchObject({ command: null, fix: { offered: true, note: expect.stringContaining("Stop that copy of Colima, then press Fix Colima's files again.") } });
  });

  test("once Docker needs something else, that readiness decides: a Colima that didn't come up gets Restart Colima", () => {
    const down = { ok: false as const, problem: "daemon-down" as const, reason: "down", engine: "Colima", canStart: true, autoStart: true, install: null, access: null, restartEngine: "Colima" };
    expect(dockerView(down, false, "Colima's files are yours again, but Colima didn't come up.", null, "fix-files")).toMatchObject({ kind: "start-failed", restartEngine: "Colima", retry: null });
    expect(dockerView({ ok: true, version: "29", engine: "Docker", autoStart: true }, false, "old failure", null, "fix-files")).toEqual({ kind: "none" });
  });
});
