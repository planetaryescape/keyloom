import { z } from "zod";
import { GeometryKeySchema, type GeometryKey } from "../../boards/schema.ts";
import { readStored, writeStored } from "./storage.ts";

// The first load shows caps in the board's shape (18#states). The shape isn't known until the layout arrives, so
// the last one seen for each board is kept in this browser and drawn the next time; a first visit gets a generic split board.
const KEY = (boardId: string) => `keyloom.shape.${boardId}`;
const LAST = "keyloom.shape.last";
const ShapeSchema = z.object({
  keys: z.array(GeometryKeySchema).min(1).max(200),
  /** Positions of the left hand's keys: a phone shows one hand, so its skeleton does too. */
  left: z.array(z.number().int().nonnegative()).max(200),
});
export type Shape = z.infer<typeof ShapeSchema>;

export function rememberShape(boardId: string, keys: readonly GeometryKey[], left: readonly number[]): void {
  writeStored(KEY(boardId), JSON.stringify({ keys, left }));
  writeStored(LAST, boardId);
}

function read(boardId: string): Shape | null {
  const raw = readStored(KEY(boardId));
  if (raw === null) return null;
  try {
    const parsed = ShapeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const cell = (x: number, y: number): GeometryKey => ({ x, y, w: 1, h: 1, r: 0, rx: 0, ry: 0 });

/** Two hands of four rows by six columns with a thumb row under each: stands in until a board has been seen. */
function generic(): Shape {
  const keys: GeometryKey[] = [];
  const left: number[] = [];
  for (const offset of [0, 8]) {
    for (let row = 0; row < 4; row++) for (let column = 0; column < 6; column++) (offset === 0 ? left : []).push(keys.push(cell(offset + column, row)) - 1);
    for (let column = 0; column < 3; column++) (offset === 0 ? left : []).push(keys.push(cell(offset + 2 + column, 4.2)) - 1);
  }
  return { keys, left };
}

/** The remembered shape of `boardId`, else the last board seen, else the generic one. */
export function shapeFor(boardId: string | null): Shape {
  return (boardId === null ? null : read(boardId)) ?? read(readStored(LAST) ?? "") ?? generic();
}
