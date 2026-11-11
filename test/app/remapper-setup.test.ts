// Setting kanata up from the app (D-493) and opening System Settings panes (D-492), with an injected runner: nothing here runs
// brew, osascript or open. The quoting is checked against a real /bin/sh with printf, which only prints.
import { afterEach, describe, expect, test } from "bun:test";
import {
  ADMIN_PROMPT, SETTINGS_PANES, SETTINGS_PANE_NAMES, type Runner, type SetupDeps, adminCommand, appleScriptString, daemonInstallScript,
  installKanata, openSettingsPane, remapperSetupStatus, shellQuote, startKanataDaemon,
} from "../../src/app/remapper-setup.ts";
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

const deps = (run: Runner, over: Partial<SetupDeps> = {}): SetupDeps => ({ run, platform: "darwin", brew: () => "/opt/homebrew/bin/brew", kanata: () => "/opt/homebrew/bin/kanata", ...over });

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
    const cmd = adminCommand(daemonInstallScript(plist), ADMIN_PROMPT);
    expect(cmd.slice(0, 2)).toEqual(["osascript", "-e"]);
    expect(cmd).toHaveLength(3);
    const m = /^do shell script (".*") with prompt (".*") with administrator privileges$/s.exec(cmd[2]!);
    expect(m).not.toBeNull();
    const shell = unAppleScript(m![1]!);
    expect(shell).toBe(daemonInstallScript(plist));
    expect(unAppleScript(m![2]!)).toContain("kanata");
    expect(shell).toContain("mv -f \"$t\" '/Library/LaunchDaemons/dev.keyloom.kanata.plist'");
    expect(shell).toContain("launchctl bootstrap system '/Library/LaunchDaemons/dev.keyloom.kanata.plist'");
    expect(shell).not.toContain("sudo");
  });

  test("the root script carries the plist itself and reads no path under the person's home", () => {
    const home = `/Users/o'brien`;
    const plist = launchDaemonPlist({ kanataPath: "/opt/homebrew/bin/kanata", configPath: `${home}/Library/Application Support/kanata/keyloom.kbd`, port: 10000 });
    const shell = daemonInstallScript(plist);
    // The only paths it names are root's: the destination and a temporary file beside it.
    expect(shell).not.toContain("/Users/");
    expect(shell).not.toContain("Application Support");
    expect(shell).not.toMatch(/\bcp\b/);
    const encoded = /printf %s '([A-Za-z0-9+/=]+)' \| base64 --decode/.exec(shell)?.[1];
    expect(encoded).toBeDefined();
    expect(Buffer.from(encoded!, "base64").toString("utf8")).toBe(plist);
    expect(shell).toContain("mktemp '/Library/LaunchDaemons/.dev.keyloom.kanata.XXXXXX'");
  });

  test("the install script parses as shell", async () => {
    const script = daemonInstallScript(`<plist>it's "a" $(x) \`y\`</plist>`);
    const proc = Bun.spawn(["/bin/sh", "-n", "-c", script], { stderr: "pipe" });
    expect(await proc.exited).toBe(0);
  });

  /** Runs the script for real against a temporary destination, with `chown` and `launchctl` replaced by scripts that only log. */
  async function runInstall(chownExit: number) {
    const dir = tempDir();
    const bin = join(dir, "bin");
    const dest = join(dir, "LaunchDaemons", "dev.keyloom.kanata.plist");
    mkdirSync(bin);
    mkdirSync(dirname(dest));
    const log = join(dir, "calls.log");
    for (const [name, exit] of [["chown", chownExit], ["launchctl", 0]] as const) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\nexit ${exit}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const plist = launchDaemonPlist({ kanataPath: "/opt/homebrew/bin/kanata", configPath: "/tmp/keyloom.kbd", port: 10000 });
    const proc = Bun.spawn(["/bin/sh", "-c", daemonInstallScript(plist, dest)], { env: { PATH: `${bin}:/usr/bin:/bin` }, stderr: "pipe" });
    const code = await proc.exited;
    const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    return { code, dest, plist, calls, left: readdirSync(dirname(dest)) };
  }

  test("the script installs exactly the plist it carries, mode 644, then bootstraps it", async () => {
    const r = await runInstall(0);
    expect(r.code).toBe(0);
    expect(readFileSync(r.dest, "utf8")).toBe(r.plist);
    expect(statSync(r.dest).mode & 0o777).toBe(0o644);
    expect(r.left).toEqual(["dev.keyloom.kanata.plist"]);
    expect(r.calls[0]).toMatch(/^chown root:wheel .*\.dev\.keyloom\.kanata\.\w+$/);
    expect(r.calls.slice(1)).toEqual(["launchctl bootout system/dev.keyloom.kanata", `launchctl bootstrap system ${r.dest}`]);
  });

  test("a failed step installs nothing, bootstraps nothing and leaves no temporary file", async () => {
    const r = await runInstall(1);
    expect(r.code).not.toBe(0);
    expect(r.left).toEqual([]);
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
  test("runs brew install kanata and checks kanata is there after", async () => {
    const r = recorder();
    expect(await installKanata(deps(r.run))).toEqual({ ok: true });
    expect(r.calls).toEqual([["/opt/homebrew/bin/brew", "install", "kanata"]]);
  });

  test("no Homebrew is a code, not a command run", async () => {
    const r = recorder();
    expect(await installKanata(deps(r.run, { brew: () => undefined }))).toMatchObject({ ok: false, code: "no_brew" });
    expect(r.calls).toEqual([]);
  });

  test("a failed brew says its last line", async () => {
    const r = recorder({ brew: { code: 1, out: "==> Fetching kanata\nError: No such file or directory\n" } });
    expect(await installKanata(deps(r.run))).toEqual({ ok: false, code: "failed", reason: "Homebrew couldn't install kanata: Error: No such file or directory" });
  });
});

describe("starting kanata", () => {
  test("writes the plist in keyloom's folder, then asks macOS for the password once", async () => {
    const world = (w = remapperWorld());
    const r = recorder();
    expect(await startKanataDaemon(MAC, deps(r.run, { remapper: world.over }))).toEqual({ ok: true });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]?.[0]).toBe("osascript");
    // The plist names keyloom.kbd under the home folder, but the script carries it encoded and never names the home folder itself.
    expect(r.calls[0]?.[2]).not.toContain(world.home);
    const carried = /printf %s '([A-Za-z0-9+/=]+)'/.exec(r.calls[0]?.[2] ?? "")?.[1] ?? "";
    const plist = Buffer.from(carried, "base64").toString("utf8");
    expect(plist).toContain(`<string>${world.paths.kbd}</string>`);
    // The copy in keyloom's folder is for the CLI's printed command; the privileged step never reads it.
    expect(readFileSync(`${world.paths.dir}/dev.keyloom.kanata.plist`, "utf8")).toBe(plist);
  });

  test("a cancelled password dialog says so", async () => {
    const world = (w = remapperWorld());
    const r = recorder({ osascript: { code: 1, out: "0:94: execution error: User canceled. (-128)" } });
    expect(await startKanataDaemon(MAC, deps(r.run, { remapper: world.over }))).toMatchObject({ ok: false, code: "cancelled" });
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
    const status = await remapperSetupStatus(MAC, deps(recorder().run, { remapper: { ...world.over, probe: machine() } }), false);
    expect(status).toMatchObject({ platform: "darwin", canInstall: true, installing: false });
    const codes = status.findings.map((f) => f.code);
    expect(codes).toContain("kanata_missing");
    expect(codes).toContain("permissions");
    expect(codes).toContain("daemon_missing");
    expect(codes).toContain("port_closed");
    expect(status.driverVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // The doctor's fixes are CLI words; the page reads codes, so they are not sent.
    expect(status.findings.every((f) => !("fix" in f))).toBe(true);
    const noBrew = await remapperSetupStatus(MAC, deps(recorder().run, { brew: () => undefined, remapper: { ...world.over, probe: machine() } }), false);
    expect(noBrew.canInstall).toBe(false);
  });
});
