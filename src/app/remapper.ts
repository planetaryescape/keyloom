import { requirePlatformSupport } from "../firmware/toolchain/platform-support.ts";
// Use cases for a software-remapper board, the MacBook's built-in keyboard (21): apply a layout by writing kanata's file and
// reloading it, read back what kanata runs, switch remapping off and on, and the setup doctor. No build, no flash, no sudo.
// Tests and demos pass overrides so a temporary folder and a fake kanata stand in for the real ones.
import { homedir } from "node:os";
import { join } from "node:path";
import type { Board } from "../boards/load.ts";
import { type ApplyDeps, type ApplyOptions, type ApplyResult, type DisableResult, type RunningKanata, applyKanata, disableRemapping, readRunningKanata } from "../firmware/kanata/apply.ts";
import { CMD_PROBE_CONFIG, cmdCheckResult, fileSha256, findKanata, kanataCheck } from "../firmware/kanata/binary.ts";
import { type KanataBoardRevision, kanataRevision } from "../firmware/kanata/board-config.ts";
import type { KanataEndpoint } from "../firmware/kanata/client.ts";
import { type DoctorProbe, type DoctorReport, runRemapperDoctor } from "../firmware/kanata/doctor.ts";
import { GenerateError, SAFE_FILE, SETUP_REVISION, generateKanataSource } from "../firmware/kanata/generate.ts";
import { type RemapperPaths, remapperPaths } from "../firmware/kanata/paths.ts";
import { identityLayout } from "../firmware/kanata/identity.ts";
import { ROOT_KANATA_PATH, launchDaemonPlist } from "../firmware/kanata/plist.ts";
import { type DaemonInstall, rootInstallCommand } from "../firmware/kanata/daemon-install.ts";
import { recordHandsFreeProof } from "../persistence/syncs.ts";
import { showBoard } from "./boards.ts";
import type { App } from "./context.ts";
import { UsageError } from "./errors.ts";
import { getLayout } from "./layouts.ts";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

export type RemapperOverrides = {
  /** The home folder keyloom's kanata files live under; a temporary one in tests. */
  home?: string;
  endpoint?: KanataEndpoint;
  check?: (path: string) => Promise<{ ok: boolean; output: string }>;
  probe?: DoctorProbe;
  /** Where the Karabiner-Elements config is read (read-only) by the doctor. */
  karabinerJson?: string;
  /** The kanata binary setup copies for the daemon (D-498); a fake script in tests. */
  kanataBin?: () => string | undefined;
};

export { ROOT_KANATA_PATH };

const kanataBinFor = (over: RemapperOverrides): string | undefined => (over.kanataBin ?? (() => findKanata()))();

export type RemapperEnv = { board: Board; rev: KanataBoardRevision; paths: RemapperPaths; deps: ApplyDeps };

export function remapperEnv(boardId: string, over: RemapperOverrides = {}): RemapperEnv {
  requirePlatformSupport("keyloom remap");
  const board = showBoard(boardId);
  if (board.definition.firmware !== "kanata") throw new UsageError(`${board.definition.name} isn't a software-remapper board`);
  const rev = kanataRevision(board.definition);
  const paths = remapperPaths(over.home ?? process.env.KEYLOOM_KANATA_HOME ?? homedir());
  const envPort = Number(process.env.KEYLOOM_KANATA_PORT);
  const endpoint = over.endpoint ?? { port: Number.isInteger(envPort) && envPort > 0 ? envPort : rev.tcpPort };
  const check =
    over.check ??
    (async (path: string) => {
      const bin = kanataBinFor(over);
      if (!bin) return { ok: false, output: "kanata isn't installed, so keyloom can't check the config; run `keyloom doctor`" };
      return kanataCheck(bin, path);
    });
  return { board, rev, paths, deps: { paths, endpoint, check } };
}

export type RemapperApplyOutcome = ApplyResult | { ok: false; step: "generate"; error: string; written: false };

/** Generates the file for one revision of a layout and applies it. Never throws for a problem with the layout or kanata. */
export async function applyToRemapper(app: App, layoutRef: string, revisionId: string | undefined, over: RemapperOverrides = {}, opts: ApplyOptions = {}): Promise<RemapperApplyOutcome> {
  const view = getLayout(app, layoutRef, revisionId);
  const env = remapperEnv(view.layout.boardId, over);
  let source: ReturnType<typeof generateKanataSource>;
  try {
    source = generateKanataSource({ layout: view.document, board: view.board.definition, layoutId: view.layout.id, revisionId: view.revision.id });
  } catch (err) {
    if (err instanceof GenerateError) return { ok: false, step: "generate", error: `this layout can't be written for kanata: ${err.message}`, written: false };
    throw err;
  }
  return applyKanata(env.deps, source, view.revision.id, opts);
}

/** What kanata is running on this board's machine right now. */
export const readRemapper = (boardId: string, over: RemapperOverrides = {}): Promise<RunningKanata> => readRunningKanata(remapperEnv(boardId, over).deps.endpoint);

/** "Disable remapping": the identity map, no sudo (D-235). The safe file comes from the layout's own board, so it names the right keys. */
/**
 * Whether kanata answers on its port: only a refused connection shows it has stopped. A timeout or another failure proves nothing,
 * so it is "unreadable" (D-497). The app's exit-chord button and `keyloom remap confirm-exit-chord` both ask this first.
 */
export async function probeRemapper(boardId: string, over: RemapperOverrides = {}): Promise<"running" | "stopped" | "unreadable"> {
  try {
    const running = await readRemapper(boardId, over);
    return running.state !== "absent" ? "running" : running.refused ? "stopped" : "unreadable";
  } catch {
    return "unreadable";
  }
}

export async function disableRemapperFor(boardId: string, over: RemapperOverrides = {}): Promise<DisableResult> {
  const env = remapperEnv(boardId, over);
  const source = generateKanataSource({ layout: identityLayout(env.board.definition), board: env.board.definition, layoutId: "none", revisionId: "safe" });
  const safe = source.files.find((f) => f.path === SAFE_FILE);
  if (!safe) return { ok: false, error: "no safe.kbd was generated" };
  return disableRemapping(env.deps, safe.content);
}

/** Why the daemon can't be installed with this kanata. */
export type DaemonInstallBlock = { code: "no_kanata" | "kanata_unreadable" | "kanata_allows_cmd" | "kanata_cmd_unknown"; reason: string };

export type SetupOutcome = {
  plistPath: string;
  plist: string;
  /** The command to run as root, or null when `blocked` says why it can't be given. */
  rootCommand: string | null;
  /** What the root script installs, for the app's password dialog; null with `blocked`. */
  install: DaemonInstall | null;
  blocked: DaemonInstallBlock | null;
  kanataPath: string | undefined;
  /** An identity keyloom.kbd was written for the daemon to start with. */
  wroteConfig: boolean;
};

const daemonPlist = (env: RemapperEnv): string => launchDaemonPlist({ kanataPath: ROOT_KANATA_PATH, configPath: env.paths.kbd, port: env.rev.tcpPort });

/**
 * What root would install: the plist and the kanata to copy, with the SHA-256 the root script checks the copy against (D-498). A kanata
 * that accepts a config asking for `cmd` is refused, and so is one whose answer keyloom can't read: the daemon runs it as root and reads
 * keyloom.kbd from the person's home folder, so with `cmd` a swapped config would run anything as root.
 */
async function daemonInstallFor(env: RemapperEnv, over: RemapperOverrides, plist = daemonPlist(env)): Promise<{ install: DaemonInstall; kanataPath: string } | { blocked: DaemonInstallBlock; kanataPath: string | undefined }> {
  const found = kanataBinFor(over);
  if (found === undefined) return { blocked: { code: "no_kanata", reason: "kanata isn't installed. Install it first." }, kanataPath: undefined };
  let source = found;
  try {
    source = realpathSync(found);
  } catch {
    // A path that won't resolve fails the read below with its own reason.
  }
  const sha256 = await fileSha256(source);
  if (sha256 === undefined) return { blocked: { code: "kanata_unreadable", reason: `keyloom couldn't read kanata at ${source}.` }, kanataPath: source };
  const dir = await mkdtemp(join(tmpdir(), "keyloom-cmd-probe-"));
  let probe: { ok: boolean; output: string };
  try {
    const path = join(dir, "probe.kbd");
    await writeFile(path, CMD_PROBE_CONFIG);
    probe = await kanataCheck(source, path).catch((err: unknown) => ({ ok: false, output: err instanceof Error ? err.message : String(err) }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const cmd = cmdCheckResult(probe);
  if (cmd === "allows") {
    return {
      blocked: { code: "kanata_allows_cmd", reason: `The kanata at ${source} can run programs from its config (it was built with kanata's cmd feature). keyloom won't run it as root, because a changed keyloom.kbd could then run anything as root. Install Homebrew's kanata, which can't.` },
      kanataPath: source,
    };
  }
  if (cmd === "unknown") {
    const last = probe.output.trim().split("\n").at(-1)?.trim() ?? "";
    return { blocked: { code: "kanata_cmd_unknown", reason: `keyloom couldn't tell whether the kanata at ${source} can run programs from its config, so it won't run it as root.${last ? ` kanata said: ${last}` : ""}` }, kanataPath: source };
  }
  return { install: { plist, kanata: { source, sha256 } }, kanataPath: source };
}

/**
 * Writes the LaunchDaemon plist into keyloom's own folder and returns the one command BK runs as root, which copies kanata to its
 * root-owned place and installs that plist (D-498). keyloom never runs it itself (D-231): the command is BK's to read and run.
 */
export async function setupRemapper(boardId: string, over: RemapperOverrides = {}): Promise<SetupOutcome> {
  const env = remapperEnv(boardId, over);
  const plist = daemonPlist(env);
  await mkdir(env.paths.dir, { recursive: true });
  await writeFile(env.paths.plist, plist);
  // The daemon needs a config to start with. An identity one (nothing remapped) is written only where keyloom.kbd doesn't exist,
  // so a file BK wrote himself is never touched.
  const identity = generateKanataSource({ layout: identityLayout(env.board.definition), board: env.board.definition, layoutId: "none", revisionId: SETUP_REVISION });
  let wroteConfig = false;
  if (!existsSync(env.paths.kbd)) {
    for (const f of identity.files) await writeFile(f.path === SAFE_FILE ? env.paths.safe : env.paths.kbd, f.content);
    wroteConfig = true;
  }
  const plan = await daemonInstallFor(env, over, plist);
  return "install" in plan
    ? { plistPath: env.paths.plist, plist, rootCommand: rootInstallCommand(plan.install), install: plan.install, blocked: null, kanataPath: plan.kanataPath, wroteConfig }
    : { plistPath: env.paths.plist, plist, rootCommand: null, install: null, blocked: plan.blocked, kanataPath: plan.kanataPath, wroteConfig };
}

/** The doctor's findings, and the root command when the daemon needs (re)installing; `blocked` says why there is none. */
export type RemapperDoctorReport = Pick<DoctorReport, "findings" | "kanata"> & { rootCommand: string | null; blocked: DaemonInstallBlock | null };

export async function remapperDoctor(boardId: string, over: RemapperOverrides = {}): Promise<RemapperDoctorReport> {
  const env = remapperEnv(boardId, over);
  const karabinerJson = over.karabinerJson ?? join(over.home ?? homedir(), ".config", "karabiner", "karabiner.json");
  const report = await runRemapperDoctor({ rev: env.rev, paths: env.paths, karabinerJson, port: env.deps.endpoint.port }, over.probe);
  const read = { findings: report.findings, kanata: report.kanata };
  if (!report.needsRoot) return { ...read, rootCommand: null, blocked: null };
  const plan = await daemonInstallFor(env, over);
  return "install" in plan ? { ...read, rootCommand: rootInstallCommand(plan.install), blocked: null } : { ...read, rootCommand: null, blocked: plan.blocked };
}

/** BK pressed Left Control + Space + Escape and saw kanata stop: auto-apply may turn on (D-235, 17#auto-sync). */
export function confirmExitChord(app: App, boardId: string): void {
  const board = showBoard(boardId);
  if (board.definition.firmware !== "kanata") throw new UsageError(`${board.definition.name} isn't a software-remapper board`);
  recordHandsFreeProof(app.db, boardId, "exit-chord");
}
