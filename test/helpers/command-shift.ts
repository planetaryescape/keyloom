// BK's real Moonlander import with no edits, for the Command-Shift scenario (D-020, D-025). Its base
// layer has no free key, so a Command-Shift key there must displace something.
import { importLayout, openApp } from "../../src/app/index.ts";
import { FIXTURE_DIR } from "./board.ts";
import { tempDir } from "./tmp.ts";

/** Base-layer positions in the fixture that the scenario talks about. */
export const BACKSPACE_POSITION = 28;
export const TAB_POSITION = 42;
export const F16_POSITION = 6;

export async function commandShiftApp() {
  const dir = tempDir();
  const app = openApp({ dataDir: dir });
  const imported = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "bk" });
  return { app, dir, layoutId: imported.layoutId };
}
