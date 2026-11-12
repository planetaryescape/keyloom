// Setting kanata up from the app (D-493) and opening System Settings panes (D-492), with an injected runner: nothing here runs
// brew, osascript or open. The quoting is checked against a real /bin/sh with printf, which only prints.
import { afterEach, describe, expect, test } from "bun:test";
import {
  ADMIN_PROMPT, IDLE_INSTALL, type KanataInstall, ROOT_SCRIPT_ENV, SETTINGS_PANES, SETTINGS_PANE_NAMES, type Runner, type SetupDeps, type StreamRunner, adminCommand, appleScriptString,
  compareVersions, daemonInstallScript, installKanata, kanataInstaller, kanataUpdate, openSettingsPane, remapperSetupStatus, shellQuote, startKanataDaemon,
  streamRunner,
} from "../../src/app/remapper-setup.ts";
import { cmdCheckResult, fileSha256 } from "../../src/firmware/kanata/binary.ts";
import { rootScriptFailure } from "../../src/firmware/kanata/daemon-install.ts";
import { ROOT_KANATA_PATH } from "../../src/firmware/kanata/plist.ts";
import { cellarVersion, looksLikeHomebrewUpdate } from "../../src/firmware/kanata/doctor.ts";
import { remapperDoctor, setupRemapper } from "../../src/app/remapper.ts";
import { writeFakeKanataBinary } from "../helpers/fake-kanata.ts";
import { SettingsPaneSchema } from "../../src/api/system-remapper.ts";
import type { DoctorProbe } from "../../src/firmware/kanata/doctor.ts";
import { launchDaemonPlist } from "../../src/firmware/kanata/plist.ts";
import { MAC, remapperWorld } from "../helpers/remapper-world.ts";
import { tempDir } from "../helpers/tmp.ts";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

let w: ReturnType<typeof remapperWorld> | undefined;
afterEach(async () => {
  await w?.stopAll();
  w = undefined;
});

/** Records every command and answers from a table keyed by the program's name. */
function recorder(answers: Record<string, { code: number; out: string }> = {}) {
  const calls: string[][] = [];
  const run: Runner = async (cmd) => {
    calls.push([...cmd]);
    // An admin command starts `/usr/bin/env -i PATH=… /usr/bin/osascript`, so it answers as osascript.
    const program = cmd[0] === "/usr/bin/env" ? cmd.slice(1).find((a) => !a.startsWith("-") && !a.includes("=")) : cmd[0];
    return answers[(program ?? "").split("/").at(-1) ?? ""] ?? { code: 0, out: "" };
  };
  return { calls, run };
}

const machine = (over: Partial<DoctorProbe> = {}): DoctorProbe => ({
  kanataBin: () => undefined,
  kanataVersion: async () => undefined,
  exec: async () => ({ code: 1, out: "" }),
  exists: () => false,
  readText: async () => undefined,
  hello: async () => {
    throw new Error("connection refused");
  },
  ...over,
});

/** Records each streamed command and prints `lines` from it, then exits with `code`; an abort ends it as Homebrew's would. */
function streamer(script: { lines?: string[]; code?: number; hold?: Promise<void> } = {}) {
  const calls: string[][] = [];
  const stream: StreamRunner = async (cmd, opts) => {
    calls.push([...cmd]);
    for (const line of script.lines ?? []) opts.onLine(line);
    if (script.hold) await Promise.race([script.hold, new Promise((resolve) => opts.signal.addEventListener("abort", resolve, { once: true }))]);
    return opts.signal.aborted ? { code: null, aborted: true } : { code: script.code ?? 0, aborted: false };
  };
  return { calls, stream };
}

const deps = (run: Runner, over: Partial<SetupDeps> = {}): SetupDeps => ({
  run, stream: streamer().stream, platform: "darwin", brew: () => "/opt/homebrew/bin/brew", kanata: () => "/opt/homebrew/bin/kanata", ...over,
});

const SHA = "a".repeat(64);
const install = (plist: string, source = "/opt/homebrew/Cellar/kanata/1.12.0/bin/kanata", sha256 = SHA) => ({ plist, kanata: { source, sha256 } });

/** Reads an AppleScript string literal back, as AppleScript would. */
const unAppleScript = (literal: string): string => {
  expect(literal.startsWith('"') && literal.endsWith('"')).toBe(true);
  return literal.slice(1, -1).replace(/\\(.)/g, "$1");
};

/** The root script inside an admin command: AppleScript's quoting, then `env -i … /bin/sh -c` and the shell's own quoting, taken off. */
function rootScriptOf(cmd: readonly string[]): string {
  const shell = unAppleScript(/^do shell script (".*?") with prompt /s.exec(cmd.at(-1) ?? "")?.[1] ?? '""');
  const prefix = `/usr/bin/env -i ${ROOT_SCRIPT_ENV} /bin/sh -c '`;
  expect(shell.startsWith(prefix) && shell.endsWith("'")).toBe(true);
  return shell.slice(prefix.length, -1).replaceAll("'\\''", "'");
}

describe("quoting", () => {
  const nasty = [`plain`, `with space`, `it's`, `"double"`, `$(touch /tmp/x)`, "`tick`", `back\\slash`, `semi;colon && rm`, `new\nline`];

  test("shellQuote gives /bin/sh exactly the string back, whatever it holds", async () => {
    for (const s of nasty) {
      const proc = Bun.spawn(["/bin/sh", "-c", `printf %s ${shellQuote(s)}`], { stdout: "pipe" });
      expect(await new Response(proc.stdout).text()).toBe(s);
    }
  });

  test("appleScriptString escapes only backslash and double quote, and reads back to the same text", () => {
    for (const s of nasty) expect(unAppleScript(appleScriptString(s))).toBe(s);
    expect(appleScriptString(`a"b\\c`)).toBe(`"a\\"b\\\\c"`);
  });

  test("the admin command is osascript with one script argument that names what it does", () => {
    const plist = launchDaemonPlist({ kanataPath: "/opt/homebrew/bin/kanata", configPath: `/Users/o'brien/Library/Application Support/kanata/keyloom.kbd`, port: 10000 });
    const cmd = adminCommand(daemonInstallScript(install(plist)), ADMIN_PROMPT);
    expect(cmd.slice(0, 5)).toEqual(["/usr/bin/env", "-i", ROOT_SCRIPT_ENV, "/usr/bin/osascript", "-e"]);
    expect(cmd).toHaveLength(6);
    const m = /^do shell script (".*") with prompt (".*") with administrator privileges$/s.exec(cmd[5]!);
    expect(m).not.toBeNull();
    expect(unAppleScript(m![1]!)).toBe(`/usr/bin/env -i ${ROOT_SCRIPT_ENV} /bin/sh -c ${shellQuote(daemonInstallScript(install(plist)))}`);
    const shell = daemonInstallScript(install(plist));
    expect(unAppleScript(m![2]!)).toContain("kanata");
    expect(shell).toContain("mv -f \"$t\" '/Library/LaunchDaemons/dev.keyloom.kanata.plist'");
    expect(shell).toContain("launchctl bootstrap system '/Library/LaunchDaemons/dev.keyloom.kanata.plist'");
    expect(shell).not.toContain("sudo");
  });

  // macOS only: the password dialog is, and there /bin/sh is bash, which imports functions. Linux's dash doesn't, so the attack can't be shown.
  test.skipIf(process.platform !== "darwin")("nothing from keyloom's environment reaches the root script: no shell function, no variable, no xtrace hook (#300 re-review)", async () => {
    // What whoever starts keyloom could put in its environment. bash, macOS's /bin/sh, runs an exported function in place of `cd`, and
    // runs PS4's command under SHELLOPTS=xtrace.
    const poisoned = { PATH: process.env.PATH ?? "/usr/bin:/bin", KLTEST: "leaked", "BASH_FUNC_cd%%": "() { echo FUNC-RAN; }", SHELLOPTS: "xtrace", PS4: "$(echo PS4-RAN >&2)" };
    const probe = `cd /; echo "[$KLTEST]"; /usr/bin/env`;
    const run = async (argv: string[]) => {
      const proc = Bun.spawn(argv, { env: poisoned, stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      await proc.exited;
      return `${out}${err}`;
    };
    // The environment does what it says without the wrapper, so the test below is not passing for want of an attack.
    expect(await run(["/bin/sh", "-c", probe])).toContain("FUNC-RAN");
    // The built command line, with `/bin/sh -c` standing in for osascript's `do shell script … with administrator privileges`.
    const cmd = adminCommand(probe, ADMIN_PROMPT);
    const shell = unAppleScript(/^do shell script (".*?") with prompt /s.exec(cmd.at(-1)!)![1]!);
    expect(cmd.slice(0, 4)).toEqual(["/usr/bin/env", "-i", ROOT_SCRIPT_ENV, "/usr/bin/osascript"]);
    const out = await run([...cmd.slice(0, 3), "/bin/sh", "-c", shell]);
    expect(out).not.toContain("FUNC-RAN");
    expect(out).not.toContain("PS4-RAN");
    expect(out).toContain("[]");
    expect(out).not.toMatch(/KLTEST|BASH_FUNC|SHELLOPTS|PS4/);
    expect(out).toContain(ROOT_SCRIPT_ENV);
  });

  test("the root script carries the plist itself, and the only file it reads is kanata, pinned to the hash keyloom checked", () => {
    const home = `/Users/o'brien`;
    const plist = launchDaemonPlist({ kanataPath: ROOT_KANATA_PATH, configPath: `${home}/Library/Application Support/kanata/keyloom.kbd`, port: 10000 });
    const shell = daemonInstallScript(install(plist));
    // No path under the home folder: the plist names keyloom.kbd there, but travels encoded.
    expect(shell).not.toContain("/Users/");
    expect(shell).not.toContain("kanata/keyloom.kbd");
    // One read of a path root doesn't own: kanata, into root's own temporary file, which is installed only if its hash matches.
    expect(shell.match(/\bcp\b/g)).toHaveLength(1);
    expect(shell).toContain(`cp '/opt/homebrew/Cellar/kanata/1.12.0/bin/kanata' "$b" ||`);
    expect(shell).toContain(`[ "$(shasum -a 256 "$b" | cut -d ' ' -f 1)" = ${SHA} ] ||`);
    expect(shell).toContain(`chown root:wheel "$b" && chmod 755 "$b" && mv -f "$b" '${ROOT_KANATA_PATH}' ||`);
    expect(shell.indexOf("shasum")).toBeLessThan(shell.indexOf("mv -f \"$b\""));
    expect(shell.indexOf("mv -f \"$b\"")).toBeLessThan(shell.indexOf("launchctl bootstrap"));
    const encoded = /printf %s '([A-Za-z0-9+/=]+)' \| base64 --decode/.exec(shell)?.[1];
    expect(encoded).toBeDefined();
    expect(Buffer.from(encoded!, "base64").toString("utf8")).toBe(plist);
    expect(shell).toContain("mktemp '/Library/LaunchDaemons/.dev.keyloom.kanata.XXXXXX'");
    expect(shell).toContain("mktemp '/Library/Application Support/keyloom/.kanata.XXXXXX'");
  });

  test("a hash that isn't hex never reaches the script", () => {
    expect(() => daemonInstallScript(install("<plist/>", "/k", "abc; rm -rf /"))).toThrow();
  });

  test("the install script parses as shell", async () => {
    const script = daemonInstallScript(install(`<plist>it's "a" $(x) \`y\`</plist>`, `/opt/it's "a" $(x)/kanata`));
    const proc = Bun.spawn(["/bin/sh", "-n", "-c", script], { stderr: "pipe" });
    expect(await proc.exited).toBe(0);
  });

  /**
   * Runs the script for real against temporary destinations, with `chown` and `launchctl` replaced by scripts that only log, and
   * `mktemp`, `cp` and `touch` by ones that log and run the real program. `fail` makes one of them exit 1 when its arguments match a
   * shell `case` pattern, printing nothing, so any reason on stderr is the script's own. `swap` replaces kanata after its hash was read,
   * as a process of the person's could while the password dialog is open.
   */
  async function runInstall(opts: { fail?: { program: string; when: string }; swap?: boolean; oldLog?: boolean } = {}) {
    const dir = tempDir();
    const bin = join(dir, "bin");
    const dest = {
      plist: join(dir, "LaunchDaemons", "dev.keyloom.kanata.plist"), kanata: join(dir, "Application Support", "keyloom", "kanata"), log: join(dir, "log", "keyloom-kanata.log"),
    };
    mkdirSync(bin);
    mkdirSync(dirname(dest.plist));
    mkdirSync(dirname(dest.log));
    // A log left by an older setup, readable by anyone, as launchd created it before D-498.
    if (opts.oldLog) {
      writeFileSync(dest.log, "kanata's old output\n");
      chmodSync(dest.log, 0o644);
    }
    const log = join(dir, "calls.log");
    const real: Record<string, string | null> = { chown: null, launchctl: null, mktemp: "/usr/bin/mktemp", cp: "/bin/cp", touch: "/usr/bin/touch" };
    for (const [name, program] of Object.entries(real)) {
      const failing = opts.fail?.program === name ? `case "$*" in ${opts.fail.when}) exit 1;; esac\n` : "";
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\n${failing}${program === null ? "exit 0" : `exec ${program} "$@"`}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const source = writeFakeKanataBinary(tempDir());
    const sha256 = (await fileSha256(source))!;
    if (opts.swap) writeFileSync(source, "#!/bin/sh\necho swapped\n");
    const plist = launchDaemonPlist({ kanataPath: dest.kanata, configPath: "/tmp/keyloom.kbd", port: 10000 });
    const proc = Bun.spawn(["/bin/sh", "-c", daemonInstallScript({ plist, kanata: { source, sha256 } }, dest)], { env: { PATH: `${bin}:/usr/bin:/bin` }, stderr: "pipe" });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    return {
      code, stderr, dest, plist, source, sha256, calls,
      plists: readdirSync(dirname(dest.plist)), kanatas: existsSync(dirname(dest.kanata)) ? readdirSync(dirname(dest.kanata)) : [],
    };
  }

  test("the script copies kanata, mode 755, installs exactly the plist it carries, mode 644, makes the log root's alone, then bootstraps it", async () => {
    const r = await runInstall();
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(await fileSha256(r.dest.kanata)).toBe(r.sha256);
    expect(statSync(r.dest.kanata).mode & 0o777).toBe(0o755);
    expect(statSync(dirname(r.dest.kanata)).mode & 0o777).toBe(0o755);
    expect(readFileSync(r.dest.plist, "utf8")).toBe(r.plist);
    expect(statSync(r.dest.plist).mode & 0o777).toBe(0o644);
    expect(statSync(r.dest.log).mode & 0o777).toBe(0o600);
    expect(r.plists).toEqual(["dev.keyloom.kanata.plist"]);
    expect(r.kanatas).toEqual(["kanata"]);
    const owned = r.calls.filter((c) => c.startsWith("chown") || c.startsWith("launchctl"));
    expect(owned.slice(0, 3)).toEqual([`chown root:wheel ${dirname(r.dest.kanata)}`, expect.stringMatching(/^chown root:wheel .*\/\.kanata\.\w+$/), expect.stringMatching(/^chown root:wheel .*\.dev\.keyloom\.kanata\.\w+$/)]);
    // The log is created and made root's before launchd is asked to start anything that writes to it.
    expect(owned.slice(3)).toEqual([`chown root:wheel ${r.dest.log}`, "launchctl bootout system/dev.keyloom.kanata", `launchctl bootstrap system ${r.dest.plist}`]);
    expect(r.calls.indexOf(`touch ${r.dest.log}`)).toBeLessThan(r.calls.indexOf(`chown root:wheel ${r.dest.log}`));
  });

  test("a log an older setup left readable by anyone becomes root's alone, and keeps what it held", async () => {
    const r = await runInstall({ oldLog: true });
    expect(r.code).toBe(0);
    expect(statSync(r.dest.log).mode & 0o777).toBe(0o600);
    expect(readFileSync(r.dest.log, "utf8")).toBe("kanata's old output\n");
  });

  /** A failed run: exit 1, the reason on stderr with its code, and no temporary file left behind. */
  const expectStopped = (r: Awaited<ReturnType<typeof runInstall>>, code: string) => {
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^keyloom setup stopped \\(${code}\\): \\S.*\\n$`));
    expect(rootScriptFailure(r.stderr)).toMatchObject({ code });
    expect(r.plists.filter((f) => f.startsWith("."))).toEqual([]);
    expect(r.kanatas.filter((f) => f.startsWith("."))).toEqual([]);
  };

  test("a kanata swapped after keyloom read it is refused with its reason: nothing installed, nothing bootstrapped", async () => {
    const r = await runInstall({ swap: true });
    expectStopped(r, "kanata_swapped");
    expect(r.stderr).toContain(`kanata at ${r.source} changed after keyloom checked it`);
    expect(r.kanatas).toEqual([]);
    expect(r.plists).toEqual([]);
    expect(r.calls.some((c) => c.startsWith("launchctl"))).toBe(false);
  });

  // Each step that can fail, the code it reports, and whether kanata's copy was already in place when it stopped.
  const failures: Array<{ name: string; fail: { program: string; when: string }; code: string; copied: boolean }> = [
    { name: "the folder can't be made root's", fail: { program: "chown", when: "*'keyloom'" }, code: "root_copy_failed", copied: false },
    { name: "no temporary file for kanata", fail: { program: "mktemp", when: "*'.kanata.'*" }, code: "root_copy_failed", copied: false },
    { name: "kanata can't be read", fail: { program: "cp", when: "*" }, code: "root_copy_failed", copied: false },
    { name: "kanata's copy can't be made root's", fail: { program: "chown", when: "*'/.kanata.'*" }, code: "root_copy_failed", copied: false },
    { name: "no temporary file for the plist", fail: { program: "mktemp", when: "*'.dev.keyloom'*" }, code: "root_plist_failed", copied: true },
    { name: "the plist can't be made root's", fail: { program: "chown", when: "*'.dev.keyloom'*" }, code: "root_plist_failed", copied: true },
    { name: "the log can't be created", fail: { program: "touch", when: "*" }, code: "root_log_failed", copied: true },
    { name: "the log can't be made root's", fail: { program: "chown", when: "*'keyloom-kanata.log'" }, code: "root_log_failed", copied: true },
  ];
  for (const f of failures) {
    test(`${f.name}: it says why, and starts nothing`, async () => {
      const r = await runInstall({ fail: f.fail });
      expectStopped(r, f.code);
      expect(r.kanatas).toEqual(f.copied ? ["kanata"] : []);
      if (f.code !== "root_log_failed") expect(r.plists).toEqual([]);
      expect(r.calls.some((c) => c.startsWith("launchctl"))).toBe(false);
    });
  }

  test("launchd refusing the daemon twice says so", async () => {
    const r = await runInstall({ fail: { program: "launchctl", when: "bootstrap*" } });
    expectStopped(r, "root_start_failed");
    expect(r.calls.filter((c) => c.startsWith("launchctl bootstrap"))).toHaveLength(2);
  });

  test("osascript's error line gives back the script's code and reason", () => {
    const out = "0:24: execution error: keyloom setup stopped (kanata_swapped): kanata at /opt/homebrew/bin/kanata changed after keyloom checked it, so nothing was installed. Set kanata up again. (1)";
    expect(rootScriptFailure(out)).toEqual({ code: "kanata_swapped", reason: "kanata at /opt/homebrew/bin/kanata changed after keyloom checked it, so nothing was installed. Set kanata up again." });
    expect(rootScriptFailure("0:24: execution error: The command exited with a non-zero status. (1)")).toBeNull();
    expect(rootScriptFailure("keyloom setup stopped (made_up): no")).toBeNull();
  });
});

describe("System Settings panes", () => {
  test("the wire's list and the app's list are the same names", () => {
    expect([...SettingsPaneSchema.options].sort()).toEqual([...SETTINGS_PANE_NAMES].sort());
    expect(SettingsPaneSchema.safeParse("x-apple.systempreferences:anything").success).toBe(false);
  });

  test("opens the pane's own URL on macOS, and nothing elsewhere", async () => {
    const r = recorder();
    expect(await openSettingsPane("input_monitoring", { run: r.run, platform: "darwin" })).toEqual({ ok: true });
    expect(r.calls).toEqual([["open", SETTINGS_PANES.input_monitoring]]);
    expect(SETTINGS_PANES.input_monitoring).toContain("Privacy_ListenEvent");
    const linux = recorder();
    expect(await openSettingsPane("accessibility", { run: linux.run, platform: "linux" })).toMatchObject({ ok: false, code: "unsupported_platform" });
    expect(linux.calls).toEqual([]);
  });

  test("Karabiner-Elements opens as an app, and a failure names it (R3-21)", async () => {
    const r = recorder();
    expect(await openSettingsPane("karabiner_elements", { run: r.run, platform: "darwin" })).toEqual({ ok: true });
    expect(r.calls).toEqual([["open", "/Applications/Karabiner-Elements.app"]]);
    const failing: Runner = async () => ({ code: 1, out: "Unable to find application" });
    expect(await openSettingsPane("karabiner_elements", { run: failing, platform: "darwin" })).toMatchObject({ ok: false, reason: expect.stringContaining("macOS didn't open Karabiner-Elements") });
  });
});

describe("installing kanata", () => {
  const signal = () => new AbortController().signal;

  test("runs brew install kanata, streams its lines, and checks kanata is there after", async () => {
    const st = streamer({ lines: ["==> Fetching kanata", "==> Pouring kanata"] });
    const lines: string[] = [];
    expect(await installKanata(deps(recorder().run, { stream: st.stream }), "install", { signal: signal(), onLine: (l) => lines.push(l) })).toEqual({ ok: true });
    expect(st.calls).toEqual([["/opt/homebrew/bin/brew", "install", "kanata"]]);
    expect(lines).toEqual(["==> Fetching kanata", "==> Pouring kanata"]);
  });

  test("Update kanata is brew upgrade kanata", async () => {
    const st = streamer();
    expect(await installKanata(deps(recorder().run, { stream: st.stream }), "upgrade", { signal: signal(), onLine: () => {} })).toEqual({ ok: true });
    expect(st.calls).toEqual([["/opt/homebrew/bin/brew", "upgrade", "kanata"]]);
  });

  test("no Homebrew is a code, not a command run", async () => {
    const st = streamer();
    expect(await installKanata(deps(recorder().run, { stream: st.stream, brew: () => undefined }), "install", { signal: signal(), onLine: () => {} })).toMatchObject({ ok: false, code: "no_brew" });
    expect(st.calls).toEqual([]);
  });

  test("a failed brew says its last line", async () => {
    const st = streamer({ lines: ["==> Fetching kanata", "Error: No such file or directory"], code: 1 });
    expect(await installKanata(deps(recorder().run, { stream: st.stream }), "install", { signal: signal(), onLine: () => {} }))
      .toEqual({ ok: false, code: "failed", reason: "Homebrew couldn't install kanata: Error: No such file or directory" });
  });
});

describe("reading kanata's answer to the cmd probe (D-498)", () => {
  test("valid is allows; kanata's own refusal, even wrapped by miette, is refuses; anything else is unknown", () => {
    expect(cmdCheckResult({ ok: true, output: "config file is valid" })).toBe("allows");
    expect(cmdCheckResult({ ok: false, output: "  × cmd is not\n  │ enabled for this kanata executable" })).toBe("refuses");
    expect(cmdCheckResult({ ok: false, output: "Error: unexpected token" })).toBe("unknown");
    // A config kanata calls valid, whatever else it printed, is one that would run programs.
    expect(cmdCheckResult({ ok: true, output: "cmd is not enabled\nconfig file is valid" })).toBe("allows");
  });
});

describe("the Homebrew runner", () => {
  /** Runs `script` through the real runner. The preload's guard is lifted only for this stand-in, which never runs brew. */
  async function runScript(script: string, abortAfterMs?: number) {
    const before = process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS;
    process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS = "0";
    try {
      const controller = new AbortController();
      const lines: string[] = [];
      if (abortAfterMs !== undefined) setTimeout(() => controller.abort(), abortAfterMs);
      const started = Date.now();
      const r = await streamRunner(["/bin/sh", "-c", script], { signal: controller.signal, onLine: (l) => lines.push(l) });
      return { ...r, lines, ms: Date.now() - started };
    } finally {
      process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS = before;
    }
  }

  test("streams lines, carriage-return redraws included, and the exit code", async () => {
    const r = await runScript(`printf 'one\\ntwo\\rthree\\n'; echo err >&2; exit 3`);
    expect(r).toMatchObject({ code: 3, aborted: false });
    expect(r.lines.sort()).toEqual(["err", "one", "three", "two"]);
  });

  test("Cancel stops the whole process group, children holding the output included, at once", async () => {
    // As brew runs Ruby, which runs curl: the child keeps the pipe open after its parent dies.
    const r = await runScript("echo started; sleep 30 & wait", 300);
    expect(r.aborted).toBe(true);
    expect(r.lines).toEqual(["started"]);
    expect(r.ms).toBeLessThan(5000);
  });

  test("the test preload refuses it, so a forgotten fake never runs brew", async () => {
    expect(process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS).toBe("1");
    await expect(streamRunner(["brew", "install", "kanata"], { signal: new AbortController().signal, onLine: () => {} })).rejects.toThrow("refusing");
  });
});

describe("the install job", () => {
  test("follows one install: running with Homebrew's last lines, then succeeded; a second press joins it", async () => {
    let finish!: () => void;
    const st = streamer({ lines: ["==> Fetching kanata", "", "==> Pouring kanata"], hold: new Promise<void>((r) => (finish = r)) });
    const job = kanataInstaller(deps(recorder().run, { stream: st.stream }));
    expect(job.state()).toEqual(IDLE_INSTALL);
    expect(job.start("install")).toEqual({ ok: true });
    expect(job.start("install")).toEqual({ ok: true });
    await Bun.sleep(0);
    expect(job.state()).toEqual({ state: "running", action: "install", log: ["==> Fetching kanata", "==> Pouring kanata"], failure: null });
    finish();
    await job.settled();
    expect(job.state()).toMatchObject({ state: "succeeded", action: "install", failure: null });
    expect(st.calls).toHaveLength(1);
  });

  test("Cancel stops Homebrew and ends in cancelled; with nothing running it says so", async () => {
    const st = streamer({ hold: new Promise<void>(() => {}) });
    const job = kanataInstaller(deps(recorder().run, { stream: st.stream }));
    expect(job.cancel()).toMatchObject({ ok: false, code: "not_running" });
    job.start("upgrade");
    expect(job.cancel()).toEqual({ ok: true });
    await job.settled();
    expect(job.state()).toMatchObject({ state: "cancelled", action: "upgrade", failure: { code: "cancelled" } });
  });

  test("a failure keeps its reason and Homebrew's lines until the next start", async () => {
    const st = streamer({ lines: ["Error: Permission denied @ dir_s_mkdir - /opt/homebrew/Cellar"], code: 1 });
    const job = kanataInstaller(deps(recorder().run, { stream: st.stream }));
    job.start("install");
    await job.settled();
    expect(job.state()).toMatchObject({ state: "failed", log: ["Error: Permission denied @ dir_s_mkdir - /opt/homebrew/Cellar"], failure: { code: "failed", reason: expect.stringContaining("Permission denied") } });
  });

  test("a runner that throws is a failure, not a job stuck running", async () => {
    const job = kanataInstaller(deps(recorder().run, { stream: async () => { throw new Error("refusing to run brew in a test"); } }));
    job.start("install");
    await job.settled();
    expect(job.state()).toMatchObject({ state: "failed", failure: { reason: "refusing to run brew in a test" } });
  });

  test("no Homebrew answers at once and starts nothing", () => {
    const job = kanataInstaller(deps(recorder().run, { brew: () => undefined }));
    expect(job.start("install")).toMatchObject({ ok: false, code: "no_brew" });
    expect(job.state().state).toBe("idle");
  });
});

describe("starting kanata", () => {
  test("checks kanata can't run programs, then asks macOS for the password once to copy it and install the daemon (D-498)", async () => {
    const world = (w = remapperWorld());
    const r = recorder();
    expect(await startKanataDaemon(MAC, deps(r.run, { kanata: () => world.kanataBin, remapper: world.over }))).toEqual({ ok: true });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]?.[3]).toBe("/usr/bin/osascript");
    const script = rootScriptOf(r.calls[0] ?? []);
    // The plist names keyloom.kbd under the home folder, but the script carries it encoded and never names the home folder itself.
    expect(script).not.toContain(world.home);
    const carried = /printf %s '([A-Za-z0-9+/=]+)'/.exec(script)?.[1] ?? "";
    const plist = Buffer.from(carried, "base64").toString("utf8");
    expect(plist).toContain(`<string>${world.paths.kbd}</string>`);
    // The daemon runs the root-owned copy, and the copy must hash to the kanata keyloom checked.
    expect(plist).toContain(`<string>${ROOT_KANATA_PATH}</string>`);
    expect(script).toContain(`= ${await fileSha256(world.kanataBin)} ]`);
    // The copy in keyloom's folder is for the CLI's printed command; the privileged step never reads it.
    expect(readFileSync(`${world.paths.dir}/dev.keyloom.kanata.plist`, "utf8")).toBe(plist);
  });

  test("a kanata that accepts a config asking for cmd is never given root", async () => {
    const world = (w = remapperWorld());
    const r = recorder();
    const withCmd = writeFakeKanataBinary(tempDir(), "cmd");
    expect(await startKanataDaemon(MAC, deps(r.run, { kanata: () => withCmd, remapper: world.over }))).toMatchObject({ ok: false, code: "kanata_allows_cmd" });
    expect(r.calls).toEqual([]);
  });

  test("a kanata whose answer keyloom can't read is refused too", async () => {
    const world = (w = remapperWorld());
    const r = recorder();
    const garbled = writeFakeKanataBinary(tempDir(), "garbled");
    expect(await startKanataDaemon(MAC, deps(r.run, { kanata: () => garbled, remapper: world.over }))).toMatchObject({ ok: false, code: "kanata_cmd_unknown", reason: expect.stringContaining("unexpected token") });
    expect(r.calls).toEqual([]);
  });

  test("a cancelled password dialog says so", async () => {
    const world = (w = remapperWorld());
    const r = recorder({ osascript: { code: 1, out: "0:94: execution error: User canceled. (-128)" } });
    expect(await startKanataDaemon(MAC, deps(r.run, { kanata: () => world.kanataBin, remapper: world.over }))).toMatchObject({ ok: false, code: "cancelled" });
  });

  test("a root script that stopped gives its code and reason, not osascript's status line", async () => {
    const world = (w = remapperWorld());
    const r = recorder({ osascript: { code: 1, out: "0:24: execution error: keyloom setup stopped (root_start_failed): macOS did not start the kanata background service (launchctl bootstrap failed). (1)" } });
    expect(await startKanataDaemon(MAC, deps(r.run, { kanata: () => world.kanataBin, remapper: world.over }))).toEqual({ ok: false, code: "root_start_failed", reason: "macOS did not start the kanata background service (launchctl bootstrap failed)." });
    const old = recorder({ osascript: { code: 1, out: "0:24: execution error: The command exited with a non-zero status. (1)" } });
    expect(await startKanataDaemon(MAC, deps(old.run, { kanata: () => world.kanataBin, remapper: world.over }))).toMatchObject({ ok: false, code: "failed" });
  });

  test("with no kanata it asks for nothing", async () => {
    const world = (w = remapperWorld());
    const r = recorder();
    expect(await startKanataDaemon(MAC, deps(r.run, { kanata: () => undefined, remapper: world.over }))).toMatchObject({ ok: false, code: "no_kanata" });
    expect(r.calls).toEqual([]);
  });
});

describe("the checklist's read", () => {
  test("every finding carries its code, and Homebrew decides whether Install can run", async () => {
    const world = (w = remapperWorld());
    const status = await remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe: machine() } }));
    expect(status).toMatchObject({ platform: "darwin", canInstall: true, install: IDLE_INSTALL, kanata: { version: null, wanted: "1.12.0", update: null } });
    const codes = status.findings.map((f) => f.code);
    expect(codes).toContain("kanata_missing");
    expect(codes).toContain("permissions");
    expect(codes).toContain("daemon_missing");
    expect(codes).toContain("port_closed");
    expect(status.driverVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // The doctor's fixes are CLI words; the page reads codes, so they are not sent.
    expect(status.findings.every((f) => !("fix" in f))).toBe(true);
    const noBrew = await remapperSetupStatus(MAC, deps(recorder().run, { brew: () => undefined, remapper: { ...world.over, probe: machine() } }));
    expect(noBrew.canInstall).toBe(false);
  });

  test("the install job's state goes out as it is", async () => {
    const world = (w = remapperWorld());
    const running = { state: "running", action: "install", log: ["==> Pouring kanata"], failure: null } as const;
    const status = await remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe: machine() } }), { ...running, log: [...running.log] });
    expect(status.install).toEqual({ ...running, log: ["==> Pouring kanata"] });
  });

  /**
   * A machine where the daemon is installed and kanata on PATH and the root copy hash as given. kanata on PATH reports `version` and its
   * links lead to `real`; the root copy reports `copyVersion`.
   */
  const installed = (path: string, copy: string | undefined, o: { onPath?: string; real?: string; version?: string; copyVersion?: string } = {}) => machine({
    kanataBin: () => path,
    kanataVersion: async (p) => (p === ROOT_KANATA_PATH ? (o.copyVersion ?? "1.11.0") : (o.version ?? "1.12.0")),
    realPath: (p) => (p === path ? (o.real ?? path) : p),
    exists: (p) => p.endsWith("dev.keyloom.kanata.plist") || (p === ROOT_KANATA_PATH && copy !== undefined),
    fileHash: async (p) => (p === ROOT_KANATA_PATH ? copy : (o.onPath ?? "1".repeat(64))),
  });
  const CELLAR = "/opt/homebrew/Cellar/kanata/1.12.0/bin/kanata";

  test("a kanata Homebrew updated since setup is kanata_updated, names its path and the copy's version, and needs the root command again", async () => {
    const world = (w = remapperWorld());
    const machineAfterUpdate = installed("/opt/homebrew/bin/kanata", "2".repeat(64), { real: CELLAR, version: "1.12.0", copyVersion: "1.11.0" });
    const status = await remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe: machineAfterUpdate } }));
    expect(status.findings.find((f) => f.code === "kanata_updated")).toMatchObject({ status: "warn" });
    expect(status.kanata).toMatchObject({ path: CELLAR, copyVersion: "1.11.0" });
    expect((await remapperDoctor(MAC, { ...world.over, probe: machineAfterUpdate })).rootCommand).toContain("sudo sh -c");
    const same = await remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe: installed("/opt/homebrew/bin/kanata", "1".repeat(64), { real: CELLAR }) } }));
    expect(same.findings.find((f) => f.code === "kanata_updated")).toMatchObject({ status: "ok" });
  });

  test("a kanata that changed any other way is kanata_replaced, with no root command (review of #279)", async () => {
    const world = (w = remapperWorld());
    const cases = [
      // Replaced in place: same Cellar folder, same version as the copy.
      { real: CELLAR, version: "1.12.0", copyVersion: "1.12.0", reinstall: true },
      // A Cellar folder whose name isn't the version the binary reports.
      { real: "/opt/homebrew/Cellar/kanata/1.13.0/bin/kanata", version: "1.12.0", copyVersion: "1.11.0", reinstall: true },
      // Not Homebrew's at all.
      { real: "/Users/x/.cargo/bin/kanata", version: "1.12.0", copyVersion: "1.11.0", reinstall: false },
    ];
    for (const c of cases) {
      const probe = installed("/opt/homebrew/bin/kanata", "2".repeat(64), c);
      const status = await remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe } }));
      expect(status.findings.find((f) => f.code === "kanata_replaced")).toMatchObject({ status: "warn" });
      expect(status.findings.some((f) => f.code === "kanata_updated")).toBe(false);
      expect(status.kanata).toMatchObject({ path: c.real, version: c.version, copyVersion: c.copyVersion });
      const doctor = await remapperDoctor(MAC, { ...world.over, probe });
      expect(doctor.rootCommand).toBeNull();
      expect(doctor.findings.find((f) => f.code === "kanata_replaced")?.fix).toEqual(c.reinstall ? "brew reinstall kanata" : expect.stringContaining("if you installed this kanata yourself"));
    }
  });

  test("Homebrew's Cellar names the version, with a bottle rebuild's suffix dropped", () => {
    expect(cellarVersion("/opt/homebrew/Cellar/kanata/1.12.0_1/bin/kanata")).toBe("1.12.0");
    expect(cellarVersion("/usr/local/Cellar/kanata/1.11.0/bin/kanata")).toBe("1.11.0");
    expect(cellarVersion("/opt/homebrew/bin/kanata")).toBeUndefined();
    expect(looksLikeHomebrewUpdate(CELLAR, "1.12.0", "1.11.0")).toBe(true);
    expect(looksLikeHomebrewUpdate(CELLAR, "1.12.0", "1.12.0")).toBe(false);
    expect(looksLikeHomebrewUpdate(CELLAR, undefined, "1.11.0")).toBe(false);
  });

  test("a daemon set up before the root copy existed is daemon_outdated", async () => {
    const world = (w = remapperWorld());
    const status = await remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe: installed("/opt/homebrew/bin/kanata", undefined) } }));
    expect(status.findings.find((f) => f.code === "daemon_outdated")).toMatchObject({ status: "warn" });
    expect(status.findings.some((f) => f.code === "kanata_updated")).toBe(false);
  });

  test("the checklist's read doesn't hash or run kanata for a root command it never shows (review of #279)", async () => {
    const world = (w = remapperWorld());
    const dir = tempDir();
    const runs = join(dir, "runs.log");
    const kanata = writeFakeKanataBinary(dir);
    writeFileSync(kanata, readFileSync(kanata, "utf8").replace("#!/bin/sh\n", `#!/bin/sh\necho "$0" >> '${runs}'\n`));
    // No daemon yet, so the doctor needs root.
    const over = { ...world.over, kanataBin: () => kanata, probe: machine() };
    await remapperSetupStatus(MAC, deps(recorder().run, { remapper: over }));
    expect(existsSync(runs)).toBe(false);
    expect((await remapperDoctor(MAC, over)).rootCommand).toContain("sudo sh -c");
    expect(existsSync(runs)).toBe(true);
  });

  test("the cmd probe runs a private copy of the bytes keyloom hashed, not the file on PATH (review of #279)", async () => {
    const world = (w = remapperWorld());
    const dir = tempDir();
    const runs = join(dir, "runs.log");
    const kanata = writeFakeKanataBinary(dir);
    writeFileSync(kanata, readFileSync(kanata, "utf8").replace("#!/bin/sh\n", `#!/bin/sh\necho "$0" >> '${runs}'\n`));
    const setup = await setupRemapper(MAC, { ...world.over, kanataBin: () => kanata });
    expect(setup.install?.kanata).toEqual({ source: realpathSync(kanata), sha256: (await fileSha256(kanata))! });
    const ran = readFileSync(runs, "utf8").trim().split("\n");
    expect(ran).toHaveLength(1);
    expect(ran[0]).not.toBe(kanata);
    expect(ran[0]).toMatch(/keyloom-cmd-probe-[^/]+\/kanata$/);
    // The copy is gone once the probe has answered.
    expect(existsSync(ran[0]!)).toBe(false);
  });
});

describe("updating kanata", () => {
  test("compareVersions orders dotted versions by number", () => {
    expect(compareVersions("1.11.0", "1.12.0")).toBe(-1);
    expect(compareVersions("1.12.0", "1.12.0")).toBe(0);
    expect(compareVersions("1.13.0-prerelease-1", "1.12.0")).toBe(1);
    expect(compareVersions("1.9", "1.10.0")).toBe(-1);
  });

  test("Homebrew updates an older Homebrew kanata; anything else gets the release page", () => {
    const brew = "/opt/homebrew/Cellar/kanata/1.11.0/bin/kanata";
    expect(kanataUpdate({ bin: brew, version: "1.11.0" }, "1.12.0", true)).toBe("brew");
    expect(kanataUpdate({ bin: brew, version: "1.12.0" }, "1.12.0", true)).toBeNull();
    expect(kanataUpdate(null, "1.12.0", true)).toBeNull();
    // Homebrew can't go back, can't run without itself, and doesn't own a kanata it didn't install.
    expect(kanataUpdate({ bin: brew, version: "1.13.0" }, "1.12.0", true)).toBe("link");
    expect(kanataUpdate({ bin: brew, version: "1.11.0" }, "1.12.0", false)).toBe("link");
    expect(kanataUpdate({ bin: "/Users/x/.cargo/bin/kanata", version: "1.11.0" }, "1.12.0", true)).toBe("link");
    expect(kanataUpdate({ bin: brew, version: undefined }, "1.12.0", true)).toBe("link");
  });

  test("after an update that left kanata older, the read offers the release page, not Update kanata again (review of #279)", async () => {
    const world = (w = remapperWorld());
    const brew = "/opt/homebrew/Cellar/kanata/1.11.0/bin/kanata";
    const probe = machine({ kanataBin: () => brew, kanataVersion: async () => "1.11.0" });
    const read = (install: KanataInstall) => remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe } }), install);
    expect((await read(IDLE_INSTALL)).kanata.update).toBe("brew");
    expect((await read({ state: "running", action: "upgrade", log: [], failure: null })).kanata.update).toBe("brew");
    expect((await read({ state: "succeeded", action: "upgrade", log: ["Warning: kanata 1.11.0 already installed"], failure: null })).kanata.update).toBe("link");
  });

  test("Reinstall kanata is brew reinstall kanata, through the same job", async () => {
    const st = streamer();
    expect(await installKanata(deps(recorder().run, { stream: st.stream }), "reinstall", { signal: new AbortController().signal, onLine: () => {} })).toEqual({ ok: true });
    expect(st.calls).toEqual([["/opt/homebrew/bin/brew", "reinstall", "kanata"]]);
    const failing = streamer({ lines: ["Error: boom"], code: 1 });
    expect(await installKanata(deps(recorder().run, { stream: failing.stream }), "reinstall", { signal: new AbortController().signal, onLine: () => {} })).toMatchObject({ reason: "Homebrew couldn't reinstall kanata: Error: boom" });
  });
});
