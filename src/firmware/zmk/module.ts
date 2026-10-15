// keyloom's ZMK module (firmware/zmk/keyloom-zmk, D-095), embedded in the binary and written out beside each
// build, so a released keyloom needs no checkout of this repository (the Dockerfile in image.ts is shipped the same way).
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFresh } from "../toolchain/write-fresh.ts";
import CMAKE from "../../../firmware/zmk/keyloom-zmk/CMakeLists.txt" with { type: "text" };
import KCONFIG from "../../../firmware/zmk/keyloom-zmk/Kconfig" with { type: "text" };
import OVERLAY from "../../../firmware/zmk/keyloom-zmk/keyloom-cdc-acm.overlay" with { type: "text" };
import HANDSFREE_C from "../../../firmware/zmk/keyloom-zmk/src/handsfree.c" with { type: "text" };
import SERIAL_C from "../../../firmware/zmk/keyloom-zmk/src/serial.c" with { type: "text" };
import MODULE_YML from "../../../firmware/zmk/keyloom-zmk/zephyr/module.yml" with { type: "text" };

/** Folder name of the module inside a build's work folder (`/config/keyloom-zmk` or `/work/keyloom-zmk` in the container). */
export const MODULE_DIR = "keyloom-zmk";
/** The overlay that adds the serial port; the build passes it as EXTRA_DTC_OVERLAY_FILE. */
export const OVERLAY_FILE = "keyloom-cdc-acm.overlay";

export const MODULE_FILES: Readonly<Record<string, string>> = {
  "CMakeLists.txt": CMAKE,
  Kconfig: KCONFIG,
  [OVERLAY_FILE]: OVERLAY,
  "src/handsfree.c": HANDSFREE_C,
  "src/serial.c": SERIAL_C,
  "zephyr/module.yml": MODULE_YML,
};

/** Replaces `<workDir>/keyloom-zmk` with the embedded module, so no file left from another version is built. */
export async function writeModule(workDir: string): Promise<string> {
  const dir = join(workDir, MODULE_DIR);
  await rm(dir, { recursive: true, force: true });
  for (const [path, content] of Object.entries(MODULE_FILES)) {
    await writeFresh(join(dir, path), content);
  }
  return dir;
}
