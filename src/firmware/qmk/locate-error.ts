// Maps a compiler error in the generated keymap.c back to the layer and key it came from, so the
// message says "layer-1, position 31" instead of a line number in a file nobody edits (05#build).
import type { BoardDefinition } from "../../boards/schema.ts";
import { rowGroups } from "./emit-keymap.ts";

const ERROR = /keymaps\/[^/\s:]+\/keymap\.c:(\d+):(\d+): (?:fatal )?error: (.*)$/;

/** Index of the cell the 1-based `column` falls in, counting top-level commas (a hold-tap's own comma is inside parentheses). */
function cellAt(text: string, column: number): number {
  let depth = 0;
  let cell = 0;
  for (let i = 0; i < Math.min(column - 1, text.length); i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) cell++;
  }
  return cell;
}

export type LocatedError = { message: string; layerId: string | undefined; position: number | undefined };

/** The first compiler error in `log`, with its layer and position when it is inside a LAYOUT(...) call. */
export function locateCompileError(log: readonly string[], keymapC: string, board: BoardDefinition): LocatedError | undefined {
  const hit = log.map((l) => ERROR.exec(l)).find((m) => m !== null);
  if (!hit) return undefined;
  const lineNo = Number(hit[1]);
  const column = Number(hit[2]);
  const message = hit[3] as string;
  const lines = keymapC.split("\n");

  // The nearest layer header above the line, and whether its block is still open at the line.
  let header = -1;
  for (let i = Math.min(lineNo - 1, lines.length - 1); i >= 0; i--) {
    if (/^ {2}\[\d+\] = \w+\($/.test(lines[i] as string)) {
      header = i;
      break;
    }
    if (/^ {2}\),$/.test(lines[i] as string)) break;
  }
  if (header < 0) return { message, layerId: undefined, position: undefined };
  const layerId = /^ {2}\/\/ ([^:]+):/.exec(lines[header - 1] ?? "")?.[1];
  const groups = rowGroups(board);
  const row = lineNo - 1 - header - 1;
  const group = groups?.[row] ?? (groups ? undefined : Array.from({ length: board.keyCount }, (_, i) => i));
  const text = lines[lineNo - 1] ?? "";
  const position = group?.[cellAt(text, column)];
  return { message, layerId, position };
}

export function describeLocated(e: LocatedError): string {
  return e.layerId === undefined ? e.message : `${e.layerId}${e.position === undefined ? "" : `, position ${e.position}`}: ${e.message}`;
}
