// A build's firmware file, for a board keyloom can't flash itself (D-490): downloaded from the page, or shown in Finder.
// Only the file a build row names, inside the data directory's artifacts folder, is ever served or revealed.
import { existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { findBuild } from "../persistence/builds.ts";
import { findLayoutRow } from "../persistence/layouts.ts";
import { capture } from "../firmware/toolchain/run.ts";
import type { App } from "./context.ts";
import { NotFoundError, UsageError } from "./errors.ts";

export type BuildArtifact = { path: string; filename: string };

/** The firmware file of a successful build, with a download name that says which board and build it is for. */
export function buildArtifact(app: App, id: string): BuildArtifact {
  const row = findBuild(app.db, id);
  if (!row) throw new NotFoundError(`no build "${id}"`);
  if (row.status !== "succeeded" || row.artifactPath === null) throw new NotFoundError(`build ${id} has no firmware file; only a successful build has one`);
  const folder = resolve(app.dataDir, "artifacts");
  const path = resolve(app.dataDir, row.artifactPath);
  // The path comes from the database, but a row edited by hand must still not name a file outside the artifacts folder.
  if (!path.startsWith(folder + sep)) throw new NotFoundError(`build ${id}'s firmware file is outside keyloom's artifacts folder`);
  if (!existsSync(path)) throw new NotFoundError(`build ${id}'s firmware file is gone; build it again`);
  const board = findLayoutRow(app.db, row.layoutId)?.boardId.replace("/", "-") ?? "keyboard";
  return { path, filename: `keyloom-${board}-${row.boardRevision}-${row.id}${extname(path)}` };
}

export type RevealDeps = { platform?: NodeJS.Platform; open?: (path: string) => Promise<void> };

const openInFinder = async (path: string): Promise<void> => {
  // The test preload sets this, so a forgotten fake fails its test instead of opening Finder on the machine.
  if (process.env.KEYLOOM_REFUSE_SYSTEM_ACTIONS === "1") throw new Error(`refusing to reveal ${path} in a test`);
  const r = await capture(["open", "-R", path], { timeoutMs: 10_000 });
  if (r.exitCode !== 0) throw new UsageError(`Finder couldn't show the file: ${(r.stderr || r.stdout).trim() || `open exited with code ${r.exitCode}`}`);
};

/** Shows a build's firmware file in Finder. macOS only; the page hides the button elsewhere. */
export async function revealBuildArtifact(app: App, id: string, deps: RevealDeps = {}): Promise<void> {
  if ((deps.platform ?? process.platform) !== "darwin") throw new UsageError("Showing the file in a folder works on macOS only. Download it instead.");
  await (deps.open ?? openInFinder)(buildArtifact(app, id).path);
}
