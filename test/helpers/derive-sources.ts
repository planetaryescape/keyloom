// The three committed boards, each with the keys of the firmware source file its geometry is generated from (so a test can derive a
// board from its source and compare it with the committed definition without the network).
import { resolveQmk, toGeometryKeys } from "../../src/boards/derive/qmk-info.ts";
import type { GeometryKey } from "../../src/boards/schema.ts";
import { parsePhysicalLayout } from "../../src/boards/zmk-geometry.ts";
import { MOONLANDER_DIR } from "./board.ts";
import { GLOVE80_DIR } from "./zmk.ts";

const fixtures = `${import.meta.dir}/../fixtures`;
export const CORNE_DIR = `${import.meta.dir}/../../boards/foostan/corne`;
export const CORNE_LAYOUT_FIXTURE = `${fixtures}/zmk/corne-physical-layout/6column.dtsi`;
export const GLOVE80_LAYOUT_FIXTURE = `${fixtures}/zmk/glove80-physical-layout/glove80-layouts.dtsi`;
export const MOONLANDER_INFO_FIXTURE = `${fixtures}/qmk/zsa-moonlander-revb-keyboard.json`;

export type SourceBoard = { name: string; dir: string; keys: GeometryKey[] };

export async function sourceBoards(): Promise<SourceBoard[]> {
  const moon = resolveQmk([await Bun.file(MOONLANDER_INFO_FIXTURE).json()]);
  return [
    { name: "Moonlander", dir: MOONLANDER_DIR, keys: toGeometryKeys(moon.layouts.LAYOUT ?? []) },
    { name: "Glove80", dir: GLOVE80_DIR, keys: parsePhysicalLayout(await Bun.file(GLOVE80_LAYOUT_FIXTURE).text()) },
    { name: "Corne", dir: CORNE_DIR, keys: parsePhysicalLayout(await Bun.file(CORNE_LAYOUT_FIXTURE).text()) },
  ];
}
