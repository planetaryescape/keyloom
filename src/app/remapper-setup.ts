// Setting up the MacBook remapper from the app (D-493), and opening System Settings at the pane a fix needs (D-492).
// Every outside command goes through an injected runner, so tests describe a Mac instead of changing one: no real `brew`,
// `osascript` or `open` runs under `bun test`.
import { existsSync } from "node:fs";
import { findKanata } from "../firmware/kanata/binary.ts";
import type { Finding } from "../firmware/kanata/doctor.ts";
import { DAEMON_LABEL, DAEMON_PLIST_PATH } from "../firmware/kanata/plist.ts";
import { type RemapperOverrides, remapperDoctor, remapperEnv, setupRemapper } from "./remapper.ts";

export type Runner = (cmd: readonly string[]) => Promise<{ code: number; out: string }>;

/** Runs a command with no shell between keyloom and it, so an argument is never re-read as shell syntax. */
export const spawnRunner: Runner = async (cmd) => {
  try {
    const proc = Bun.spawn([...cmd], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, out: `${out}${err}` };
  } catch (error) {
    return { code: 127, out: error instanceof Error ? error.message : String(error) };
  }
};

// --- System Settings (D-492) -------------------------------------------------------------------

/**
 * The panes keyloom may open, and nothing else: the route takes a name from this list, never a URL, so a page can't make keyloom
 * open an arbitrary address. The URLs are the `x-apple.systempreferences:` anchors macOS 13 and later answer.
 */
export const SETTINGS_PANES = {
  input_monitoring: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  files_and_folders: "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders",
  full_disk_access: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  login_items: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
} as const;
export type SettingsPane = keyof typeof SETTINGS_PANES;
export const SETTINGS_PANE_NAMES = Object.keys(SETTINGS_PANES) as [SettingsPane, ...SettingsPane[]];

export type OpenSettingsResult = { ok: true } | { ok: false; code: "unsupported_platform" | "failed"; reason: string };

export async function openSettingsPane(pane: SettingsPane, deps: { run: Runner; platform: NodeJS.Platform }): Promise<OpenSettingsResult> {
  if (deps.platform !== "darwin") return { ok: false, code: "unsupported_platform", reason: "System Settings is on macOS only." };
  const r = await deps.run(["open", SETTINGS_PANES[pane]]);
  return r.code === 0 ? { ok: true } : { ok: false, code: "failed", reason: `macOS didn't open System Settings: ${lastLine(r.out) || `open exited ${r.code}`}` };
}

// --- quoting -----------------------------------------------------------------------------------

/** One shell word: single quotes, with a single quote inside written as '\'' . */
export const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

/** An AppleScript string literal: backslash and double quote are the only characters it escapes. */
export const appleScriptString = (s: string): string => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * The `osascript` call that runs `shell` as root through macOS's own password dialog, which names what it does. `osascript` gets the
 * script as one argument, so the only quoting is AppleScript's around the shell text and the shell's around each path in it.
 */
export function adminCommand(shell: string, prompt: string): string[] {
  return ["osascript", "-e", `do shell script ${appleScriptString(shell)} with prompt ${appleScriptString(prompt)} with administrator privileges`];
}

/**
 * Installs keyloom's LaunchDaemon and (re)loads it, which starts kanata (RunAtLoad). It is `rootInstallCommand` without `sudo`, plus a
 * bootout first, so a daemon that is loaded but stopped (the exit chord stops it for good) or one with an older plist starts again.
 */
export function daemonInstallScript(plistSource: string): string {
  const dest = shellQuote(DAEMON_PLIST_PATH);
  return [
    `cp ${shellQuote(plistSource)} ${dest}`,
    `chown root:wheel ${dest}`,
    `chmod 644 ${dest}`,
    `{ launchctl bootout system/${DAEMON_LABEL} 2>/dev/null; launchctl bootstrap system ${dest} || { sleep 1; launchctl bootstrap system ${dest}; }; }`,
  ].join(" && ");
}

export const ADMIN_PROMPT = "keyloom wants to install kanata's background service and start it, so your MacBook keyboard can type your layout.";

// --- the checklist -----------------------------------------------------------------------------

export type SetupFinding = Pick<Finding, "code" | "name" | "status" | "detail">;
export type RemapperSetupStatus = {
  platform: "darwin" | "other";
  /** Homebrew is here, so "Install kanata" can run. */
  canInstall: boolean;
  /** An install started from the app is still running. */
  installing: boolean;
  /** The driver release keyloom's kanata works with, for its download link. */
  driverVersion: string | null;
  findings: SetupFinding[];
};

const BREW_PATHS = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
export const findBrew = (): string | undefined => Bun.which("brew") ?? BREW_PATHS.find((p) => existsSync(p));

export type SetupDeps = {
  run: Runner;
  platform: NodeJS.Platform;
  brew: () => string | undefined;
  kanata: () => string | undefined;
  remapper?: RemapperOverrides;
};

export const realSetupDeps = (remapper: RemapperOverrides = {}): SetupDeps => ({ run: spawnRunner, platform: process.platform, brew: findBrew, kanata: () => findKanata(), remapper });

export async function remapperSetupStatus(boardId: string, deps: SetupDeps, installing: boolean): Promise<RemapperSetupStatus> {
  const report = await remapperDoctor(boardId, deps.remapper ?? {});
  return {
    platform: deps.platform === "darwin" ? "darwin" : "other",
    canInstall: deps.platform === "darwin" && deps.brew() !== undefined,
    installing,
    driverVersion: remapperEnv(boardId, deps.remapper ?? {}).rev.driverVersions.at(-1) ?? null,
    findings: report.findings.map(({ code, name, status, detail }) => ({ code, name, status, detail })),
  };
}

export type ActionResult = { ok: true } | { ok: false; code: string; reason: string };

/** `brew install kanata`. Homebrew asks nothing for a formula, so it runs without a terminal. */
export async function installKanata(deps: SetupDeps): Promise<ActionResult> {
  if (deps.platform !== "darwin") return { ok: false, code: "unsupported_platform", reason: "keyloom installs kanata on macOS only." };
  const brew = deps.brew();
  if (brew === undefined) return { ok: false, code: "no_brew", reason: "Homebrew isn't installed, so keyloom can't install kanata." };
  const r = await deps.run([brew, "install", "kanata"]);
  if (r.code !== 0) return { ok: false, code: "failed", reason: `Homebrew couldn't install kanata: ${lastLine(r.out) || `brew exited ${r.code}`}` };
  return deps.kanata() === undefined ? { ok: false, code: "failed", reason: "Homebrew finished, but keyloom still can't find kanata." } : { ok: true };
}

/**
 * Writes the daemon's plist into keyloom's folder (`setupRemapper`, which never replaces a keyloom.kbd it didn't write), then installs
 * and starts it as root through macOS's password dialog. The person sees what it does and can cancel; keyloom never holds the password.
 */
export async function startKanataDaemon(boardId: string, deps: SetupDeps): Promise<ActionResult> {
  if (deps.platform !== "darwin") return { ok: false, code: "unsupported_platform", reason: "keyloom starts kanata on macOS only." };
  if (deps.kanata() === undefined) return { ok: false, code: "no_kanata", reason: "Install kanata first." };
  const setup = await setupRemapper(boardId, deps.remapper ?? {});
  const r = await deps.run(adminCommand(daemonInstallScript(setup.plistPath), ADMIN_PROMPT));
  if (r.code === 0) return { ok: true };
  // osascript reports a cancelled password dialog as error -128.
  if (/-128\b/.test(r.out)) return { ok: false, code: "cancelled", reason: "You cancelled the password dialog, so kanata wasn't started." };
  return { ok: false, code: "failed", reason: `macOS couldn't start kanata: ${lastLine(r.out) || `osascript exited ${r.code}`}` };
}

function lastLine(out: string): string {
  return out.trim().split("\n").filter((l) => l.trim() !== "").at(-1)?.trim() ?? "";
}
