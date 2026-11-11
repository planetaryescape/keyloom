// Setting kanata up from the app (D-493) and opening System Settings panes (D-492), with an injected runner: nothing here runs
// brew, osascript or open. The quoting is checked against a real /bin/sh with printf, which only prints.
import { afterEach, describe, expect, test } from "bun:test";
import {
  ADMIN_PROMPT, SETTINGS_PANES, SETTINGS_PANE_NAMES, type Runner, type SetupDeps, adminCommand, appleScriptString, daemonInstallScript,
  installKanata, openSettingsPane, remapperSetupStatus, shellQuote, startKanataDaemon,
} from "../../src/app/remapper-setup.ts";
import { SettingsPaneSchema } from "../../src/api/system-remapper.ts";
import type { DoctorProbe } from "../../src/firmware/kanata/doctor.ts";
import { MAC, remapperWorld } from "../helpers/remapper-world.ts";

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
    const plist = `/Users/o'brien/Library/Application Support/kanata/dev.keyloom.kanata.plist`;
    const cmd = adminCommand(daemonInstallScript(plist), ADMIN_PROMPT);
    expect(cmd.slice(0, 2)).toEqual(["osascript", "-e"]);
    expect(cmd).toHaveLength(3);
    const m = /^do shell script (".*") with prompt (".*") with administrator privileges$/s.exec(cmd[2]!);
    expect(m).not.toBeNull();
    const shell = unAppleScript(m![1]!);
    expect(shell).toBe(daemonInstallScript(plist));
    expect(unAppleScript(m![2]!)).toContain("kanata");
    // The plist path reaches cp as one word, quote and all.
    expect(shell.startsWith(`cp ${shellQuote(plist)} '/Library/LaunchDaemons/dev.keyloom.kanata.plist'`)).toBe(true);
    expect(shell).toContain("launchctl bootstrap system '/Library/LaunchDaemons/dev.keyloom.kanata.plist'");
    expect(shell).not.toContain("sudo");
  });

  test("the install script parses as shell, so a path can't break it", async () => {
    const script = daemonInstallScript(`/tmp/it's "a" $(x).plist`);
    const proc = Bun.spawn(["/bin/sh", "-n", "-c", script], { stderr: "pipe" });
    expect(await proc.exited).toBe(0);
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
    expect(r.calls[0]?.[2]).toContain(world.home);
    expect(await Bun.file(`${world.paths.dir}/dev.keyloom.kanata.plist`).exists()).toBe(true);
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
