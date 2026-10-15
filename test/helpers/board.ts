import { loadBoardDir } from "../../src/boards/load.ts";

export const MOONLANDER_DIR = `${import.meta.dir}/../../boards/zsa/moonlander`;
export const FIXTURE_DIR = `${import.meta.dir}/../fixtures/oryx/synchronized`;

export const moonlander = () => loadBoardDir(MOONLANDER_DIR);
