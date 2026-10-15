// Boards that exist only in tests: a mainline-QMK board and an upstream-ZMK board, written the way a
// contributor would write them, plus the firmware-tree files geometry is generated from.
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Board, parseBoard } from "../../src/boards/load.ts";
import { type GeometryOptions, generateGeometry, serializeGeometry } from "../../src/boards/geometry.ts";
import { loadDefinitionDir } from "../../src/boards/load.ts";
import { tempDir } from "./tmp.ts";

export const TEMPLATES = `${import.meta.dir}/../../boards/_template`;

/** Four keys, two rows: enough to generate geometry for the template boards. */
export const QMK_INFO = JSON.stringify({
  layouts: { LAYOUT: { layout: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] } },
});

export const ZMK_LAYOUT = `
/ { layout: layout { compatible = "zmk,physical-layout"; keys
  = <&key_physical_attrs 100 100 0 0 0 0 0>
  , <&key_physical_attrs 100 100 100 0 0 0 0>
  , <&key_physical_attrs 100 100 0 100 0 0 0>
  , <&key_physical_attrs 100 100 100 100 0 0 0>; }; };`;

export const fetchFor = (text: string): NonNullable<GeometryOptions["fetchText"]> => async () => text;

/** Copies `boards/_template/<kind>` to `<tmp>/vendor/board`, where its own id says it lives, and writes its geometry. */
export async function templateCopy(kind: "qmk" | "zmk", edit?: (board: Record<string, any>) => void): Promise<string> {
  const dir = join(tempDir(), "vendor", "board");
  mkdirSync(dir, { recursive: true });
  cpSync(join(TEMPLATES, kind), dir, { recursive: true });
  if (edit) {
    const board = await Bun.file(join(dir, "board.json")).json();
    edit(board);
    await Bun.write(join(dir, "board.json"), JSON.stringify(board));
  }
  const def = await loadDefinitionDir(dir);
  const geometry = await generateGeometry(def, def.revisions[0] as never, { fetchText: fetchFor(kind === "qmk" ? QMK_INFO : ZMK_LAYOUT) });
  await Bun.write(join(dir, "geometry.json"), serializeGeometry(geometry));
  return dir;
}

export type { Board };
export { parseBoard };
