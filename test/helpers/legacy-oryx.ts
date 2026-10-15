// A layout as keymap v0.12 stored it: Oryx's colour section as one passthrough piece, and the tap dances as native `TD(DANCE_n)`
// keys with their code kept as passthrough. Built from today's import by undoing what the newer importers model, so it is
// BK's real export in the older shape (D-193).
import type { BoardDefinition } from "../../src/boards/schema.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { parseKeymapC } from "../../src/firmware/qmk/keymap-c.ts";
import type { Binding, Layout } from "../../src/layout/schema.ts";
import { FIXTURE_DIR } from "./board.ts";

export async function modernAndLegacy(board: BoardDefinition): Promise<{ modern: Layout; legacy: Layout }> {
  const modern = (await importOryxSource(FIXTURE_DIR, board)).layout;
  const original = await Bun.file(`${FIXTURE_DIR}/keymap.c`).text();
  const chunks = (await parseKeymapC(original)).chunks;
  const danceChunks = chunks.filter((c) => c.anchor === "tap-dance-codes" || c.anchor === "tap-dance");
  const dances = new Map(modern.tapDances.map((t, i) => [t.id, `TD(DANCE_${i})`]));
  const nativeOf = (b: Binding): Binding => (b.kind === "tapDance" ? { kind: "native", firmware: "qmk", source: dances.get(b.tapDanceId) as string, label: dances.get(b.tapDanceId) as string } : b);
  const rgb = modern.passthrough.filter((p) => p.anchor === "rgb");
  const colourSection = original.slice(original.indexOf("extern rgb_config_t"), original.indexOf("\n}\n", original.indexOf("bool rgb_matrix_indicators_user")) + 2);
  const legacy: Layout = {
    ...modern,
    tapDances: [],
    layers: modern.layers.map(({ lighting: _l, ...l }) => ({ ...l, bindings: l.bindings.map(nativeOf) })),
    combos: modern.combos.map((c) => ({ ...c, output: nativeOf(c.output) })),
    passthrough: [
      ...modern.passthrough.filter((p) => p.anchor !== "rgb"),
      ...rgb.map((p) => ({ ...p, source: colourSection, refersToLayerIndices: true })),
      ...danceChunks.map((c) => ({ firmware: "qmk" as const, file: "keymap.c", anchor: c.anchor, source: c.source, refersToLayerIndices: false })),
    ],
  };
  return { modern, legacy };
}
