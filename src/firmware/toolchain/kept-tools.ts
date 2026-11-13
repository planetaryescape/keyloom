// Where keyloom keeps the tools it downloads itself on a Mac without Homebrew (D-560, D-561): kanata and Zapp. One folder for the person,
// not on PATH and not per data directory: the lookups that read it (findKanata, the Zapp flash) run without a data directory, and a tool
// belongs to the computer, as Homebrew's do. The download itself is src/app/tool-download.ts.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { which } from "./run.ts";
import { KEPT_TOOLS, type KeptTool, type PinDeps, pinnedAsset } from "./tool-pins.ts";

export { KEPT_TOOLS, type KeptTool };
export const isKeptTool = (name: string): name is KeptTool => (KEPT_TOOLS as readonly string[]).includes(name);

/**
 * `~/Library/Application Support/keyloom/bin`, or `KEYLOOM_TOOLS_DIR`. The test preload points that at a scratch folder, so no test
 * reads or writes the person's own.
 */
export function keptToolsDir(env: Record<string, string | undefined> = process.env): string {
  const given = env.KEYLOOM_TOOLS_DIR;
  return given !== undefined && given !== "" ? given : join(homedir(), "Library", "Application Support", "keyloom", "bin");
}

/**
 * The kept copy of a tool, when there is one that keyloom can still trust: a file (a folder of the same name is not a tool) whose bytes hash
 * to this processor's pinned program. The folder is the person's own, so any program running as them can change the file after the
 * download; a changed copy is never found, so nothing runs it, and Get kanata or Get Zapp, which replace it, are offered instead (PR #317
 * review). `pin` lets a test pin the small programs it builds.
 */
export function keptTool(tool: KeptTool, env: Record<string, string | undefined> = process.env, pin: PinDeps = {}): string | undefined {
  return keptState(tool, env, pin) === "pinned" ? join(keptToolsDir(env), tool) : undefined;
}

/** Whether a file sits where keyloom keeps this tool but isn't the program keyloom downloaded, so the lookups skip it. */
export const keptToolChanged = (tool: KeptTool, env: Record<string, string | undefined> = process.env, pin: PinDeps = {}): boolean =>
  keptState(tool, env, pin) === "changed";

/** Whether these bytes are the program keyloom pins for this processor. A Mac with no pin for its processor has no trusted copy. */
export function isPinnedProgram(tool: KeptTool, bytes: Uint8Array, pin: PinDeps = {}): boolean {
  const expected = pinnedAsset(tool, pin)?.binarySha256;
  return expected !== undefined && new Bun.CryptoHasher("sha256").update(bytes).digest("hex") === expected;
}

/** Whether `path` is keyloom's kept copy of the tool, links followed on both sides. */
export function isKeptPath(tool: KeptTool, path: string, env: Record<string, string | undefined> = process.env): boolean {
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  return real(path) === real(join(keptToolsDir(env), tool));
}

function keptState(tool: KeptTool, env: Record<string, string | undefined>, pin: PinDeps): "none" | "pinned" | "changed" {
  const path = join(keptToolsDir(env), tool);
  try {
    if (!statSync(path).isFile()) return "none";
  } catch {
    return "none";
  }
  try {
    return isPinnedProgram(tool, readFileSync(path), pin) ? "pinned" : "changed";
  } catch {
    // A file keyloom can't read can't be shown to be the pinned program.
    return "changed";
  }
}

/**
 * A program on PATH, or keyloom's kept copy of one it downloads. Every lookup of such a tool goes through here, so what a check finds is
 * what a run uses (D-561). kanata adds its own places first (findKanata).
 */
export function findTool(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  return which(name) ?? (isKeptTool(name) ? keptTool(name, env) : undefined);
}
