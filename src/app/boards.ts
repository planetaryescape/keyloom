// Use cases for board definitions: list, show, check, geometry (04, 10).
import { join, resolve } from "node:path";
import { type CheckOptions, type CheckResult, checkBoardDir } from "../boards/check.ts";
import { type GeometryOptions, generateGeometry, serializeGeometry } from "../boards/geometry.ts";
import { type Board, BoardNotFoundError, loadDefinitionDir } from "../boards/load.ts";
import { getBoard, listBoards } from "../boards/registry.ts";
import { cacheDir } from "../persistence/paths.ts";
import { NotFoundError, UsageError } from "./errors.ts";

export type { Board } from "../boards/load.ts";
export type { CheckResult } from "../boards/check.ts";

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
  const first = definition.revisions[0];
  if (!first) throw new UsageError("board has no revisions");
  const geometry = await generateGeometry(definition, first, geometryCache());
  const path = join(dir, "geometry.json");
  await Bun.write(path, serializeGeometry(geometry));
  return { path, keyCount: geometry.keys.length, source: `${geometry.source.path} @ ${geometry.source.sha}` };
}
