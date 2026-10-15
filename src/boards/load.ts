import { join } from "node:path";
import { type BoardDefinition, BoardDefinitionSchema, type Geometry, GeometrySchema } from "./schema.ts";

export type Board = {
  definition: BoardDefinition;
  geometry: Geometry;
  /** SKILL.md when the board has one (04). */
  skill?: string;
};

export class BoardNotFoundError extends Error {
  override name = "BoardNotFoundError";
}

export class BoardFormatError extends Error {
  override name = "BoardFormatError";
}

/** Parses the text of board.json and geometry.json; used for both disk and embedded boards. */
export function parseBoard(boardJson: string, geometryJson: string, skill?: string): Board {
  const definition = parseJson(boardJson, "board.json", BoardDefinitionSchema);
  const geometry = parseJson(geometryJson, "geometry.json", GeometrySchema);
  return skill === undefined ? { definition, geometry } : { definition, geometry, skill };
}

function parseJson<T>(text: string, what: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { message: string } } }): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new BoardFormatError(`${what} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BoardFormatError(`${what} is invalid: ${parsed.error.message}`);
  return parsed.data;
}

/** Just `<dir>/board.json`; used to generate the geometry.json that doesn't exist yet. */
export async function loadDefinitionDir(dir: string): Promise<BoardDefinition> {
  const file = Bun.file(join(dir, "board.json"));
  if (!(await file.exists())) throw new BoardNotFoundError(`no board.json in ${dir}`);
  return parseJson(await file.text(), "board.json", BoardDefinitionSchema);
}

/** Loads `<dir>/board.json` and `<dir>/geometry.json`. */
export async function loadBoardDir(dir: string): Promise<Board> {
  const boardFile = Bun.file(join(dir, "board.json"));
  if (!(await boardFile.exists())) throw new BoardNotFoundError(`no board.json in ${dir}`);
  const geometryFile = Bun.file(join(dir, "geometry.json"));
  if (!(await geometryFile.exists())) {
    throw new BoardNotFoundError(`no geometry.json in ${dir}; run: keyloom boards geometry <board>`);
  }
  const skillFile = Bun.file(join(dir, "SKILL.md"));
  const skill = (await skillFile.exists()) ? await skillFile.text() : undefined;
  return parseBoard(await boardFile.text(), await geometryFile.text(), skill);
}
