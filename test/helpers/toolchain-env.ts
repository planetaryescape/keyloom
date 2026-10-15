// An app, a data directory and a PATH of fake docker, git, zapp and system_profiler: the firmware
// use cases and the CLI run against it without building or flashing anything for real.
import { join } from "node:path";
import { closeApp, importLayout, openApp } from "../../src/app/index.ts";
import { checkoutDirFor } from "../../src/app/firmware.ts";
import { showBoard } from "../../src/app/boards.ts";
import { FAKE_DOCKER, FAKE_GIT, dfuImage, fakeBinDir, withPath } from "./fake-bin.ts";
import { FIXTURE_DIR } from "./board.ts";
import { tempDir } from "./tmp.ts";

export const PIN = "93b2b9ec3368f86c5eb5a2e3f934049f8daef885";
export const REVB = dfuImage("3297:2003", 300);
export const REVA = dfuImage("0483:df11", 300);

export const FAKE_ZAPP_OK = 'echo "Firmware loaded: STM32 DFU (316 bytes)"; sleep 0.3; echo "Flashing"; echo ran >> "$ZAPP_CALLS"; exit 0';
export const FAKE_ZAPP_HANG = 'echo "Firmware loaded: STM32 DFU (316 bytes)"; echo ran >> "$ZAPP_CALLS"; exec sleep 600';
const FAKE_SYSTEM_PROFILER = 'echo "$FAKE_USB"';

export async function toolchainEnv(opts: { zapp?: string } = {}) {
  const root = tempDir();
  const cache = join(root, "cache");
  const dataDir = join(root, "data");
  const bin = fakeBinDir({ docker: FAKE_DOCKER, git: FAKE_GIT, zapp: opts.zapp ?? FAKE_ZAPP_OK, system_profiler: FAKE_SYSTEM_PROFILER });
  const revaFile = join(root, "reva.bin");
  const revbFile = join(root, "revb.bin");
  await Bun.write(revaFile, REVA);
  await Bun.write(revbFile, REVB);
  const vars = {
    XDG_CACHE_HOME: cache, FAKE_MODE: "ok", FAKE_DOCKER_LOG: join(root, "docker.calls"), FAKE_BIN_REVA: revaFile, FAKE_BIN_REVB: revbFile,
    FAKE_GIT_HEAD: PIN, ZAPP_CALLS: join(root, "zapp.calls"), FAKE_USB: '{"SPUSBDataType":[]}',
  };
  // The pinned checkout "exists": a .git folder for the state check and a Makefile for the mount probe.
  const checkout = withPath(bin, async () => checkoutDirFor(showBoard("zsa/moonlander")), vars);
  const dir = await checkout;
  await Bun.$`mkdir -p ${join(dir, ".git")}`;
  await Bun.write(join(dir, "Makefile"), "all:\n");
  const app = openApp({ dataDir });
  const imported = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR });
  const run = <T>(fn: () => Promise<T>, extra: Record<string, string> = {}) => withPath(bin, fn, { ...vars, ...extra });
  return { app, bin, root, dataDir, run, imported, vars, closeApp: () => closeApp(app) };
}

