// Setting up the MacBook remapper from the app (D-493), and opening System Settings at the pane a fix needs (D-492).
// Every outside command goes through an injected runner, so tests describe a Mac instead of changing one: no real `brew`,
// `osascript` or `open` runs under `bun test`.
import { existsSync, realpathSync } from "node:fs";
import { findKanata } from "../firmware/kanata/binary.ts";
import { daemonInstallScript, rootScriptFailure, shellQuote } from "../firmware/kanata/daemon-install.ts";
import type { Finding } from "../firmware/kanata/doctor.ts";
import { type RemapperOverrides, remapperDoctor, remapperEnv, setupRemapper } from "./remapper.ts";

export { daemonInstallScript, shellQuote } from "../firmware/kanata/daemon-install.ts";

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
  // Not a pane: Karabiner-Elements' own settings, where its rules for the built-in keyboard are turned off (R3-21). The doctor reads the
  // same app bundle to see it is installed.
  karabiner_elements: "/Applications/Karabiner-Elements.app",
  // Not a pane either: Docker Desktop, whose Settings > Resources > File sharing decides which folders a build can see (R7-02). Docker
  // documents no link to that page, so this opens the app and the build step names the page. Docker Desktop installs here.
  docker_desktop: "/Applications/Docker.app",
} as const;
export type SettingsPane = keyof typeof SETTINGS_PANES;
export const SETTINGS_PANE_NAMES = Object.keys(SETTINGS_PANES) as [SettingsPane, ...SettingsPane[]];

export type OpenSettingsResult = { ok: true } | { ok: false; code: "unsupported_platform" | "failed"; reason: string };

export async function openSettingsPane(pane: SettingsPane, deps: { run: Runner; platform: NodeJS.Platform }): Promise<OpenSettingsResult> {
  if (deps.platform !== "darwin") return { ok: false, code: "unsupported_platform", reason: "System Settings is on macOS only." };
  const r = await deps.run(["open", SETTINGS_PANES[pane]]);
  const what = pane === "karabiner_elements" ? "Karabiner-Elements" : pane === "docker_desktop" ? "Docker Desktop" : "System Settings";
  return r.code === 0 ? { ok: true } : { ok: false, code: "failed", reason: `macOS didn't open ${what}: ${lastLine(r.out) || `open exited ${r.code}`}` };
}

// --- quoting -----------------------------------------------------------------------------------

/** An AppleScript string literal: backslash and double quote are the only characters it escapes. */
export const appleScriptString = (s: string): string => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** The whole environment a root script starts with: a PATH of folders only root can change. Every root script needs nothing else. */
export const ROOT_SCRIPT_ENV = "PATH=/usr/bin:/bin:/usr/sbin:/sbin";

/**
 * The `osascript` call that runs `shell` as root through macOS's own password dialog, which names what it does. `osascript` gets the
 * script as one argument, so the only quoting is AppleScript's around the shell text and the shell's around each path in it.
 *
 * Nothing from keyloom's environment reaches root (#300 re-review). macOS's /bin/sh is bash, which takes exported functions from the
 * environment (`BASH_FUNC_cd%%`) and runs them in place of `cd` or `echo`, and runs `PS4` under `SHELLOPTS=xtrace`; whoever starts
 * keyloom chooses that environment. So osascript starts from an empty one, and so does the script: `do shell script`'s own shell runs
 * only `/usr/bin/env` by its full path, and the script runs in a shell that `env -i` gave nothing but ROOT_SCRIPT_ENV.
 */
export function adminCommand(shell: string, prompt: string): string[] {
  const clean = `/usr/bin/env -i ${ROOT_SCRIPT_ENV} /bin/sh -c ${shellQuote(shell)}`;
  return ["/usr/bin/env", "-i", ROOT_SCRIPT_ENV, "/usr/bin/osascript", "-e", `do shell script ${appleScriptString(clean)} with prompt ${appleScriptString(prompt)} with administrator privileges`];
}

export const ADMIN_PROMPT = "keyloom wants to copy kanata to a folder only macOS can change, install kanata's background service and start it, so your MacBook keyboard can type your layout.";

// --- the checklist -----------------------------------------------------------------------------

export type SetupFinding = Pick<Finding, "code" | "name" | "status" | "detail">;

/** `reinstall` puts Homebrew's own kanata back over one changed outside Homebrew (D-498). */
export type KanataInstallAction = "install" | "upgrade" | "reinstall";

/** The install or update started from the app; the wire's KanataInstallSchema (src/api/system-remapper.ts) is the same shape. */
export type KanataInstall = {
  state: "idle" | "running" | "succeeded" | "failed" | "cancelled";
  action: KanataInstallAction | null;
  /** The last lines Homebrew printed, oldest first. */
  log: string[];
  failure: { code: string; reason: string } | null;
};
export type RemapperSetupStatus = {
  platform: "darwin" | "other";
  /** Homebrew is here, so "Install kanata" and "Update kanata" can run. */
  canInstall: boolean;
  /** The install or update started from the app, while it runs and after it ends. */
  install: KanataInstall;
  /** `path` is where the kanata on PATH really is, and `copyVersion` the version of the root copy the daemon runs, when it differs. */
  kanata: { version: string | null; wanted: string; update: "brew" | "link" | null; path: string | null; copyVersion: string | null };
  /** The driver release keyloom's kanata works with, for its download link. */
  driverVersion: string | null;
  findings: SetupFinding[];
};

const BREW_PATHS = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
export const findBrew = (): string | undefined => Bun.which("brew") ?? BREW_PATHS.find((p) => existsSync(p));

/** Runs one command, streaming its lines, until it ends or `signal` stops it. Tests pass a fake, so no test runs brew. */
export type StreamRunner = (cmd: readonly string[], opts: { signal: AbortSignal; onLine: (line: string) => void }) => Promise<{ code: number | null; aborted: boolean }>;

// A fresh Homebrew can update itself first, which can take minutes.
const BREW_TIMEOUT_MS = 20 * 60_000;
const KILL_GRACE_MS = 5000;

/**
 * Runs Homebrew in its own process group, so Cancel stops all of it. `brew` is a shell script that runs Ruby, which runs curl: a SIGTERM to
 * `brew` alone leaves its children running and holding the output open, so the install would look like it runs on. The shared toolchain
 * runner (src/firmware/toolchain/run.ts) signals only the process it started; this one signals the group. They can merge later.
 */
export const streamRunner: StreamRunner = async (cmd, opts) => {
  // The test preload sets this, so a forgotten fake fails its test instead of installing software on the machine.
  if (process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS === "1") throw new Error(`refusing to run ${cmd.join(" ")} in a test`);
  const proc = Bun.spawn([...cmd], { stdout: "pipe", stderr: "pipe", stdin: "ignore", detached: true, env: { ...process.env, HOMEBREW_NO_ENV_HINTS: "1" } });
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-proc.pid, signal);
    } catch {
      // The group has already gone.
    }
  };
  let aborted = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    signalGroup("SIGTERM");
    killTimer ??= setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS);
  };
  const onAbort = () => {
    aborted = true;
    stop();
  };
  if (opts.signal.aborted) onAbort();
  else opts.signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(stop, BREW_TIMEOUT_MS);
  try {
    await Promise.all([readLines(proc.stdout, opts.onLine), readLines(proc.stderr, opts.onLine), proc.exited]);
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimer);
    opts.signal.removeEventListener("abort", onAbort);
  }
  return { code: proc.exitCode, aborted };
};

/** Each line of a stream, split on \n, \r\n or \r (Homebrew redraws its progress bars with \r). */
async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    const parts = (pending + decoder.decode(chunk, { stream: true })).split(/\r\n|\r|\n/);
    pending = parts.pop() ?? "";
    for (const line of parts) onLine(line);
  }
  const rest = pending + decoder.decode();
  if (rest !== "") onLine(rest);
}

export type SetupDeps = {
  run: Runner;
  stream: StreamRunner;
  platform: NodeJS.Platform;
  brew: () => string | undefined;
  kanata: () => string | undefined;
  remapper?: RemapperOverrides;
};

export const realSetupDeps = (remapper: RemapperOverrides = {}): SetupDeps => ({
  run: spawnRunner, stream: streamRunner, platform: process.platform, brew: findBrew, kanata: remapper.kanataBin ?? (() => findKanata()), remapper,
});

/** -1, 0 or 1, comparing dotted version numbers part by part; a part that isn't a number counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/**
 * How to get the kanata keyloom writes for (R2-10). Homebrew can only move a kanata it installed forward, so Update kanata is offered for
 * an older Homebrew kanata; a newer one, one installed some other way, or an unknown version gets kanata's release page.
 */
export function kanataUpdate(kanata: { bin: string; version: string | undefined } | null, wanted: string, canInstall: boolean): "brew" | "link" | null {
  if (kanata === null || kanata.version === wanted) return null;
  let real = kanata.bin;
  try {
    real = realpathSync(kanata.bin);
  } catch {
    // The path as found still says whether it is Homebrew's.
  }
  const fromBrew = real.includes("/Cellar/kanata/");
  return canInstall && fromBrew && kanata.version !== undefined && compareVersions(kanata.version, wanted) < 0 ? "brew" : "link";
}

export const IDLE_INSTALL: KanataInstall = { state: "idle", action: null, log: [], failure: null };

export async function remapperSetupStatus(boardId: string, deps: SetupDeps, install: KanataInstall = IDLE_INSTALL): Promise<RemapperSetupStatus> {
  const report = await remapperDoctor(boardId, deps.remapper ?? {}, { rootCommand: false });
  const rev = remapperEnv(boardId, deps.remapper ?? {}).rev;
  const canInstall = deps.platform === "darwin" && deps.brew() !== undefined;
  const update = kanataUpdate(report.kanata, rev.kanataVersion, canInstall);
  // `brew upgrade` succeeds without a change when Homebrew has nothing newer, so Update kanata would only do the same again.
  const brewHasNothingNewer = update === "brew" && install.action === "upgrade" && install.state === "succeeded";
  return {
    platform: deps.platform === "darwin" ? "darwin" : "other",
    canInstall,
    install,
    kanata: {
      version: report.kanata?.version ?? null, wanted: rev.kanataVersion, update: brewHasNothingNewer ? "link" : update,
      path: report.kanata?.real ?? null, copyVersion: report.copyVersion ?? null,
    },
    driverVersion: rev.driverVersions.at(-1) ?? null,
    findings: report.findings.map(({ code, name, status, detail }) => ({ code, name, status, detail })),
  };
}

export type ActionResult = { ok: true } | { ok: false; code: string; reason: string };

/**
 * `brew install kanata`, `brew upgrade kanata` for Update kanata, or `brew reinstall kanata`. Homebrew asks nothing for a formula, so it
 * runs without a terminal. Each line it prints goes to `onLine`, and `signal` stops it.
 */
export async function installKanata(deps: SetupDeps, action: KanataInstallAction, opts: { signal: AbortSignal; onLine: (line: string) => void }): Promise<ActionResult> {
  const ready = installPrecheck(deps);
  if (!ready.ok) return ready;
  const lines: string[] = [];
  const r = await deps.stream([ready.brew, action, "kanata"], {
    signal: opts.signal,
    onLine: (line) => {
      lines.push(line);
      opts.onLine(line);
    },
  });
  const what = action === "upgrade" ? "update" : action;
  if (r.aborted || opts.signal.aborted) return { ok: false, code: "cancelled", reason: `You cancelled the ${what}.` };
  if (r.code !== 0) return { ok: false, code: "failed", reason: `Homebrew couldn't ${what} kanata: ${lastLine(lines.join("\n")) || `brew exited ${r.code ?? "from a signal"}`}` };
  return deps.kanata() === undefined ? { ok: false, code: "failed", reason: "Homebrew finished, but keyloom still can't find kanata." } : { ok: true };
}

function installPrecheck(deps: SetupDeps): { ok: true; brew: string } | { ok: false; code: string; reason: string } {
  if (deps.platform !== "darwin") return { ok: false, code: "unsupported_platform", reason: "keyloom installs kanata on macOS only." };
  const brew = deps.brew();
  if (brew === undefined) return { ok: false, code: "no_brew", reason: "Homebrew isn't installed, so keyloom can't install kanata." };
  return { ok: true, brew };
}

const TAIL_LINES = 30;

/**
 * One kanata install or update at a time, followed by the status read: its state, the last lines Homebrew printed, and why it failed.
 * A second Install joins the one running; Cancel stops it. The state stays after it ends, so a failure keeps its reason and link until the
 * next start.
 */
export function kanataInstaller(deps: SetupDeps) {
  let state: KanataInstall = IDLE_INSTALL;
  let controller: AbortController | null = null;
  let running: Promise<void> = Promise.resolve();
  return {
    state: (): KanataInstall => ({ ...state, log: [...state.log] }),
    start(action: KanataInstallAction): ActionResult {
      if (state.state === "running") return { ok: true };
      const ready = installPrecheck(deps);
      if (!ready.ok) return ready;
      const own = new AbortController();
      controller = own;
      state = { state: "running", action, log: [], failure: null };
      const onLine = (line: string) => {
        if (line.trim() === "") return;
        state = { ...state, log: [...state.log, line].slice(-TAIL_LINES) };
      };
      running = installKanata(deps, action, { signal: own.signal, onLine })
        .catch((err: unknown): ActionResult => ({ ok: false, code: "failed", reason: err instanceof Error ? err.message : String(err) }))
        .then((r) => {
          state = r.ok ? { ...state, state: "succeeded" } : { ...state, state: r.code === "cancelled" ? "cancelled" : "failed", failure: { code: r.code, reason: r.reason } };
          if (controller === own) controller = null;
        });
      return { ok: true };
    },
    cancel(): ActionResult {
      if (state.state !== "running" || controller === null) return { ok: false, code: "not_running", reason: "No kanata install is running." };
      controller.abort();
      return { ok: true };
    },
    /** Resolves when the current job has ended. */
    settled: (): Promise<void> => running,
  };
}

/**
 * Prepares keyloom's folder (`setupRemapper`, which never replaces a keyloom.kbd it didn't write), then copies kanata to its root-owned
 * place and installs and starts the daemon as root through macOS's password dialog (D-498). The plist text is carried in the script, and
 * the kanata copy is checked against the SHA-256 keyloom read before asking. The person sees what it does and can cancel; keyloom never
 * holds the password.
 */
export async function startKanataDaemon(boardId: string, deps: SetupDeps): Promise<ActionResult> {
  if (deps.platform !== "darwin") return { ok: false, code: "unsupported_platform", reason: "keyloom starts kanata on macOS only." };
  if (deps.kanata() === undefined) return { ok: false, code: "no_kanata", reason: "Install kanata first." };
  const setup = await setupRemapper(boardId, { ...deps.remapper, kanataBin: deps.kanata });
  if (setup.install === null) return { ok: false, code: setup.blocked?.code ?? "failed", reason: setup.blocked?.reason ?? "keyloom couldn't prepare kanata's setup." };
  const r = await deps.run(adminCommand(daemonInstallScript(setup.install), ADMIN_PROMPT));
  if (r.code === 0) return { ok: true };
  // osascript reports a cancelled password dialog as error -128.
  if (/-128\b/.test(r.out)) return { ok: false, code: "cancelled", reason: "You cancelled the password dialog, so kanata wasn't started." };
  // The root script says why it stopped (daemon-install.ts), and the code is what the page acts on.
  const root = rootScriptFailure(r.out);
  if (root !== null) return { ok: false, code: root.code, reason: root.reason };
  return { ok: false, code: "failed", reason: `macOS couldn't start kanata: ${lastLine(r.out) || `osascript exited ${r.code}`}` };
}

export function lastLine(out: string): string {
  return out.trim().split("\n").filter((l) => l.trim() !== "").at(-1)?.trim() ?? "";
}
