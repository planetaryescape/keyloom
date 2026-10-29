// The metadata restores the editor's HSV values without a lossy RGB round trip. It is trusted only
// when regenerating it reproduces the entire firmware block, so hand edits cannot be dropped.
import { z } from "zod";
import type { BoardDefinition } from "../../boards/schema.ts";
import { LayerLightingSchema, LayoutSchema } from "../../layout/schema.ts";
import { renderZmkLighting } from "./emit-lighting.ts";
import { ZmkImportError } from "./import-error.ts";

export function readZmkLighting(source: string, board: BoardDefinition) {
  const blocks = [...source.matchAll(/^\/\/ keyloom-rgb-begin (.+)\n[\s\S]*?^\/\/ keyloom-rgb-end$/gm)];
  if (!source.includes("// keyloom-rgb-begin")) return { source, lighting: undefined };
  if (blocks.length !== 1) throw new ZmkImportError("The keyloom RGB block is incomplete or repeated. Import the original keyloom layout export instead.");
  const block = blocks[0]!;
  let parsed: unknown;
  try { parsed = JSON.parse(block[1]!); } catch { throw new ZmkImportError("The keyloom RGB colour metadata is not valid JSON."); }
  const result = z.array(LayerLightingSchema.nullable()).min(1).max(32).safeParse(parsed);
  if (!result.success) throw new ZmkImportError("The keyloom RGB colour metadata has invalid colours or layers.");
  const lighting = result.data;
  const stub = LayoutSchema.parse({
    schemaVersion: 1, boardId: board.id, firmware: "zmk", macros: [], combos: [], holdTapProfiles: [], settings: [], passthrough: [],
    layers: lighting.map((colours, i) => ({ id: `layer-${i}`, name: `Layer ${i}`, bindings: [], ...(colours === null ? {} : { lighting: colours }) })),
  });
  let expected: string;
  try { expected = renderZmkLighting(stub, board).join("\n"); } catch (err) {
    throw new ZmkImportError(`Cannot restore RGB colours for this board: ${(err as Error).message}`);
  }
  if (expected !== block[0]) throw new ZmkImportError("The generated RGB source was edited or its LED map changed. Import the original keyloom layout export to preserve the intended colours.");
  const clean = source.replace(block[0], "").replace(/&(klrgb|klfx)\s+(RGB_[A-Z_]+)/g, (call, device: string, command: string) => {
    const global = /^RGB_(TOG|ON|OFF|BRI|BRD)(?:_CMD)?$/.test(command);
    const effect = /^RGB_(HUI|HUD|SAI|SAD|SPI|SPD|EFF|EFR|EFS|COLOR_HSB)(?:_CMD)?$/.test(command);
    if ((device === "klrgb" && global) || (device === "klfx" && effect)) return `&rgb_ug ${command}`;
    throw new ZmkImportError(`Cannot restore the edited RGB binding ${call}; import the keyloom layout export instead.`);
  });
  return { source: clean, lighting };
}
