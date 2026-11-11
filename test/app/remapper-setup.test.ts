// Setting kanata up from the app (D-493) and opening System Settings panes (D-492), with an injected runner: nothing here runs
// brew, osascript or open. The quoting is checked against a real /bin/sh with printf, which only prints.
import { afterEach, describe, expect, test } from "bun:test";
import {
  ADMIN_PROMPT, IDLE_INSTALL, SETTINGS_PANES, SETTINGS_PANE_NAMES, type Runner, type SetupDeps, type StreamRunner, adminCommand, appleScriptString,
  compareVersions, daemonInstallScript, installKanata, kanataInstaller, kanataUpdate, openSettingsPane, remapperSetupStatus, shellQuote, startKanataDaemon,
} from "../../src/app/remapper-setup.ts";
import { fileSha256 } from "../../src/firmware/kanata/binary.ts";
import { ROOT_KANATA_PATH } from "../../src/firmware/kanata/plist.ts";
import { writeFakeKanataBinary } from "../helpers/fake-kanata.ts";
import { SettingsPaneSchema } from "../../src/api/system-remapper.ts";
import type { DoctorProbe } from "../../src/firmware/kanata/doctor.ts";
import { launchDaemonPlist } from "../../src/firmware/kanata/plist.ts";
import { MAC, remapperWorld } from "../helpers/remapper-world.ts";
import { tempDir } from "../helpers/tmp.ts";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
    return answers[(cmd[0] ?? "").split("/").at(-1) ?? ""] ?? { code: 0, out: "" };
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
    expect(cmd.slice(0, 2)).toEqual(["osascript", "-e"]);
    expect(cmd).toHaveLength(3);
    const m = /^do shell script (".*") with prompt (".*") with administrator privileges$/s.exec(cmd[2]!);
    expect(m).not.toBeNull();
    const shell = unAppleScript(m![1]!);
    expect(shell).toBe(daemonInstallScript(install(plist)));
    expect(unAppleScript(m![2]!)).toContain("kanata");
    expect(shell).toContain("mv -f \"$t\" '/Library/LaunchDaemons/dev.keyloom.kanata.plist'");
    expect(shell).toContain("launchctl bootstrap system '/Library/LaunchDaemons/dev.keyloom.kanata.plist'");
    expect(shell).not.toContain("sudo");
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
    expect(shell).toContain(`cp '/opt/homebrew/Cellar/kanata/1.12.0/bin/kanata' "$b" && [ "$(shasum -a 256 "$b" | cut -d ' ' -f 1)" = ${SHA} ] && chown root:wheel "$b" && chmod 755 "$b" && mv -f "$b" '${ROOT_KANATA_PATH}'`);
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
   * Runs the script for real against temporary destinations, with `chown` and `launchctl` replaced by scripts that only log. `swap`
   * replaces kanata after its hash was read, as a process of the person's could while the password dialog is open.
   */
  async function runInstall(opts: { chownExit?: number; swap?: boolean } = {}) {
    const dir = tempDir();
    const bin = join(dir, "bin");
    const dest = { plist: join(dir, "LaunchDaemons", "dev.keyloom.kanata.plist"), kanata: join(dir, "Application Support", "keyloom", "kanata") };
    mkdirSync(bin);
    mkdirSync(dirname(dest.plist));
    const log = join(dir, "calls.log");
    for (const [name, exit] of [["chown", opts.chownExit ?? 0], ["launchctl", 0]] as const) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\nexit ${exit}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const source = writeFakeKanataBinary(tempDir());
    const sha256 = (await fileSha256(source))!;
    if (opts.swap) writeFileSync(source, "#!/bin/sh\necho swapped\n");
    const plist = launchDaemonPlist({ kanataPath: dest.kanata, configPath: "/tmp/keyloom.kbd", port: 10000 });
    const proc = Bun.spawn(["/bin/sh", "-c", daemonInstallScript({ plist, kanata: { source, sha256 } }, dest)], { env: { PATH: `${bin}:/usr/bin:/bin` }, stderr: "pipe" });
    const code = await proc.exited;
    const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    return { code, dest, plist, source, sha256, calls, plists: readdirSync(dirname(dest.plist)), kanatas: existsSync(dirname(dest.kanata)) ? readdirSync(dirname(dest.kanata)) : [] };
  }

  test("the script copies kanata, mode 755, installs exactly the plist it carries, mode 644, then bootstraps it", async () => {
    const r = await runInstall();
    expect(r.code).toBe(0);
    expect(await fileSha256(r.dest.kanata)).toBe(r.sha256);
    expect(statSync(r.dest.kanata).mode & 0o777).toBe(0o755);
    expect(statSync(dirname(r.dest.kanata)).mode & 0o777).toBe(0o755);
    expect(readFileSync(r.dest.plist, "utf8")).toBe(r.plist);
    expect(statSync(r.dest.plist).mode & 0o777).toBe(0o644);
    expect(r.plists).toEqual(["dev.keyloom.kanata.plist"]);
    expect(r.kanatas).toEqual(["kanata"]);
    expect(r.calls.slice(0, 3)).toEqual([`chown root:wheel ${dirname(r.dest.kanata)}`, expect.stringMatching(/^chown root:wheel .*\/\.kanata\.\w+$/), expect.stringMatching(/^chown root:wheel .*\.dev\.keyloom\.kanata\.\w+$/)]);
    expect(r.calls.slice(3)).toEqual(["launchctl bootout system/dev.keyloom.kanata", `launchctl bootstrap system ${r.dest.plist}`]);
  });

  test("a kanata swapped after keyloom read it is refused: nothing installed, nothing bootstrapped, no temporary file", async () => {
    const r = await runInstall({ swap: true });
    expect(r.code).not.toBe(0);
    expect(r.kanatas).toEqual([]);
    expect(r.plists).toEqual([]);
    expect(r.calls.some((c) => c.startsWith("launchctl"))).toBe(false);
  });

  test("a failed step installs nothing, bootstraps nothing and leaves no temporary file", async () => {
    const r = await runInstall({ chownExit: 1 });
    expect(r.code).not.toBe(0);
    expect(r.plists).toEqual([]);
    expect(r.kanatas).toEqual([]);
    expect(r.calls.every((c) => c.startsWith("chown"))).toBe(true);
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
    expect(r.calls[0]?.[0]).toBe("osascript");
    const script = r.calls[0]?.[2] ?? "";
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

  /** A machine where the daemon is installed and kanata on PATH and the root copy hash as given. */
  const installed = (path: string, copy: string | undefined, onPath = "1".repeat(64)) => machine({
    kanataBin: () => path,
    kanataVersion: async () => "1.12.0",
    exists: (p) => p.endsWith("dev.keyloom.kanata.plist") || (p === ROOT_KANATA_PATH && copy !== undefined),
    fileHash: async (p) => (p === ROOT_KANATA_PATH ? copy : onPath),
  });

  test("a kanata upgraded since setup is kanata_updated, and needs the root command again", async () => {
    const world = (w = remapperWorld());
    const status = await remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe: installed("/opt/homebrew/bin/kanata", "2".repeat(64)) } }));
    expect(status.findings.find((f) => f.code === "kanata_updated")).toMatchObject({ status: "warn" });
    const same = await remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe: installed("/opt/homebrew/bin/kanata", "1".repeat(64)) } }));
    expect(same.findings.find((f) => f.code === "kanata_updated")).toMatchObject({ status: "ok" });
  });

  test("a daemon set up before the root copy existed is daemon_outdated", async () => {
    const world = (w = remapperWorld());
    const status = await remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe: installed("/opt/homebrew/bin/kanata", undefined) } }));
    expect(status.findings.find((f) => f.code === "daemon_outdated")).toMatchObject({ status: "warn" });
    expect(status.findings.some((f) => f.code === "kanata_updated")).toBe(false);
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
});
