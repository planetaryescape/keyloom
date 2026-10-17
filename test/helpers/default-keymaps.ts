// The firmware trees' default keymaps, from fixtures: a blank config looks for them on GitHub in life, and no test does (D-370).
import type { TextFetcher } from "../../src/boards/geometry.ts";
import { FIXTURE_DIR } from "./board.ts";
import { TEMPLATE_FIXTURE } from "./zmk.ts";

const CORNE = `${import.meta.dir}/../fixtures/zmk/corne/corne.keymap`;

/** What each board's pinned tree would answer for its default keymap; everything else is a 404, like a board with none. */
export function defaultKeymapTree(requested: string[] = []): TextFetcher {
  return async (url) => {
    requested.push(url);
    if (url.endsWith("/keyboards/zsa/moonlander/keymaps/default/keymap.c")) return Bun.file(`${FIXTURE_DIR}/keymap.c`).text();
    if (url.endsWith("/glove80-zmk-config/34888be8c9d9a3d5b168a502b8b191ba43b4a1f3/config/glove80.keymap")) return Bun.file(`${TEMPLATE_FIXTURE}/glove80.keymap`).text();
    if (url.endsWith("/zmk/edf5c0814fd3ea202e43aad2d68fd32e882a518c/app/boards/shields/corne/corne.keymap")) return Bun.file(CORNE).text();
    throw new Error(`GET ${url} returned 404`);
  };
}

/** A tree with no default keymaps at all. */
export const emptyTree: TextFetcher = async (url) => {
  throw new Error(`GET ${url} returned 404`);
};
