// Where keyloom keeps the tools it downloads itself on a Mac without Homebrew (D-560, D-561): kanata and Zapp. One folder for the person,
// not on PATH and not per data directory: the lookups that read it (findKanata, the Zapp flash) run without a data directory, and a tool
// belongs to the computer, as Homebrew's do. The download itself is src/app/tool-download.ts.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { which } from "./run.ts";

export const KEPT_TOOLS = ["kanata", "zapp"] as const;
export type KeptTool = (typeof KEPT_TOOLS)[number];
export const isKeptTool = (name: string): name is KeptTool => (KEPT_TOOLS as readonly string[]).includes(name);

/**
 * `~/Library/Application Support/keyloom/bin`, or `KEYLOOM_TOOLS_DIR`. The test preload points that at a scratch folder, so no test
 * reads or writes the person's own.
 */
export function keptToolsDir(env: Record<string, string | undefined> = process.env): string {
  const given = env.KEYLOOM_TOOLS_DIR;
  return given !== undefined && given !== "" ? given : join(homedir(), "Library", "Application Support", "keyloom", "bin");
}

/** The kept copy of a tool, when there is one. A file only: a folder of the same name is not a tool. */
export function keptTool(tool: KeptTool, env: Record<string, string | undefined> = process.env): string | undefined {
  const path = join(keptToolsDir(env), tool);
  try {
    return statSync(path).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A program on PATH, or keyloom's kept copy of one it downloads. Every lookup of such a tool goes through here, so what a check finds is
 * what a run uses (D-561). kanata adds its own places first (findKanata).
 */
export function findTool(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  return which(name) ?? (isKeptTool(name) ? keptTool(name, env) : undefined);
}
