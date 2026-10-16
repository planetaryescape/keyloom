// Use cases for board definitions: list, show, check, geometry (04, 10).
import { join, resolve } from "node:path";
import { type BoardDevView, loadBoardDev } from "../boards/dev.ts";
import { type CheckOptions, type CheckResult, checkBoardDir } from "../boards/check.ts";
import { type GeometryOptions, generateGeometry, serializeGeometry } from "../boards/geometry.ts";
import { type Board, BoardNotFoundError, loadDefinitionDir } from "../boards/load.ts";
import { getBoard, listBoards, setUserBoards } from "../boards/registry.ts";
import { readUserBoards } from "../boards/user-boards.ts";
import { cacheDir, dataDir } from "../persistence/paths.ts";
import { NotFoundError, UsageError } from "./errors.ts";

export type { Board } from "../boards/load.ts";
export type { CheckResult } from "../boards/check.ts";

/** Loads the boards derived on this machine from the data directory into the registry (22), for commands that never open the database. */
export function loadUserBoards(dataDirOverride?: string): void {
  setUserBoards(readUserBoards(dataDir(dataDirOverride)).boards);
}

export const listBoardDefinitions = (): Board[] => listBoards();

export function showBoard(id: string): Board {
  try {
    return getBoard(id);
  } catch (err) {
    if (err instanceof BoardNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
}

const geometryCache = (): GeometryOptions => ({ cacheDir: join(cacheDir(), "geometry") });

/** For contributors: validates a board folder, regenerating its geometry unless `offline`. */
export function checkBoard(dir: string, opts: Pick<CheckOptions, "offline"> = {}): Promise<CheckResult> {
  return checkBoardDir(resolve(dir), { ...geometryCache(), ...opts });
}

/** `ref` is a board folder, or a board ID looked up under `./boards`. */
function boardFolder(ref: string): string {
  const asPath = resolve(ref);
  return /^[a-z0-9-]+\/[a-z0-9-]+$/.test(ref) ? join(resolve("boards"), ref) : asPath;
}

/** The board `ref` names, read afresh from disk for `serve --board-dev`; the contributor edits board.json while it runs. */
export async function boardDevView(ref: string): Promise<BoardDevView> {
  try {
    return await loadBoardDev(boardFolder(ref));
  } catch (err) {
    if (err instanceof BoardNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
}

/** Regenerates `geometry.json` for a board folder from its pinned firmware tree and writes it. */
export async function regenerateGeometry(ref: string): Promise<{ path: string; keyCount: number; source: string }> {
  const dir = boardFolder(ref);
  let definition;
  try {
    definition = await loadDefinitionDir(dir);
  } catch (err) {
    if (err instanceof BoardNotFoundError) throw new NotFoundError(err.message);
    throw err;
  }
  // A software remapper's geometry is written by hand; there is no firmware tree to derive it from.
  if (definition.firmware === "kanata") throw new UsageError(`${definition.id} is a software remapper: its geometry.json is written by hand, so there is nothing to regenerate`);
  const first = definition.revisions[0];
  if (!first) throw new UsageError("board has no revisions");
  const geometry = await generateGeometry(definition, first, geometryCache());
  const path = join(dir, "geometry.json");
  await Bun.write(path, serializeGeometry(geometry));
  return { path, keyCount: geometry.keys.length, source: "path" in geometry.source ? `${geometry.source.path} @ ${geometry.source.sha}` : geometry.source.note };
}
