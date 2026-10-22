import { requirePlatformSupport } from "../firmware/toolchain/platform-support.ts";
// Use cases for a software-remapper board, the MacBook's built-in keyboard (21): apply a layout by writing kanata's file and
// reloading it, read back what kanata runs, switch remapping off and on, and the setup doctor. No build, no flash, no sudo.
// Tests and demos pass overrides so a temporary folder and a fake kanata stand in for the real ones.
import { homedir } from "node:os";
import { join } from "node:path";
import type { Board } from "../boards/load.ts";
import { type ApplyDeps, type ApplyOptions, type ApplyResult, type DisableResult, type RunningKanata, applyKanata, disableRemapping, readRunningKanata } from "../firmware/kanata/apply.ts";
import { findKanata, kanataCheck } from "../firmware/kanata/binary.ts";
import { type KanataBoardRevision, kanataRevision } from "../firmware/kanata/board-config.ts";
import type { KanataEndpoint } from "../firmware/kanata/client.ts";
import { type DoctorProbe, type DoctorReport, runRemapperDoctor } from "../firmware/kanata/doctor.ts";
import { GenerateError, SAFE_FILE, SETUP_REVISION, generateKanataSource } from "../firmware/kanata/generate.ts";
import { type RemapperPaths, remapperPaths } from "../firmware/kanata/paths.ts";
import { identityLayout } from "../firmware/kanata/identity.ts";
import { launchDaemonPlist } from "../firmware/kanata/plist.ts";
import { rootInstallCommand } from "../firmware/kanata/doctor.ts";
import { recordHandsFreeProof } from "../persistence/syncs.ts";
import { showBoard } from "./boards.ts";
import type { App } from "./context.ts";
import { UsageError } from "./errors.ts";
import { getLayout } from "./layouts.ts";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

export type RemapperOverrides = {
  /** The home folder keyloom's kanata files live under; a temporary one in tests. */
  home?: string;
  endpoint?: KanataEndpoint;
  check?: (path: string) => Promise<{ ok: boolean; output: string }>;
  probe?: DoctorProbe;
  /** Where the Karabiner-Elements config is read (read-only) by the doctor. */
  karabinerJson?: string;
};

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
      const bin = findKanata();
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
export async function disableRemapperFor(boardId: string, over: RemapperOverrides = {}): Promise<DisableResult> {
  const env = remapperEnv(boardId, over);
  const source = generateKanataSource({ layout: identityLayout(env.board.definition), board: env.board.definition, layoutId: "none", revisionId: "safe" });
  const safe = source.files.find((f) => f.path === SAFE_FILE);
  if (!safe) return { ok: false, error: "no safe.kbd was generated" };
  return disableRemapping(env.deps, safe.content);
}

export type SetupOutcome = { plistPath: string; plist: string; rootCommand: string; kanataPath: string | undefined; /** An identity keyloom.kbd was written for the daemon to start with. */ wroteConfig: boolean };

/**
 * Writes the LaunchDaemon plist into keyloom's own folder and returns the one command BK runs as root. keyloom never installs
 * it itself (D-231): the command is BK's to read and run.
 */
export async function setupRemapper(boardId: string, over: RemapperOverrides = {}): Promise<SetupOutcome> {
  const env = remapperEnv(boardId, over);
  const kanataPath = findKanata();
  const plist = launchDaemonPlist({ kanataPath: kanataPath ?? "/opt/homebrew/bin/kanata", configPath: env.paths.kbd, port: env.rev.tcpPort });
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
  return { plistPath: env.paths.plist, plist, rootCommand: rootInstallCommand(env.paths.plist), kanataPath, wroteConfig };
}

export function remapperDoctor(boardId: string, over: RemapperOverrides = {}): Promise<DoctorReport> {
  const env = remapperEnv(boardId, over);
  const karabinerJson = over.karabinerJson ?? join(over.home ?? homedir(), ".config", "karabiner", "karabiner.json");
  return runRemapperDoctor({ rev: env.rev, paths: env.paths, karabinerJson }, over.probe);
}

/** BK pressed Left Control + Space + Escape and saw kanata stop: auto-apply may turn on (D-235, 17#auto-sync). */
export function confirmExitChord(app: App, boardId: string): void {
  const board = showBoard(boardId);
  if (board.definition.firmware !== "kanata") throw new UsageError(`${board.definition.name} isn't a software-remapper board`);
  recordHandsFreeProof(app.db, boardId, "exit-chord");
}
