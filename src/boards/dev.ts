// What `keyloom serve --board-dev` shows a contributor: the board's keys and whichever of hands,
// fingers, rows and mirror they have filled in so far (04, step 4). Unlike loadBoardDir this accepts
// a board.json that is still being written, because the overlay is how the rest of it gets written.
import { join } from "node:path";
import { z } from "zod";
import { BoardNotFoundError } from "./load.ts";
import { BoardDefinitionSchema, GeometrySchema } from "./schema.ts";

const shape = BoardDefinitionSchema.shape;

export const BoardDevViewSchema = z.object({
  name: z.string(),
  id: z.string(),
  firmware: z.string(),
  geometry: GeometrySchema,
  display: shape.display,
  hands: shape.hands,
  fingers: shape.fingers,
  rows: shape.rows,
  mirror: shape.mirror,
  /** What in board.json could not be read, in words; the rest of the view still stands. */
  problems: z.array(z.string()),
});
export type BoardDevView = z.infer<typeof BoardDevViewSchema>;

/** Reads `<dir>/board.json` and `<dir>/geometry.json`; every part of board.json that doesn't parse is reported and left empty. */
export async function loadBoardDev(dir: string): Promise<BoardDevView> {
  const geometryFile = Bun.file(join(dir, "geometry.json"));
  if (!(await geometryFile.exists())) throw new BoardNotFoundError(`no geometry.json in ${dir}; run: keyloom boards geometry ${dir}`);
  const geometry = GeometrySchema.parse(JSON.parse(await geometryFile.text()));

  const problems: string[] = [];
  let raw: Record<string, unknown> = {};
  const boardFile = Bun.file(join(dir, "board.json"));
  if (!(await boardFile.exists())) problems.push("there is no board.json yet");
  else {
    try {
      raw = JSON.parse(await boardFile.text()) as Record<string, unknown>;
    } catch (err) {
      problems.push(`board.json is not valid JSON: ${(err as Error).message}`);
    }
  }

  const field = <T>(name: string, schema: z.ZodType<T>, empty: T): T => {
    if (raw[name] === undefined) return empty;
    const parsed = schema.safeParse(raw[name]);
    if (parsed.success) return parsed.data;
    problems.push(`${name} in board.json is invalid: ${parsed.error.issues[0]?.message ?? "unreadable"}`);
    return empty;
  };

  return {
    name: field("name", z.string(), "New board"),
    id: field("id", z.string(), ""),
    firmware: field("firmware", z.string(), ""),
    geometry,
    display: field("display", shape.display, undefined),
    hands: field("hands", shape.hands, { left: [], right: [] }),
    fingers: field("fingers", shape.fingers, {}),
    rows: field("rows", shape.rows, {}),
    mirror: field("mirror", shape.mirror, {}),
    problems,
  };
}

export type PositionFacts = { hand: "left" | "right" | null; finger: string | null; row: string | null; mirror: number | null };

/** What board.json says about one position so far. */
export function positionFacts(view: BoardDevView, position: number): PositionFacts {
  return {
    hand: view.hands.left.includes(position) ? "left" : view.hands.right.includes(position) ? "right" : null,
    finger: view.fingers[String(position)] ?? null,
    row: Object.entries(view.rows).find(([, ps]) => ps.includes(position))?.[0] ?? null,
    mirror: view.mirror[String(position)] ?? null,
  };
}

/** How many of the board's positions each fact covers; the contributor is done when all four equal `keys`. */
export function coverage(view: BoardDevView): { keys: number; hands: number; fingers: number; rows: number; mirror: number } {
  const n = view.geometry.keys.length;
  const inRange = (ps: Iterable<number>) => new Set([...ps].filter((p) => p < n)).size;
  return {
    keys: n,
    hands: inRange([...view.hands.left, ...view.hands.right]),
    fingers: inRange(Object.keys(view.fingers).map(Number).filter(Number.isInteger)),
    rows: inRange(Object.values(view.rows).flat()),
    // A mirror pair covers two positions; the left half's entries are the ones a contributor writes.
    mirror: Object.keys(view.mirror).length,
  };
}
