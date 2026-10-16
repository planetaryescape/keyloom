// keyloom serve on BK's layouts with a fake Moonlander and a fake Glove80, for looking at keyboard sync in a browser and for the
// screenshot gate (18). Nothing here can reach a real device: docker, git and zapp are scripts on PATH, USB, raw HID and serial ports
// are in memory, and the real transports are refused (no-real-flash.ts).
//
//   bun test/helpers/demo-sync.ts <data dir> <port> <work dir>
//
// The data dir is a copy of a database with a Moonlander and a Glove80 layout. The work dir holds `control.json`, which is read twice
// a second: {"build": "ok"|"compile", "moonlander": "connected"|"unplugged"|"other"|"no_hid", "glove80": "connected"|"unplugged"|"other"}, and the files
// `hold-build` and `hold-flash`, which make a build or a flash wait for as long as they exist. `press-reset` simulates the reset key.
import "./no-real-flash.ts";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkoutDirFor } from "../../src/app/firmware.ts";
import { showBoard } from "../../src/app/boards.ts";
import { getBuild, getLayout, listConfigs, listLayouts, openApp } from "../../src/app/index.ts";
import { appSyncDeps } from "../../src/app/sync-deps.ts";
import { buildMarker } from "../../src/firmware/qmk/handsfree.ts";
import { buildKey } from "../../src/firmware/zmk/handsfree.ts";
import { serve } from "../../src/cli/serve.ts";
import { createBuild, finishBuild, newBuildId } from "../../src/persistence/builds.ts";
import { recordHandsFreeProof } from "../../src/persistence/syncs.ts";
import { FAKE_DOCKER, FAKE_GIT, dfuImage } from "./fake-bin.ts";
import { fakeElf } from "./fake-elf.ts";
import { REPEATING_ZAPP, liveKeyboard, stampMarker } from "./fake-live-keyboard.ts";
import { FAKE_DOCKER_ZMK, combinedUf2 } from "./zmk.ts";
import { fakeWorld, glove80Image, serialOf } from "./fake-zmk-halves.ts";

const [dataDir, portArg, workDir] = process.argv.slice(2);
if (!dataDir || !portArg || !workDir) throw new Error("usage: bun test/helpers/demo-sync.ts <data dir> <port> <work dir>");
mkdirSync(workDir, { recursive: true });
const w = (name: string) => join(workDir, name);

// --- fake tools on PATH -------------------------------------------------------------------------------------------
const wait = `case " $* " in *" test -f Makefile "*|*" --entrypoint sh "*) ;; *) while [ -f "$HOLD_BUILD" ]; do sleep 0.2; done; sleep "\${FAKE_BUILD_SECONDS:-0}";; esac`;
const withWait = (script: string) => script.replace('vol=""; prev=""', `${wait}\nvol=""; prev=""`);
const docker = `case " $* " in *":/qmk_firmware"*) ${withWait(FAKE_DOCKER)};; *) ${withWait(FAKE_DOCKER_ZMK)};; esac`;
const git = `dir="$2"; shift 2
case "$1" in
  rev-parse) case "$dir" in *glove80*) echo "$GLV_PIN";; *) echo "$QMK_PIN";; esac; exit 0;;
  submodule) shift 3; for p in "$@"; do echo " 0000000000000000000000000000000000000000 $p (heads/x)"; done; exit 0;;
esac
exit 9`;
const zapp = REPEATING_ZAPP.replace('echo "Flashing"; sleep 0.1;', 'echo "Flashing"; while [ -f "$HOLD_FLASH" ]; do sleep 0.2; done; sleep 0.3;');
const bin = w("bin");
mkdirSync(bin, { recursive: true });
for (const [name, body] of Object.entries({ docker, git, zapp, system_profiler: 'echo \'{"SPUSBDataType":[]}\'' })) {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
}
const moonlanderBoard = showBoard("zsa/moonlander");
const glove = showBoard("moergo/glove80");
const glvPin = (glove.definition.revisions[0]?.build as unknown as { template: { sha: string } }).template.sha;
const qmkPin = "93b2b9ec3368f86c5eb5a2e3f934049f8daef885";
Object.assign(process.env, {
  PATH: `${bin}:${process.env.PATH}`, XDG_CACHE_HOME: w("cache"), FAKE_MODE: "ok", FAKE_DOCKER_LOG: w("docker.calls"), FAKE_BIN_REVA: w("reva.bin"), FAKE_BIN_REVB: w("revb.bin"),
  FAKE_ELF: w("firmware.elf"), FAKE_UF2: w("glove80.uf2"), FAKE_IMAGE_MARK: w("image.mark"), HOLD_BUILD: w("hold-build"), HOLD_FLASH: w("hold-flash"),
  BOOTLOADER_FLAG: w("in-bootloader"), ZAPP_CALLS: w("zapp.calls"), QMK_PIN: qmkPin, GLV_PIN: glvPin, FAKE_BUILD_SECONDS: process.env.FAKE_BUILD_SECONDS ?? "4",
});
await Bun.write(w("reva.bin"), dfuImage("0483:df11", 300));
await Bun.write(w("revb.bin"), dfuImage("3297:2003", 300));
await Bun.write(w("firmware.elf"), fakeElf(["__wrap_raw_hid_receive", "__wrap_action_exec", "raw_hid_receive"]));
await Bun.write(w("glove80.uf2"), combinedUf2());
for (const dir of [checkoutDirFor(moonlanderBoard), checkoutDirFor(glove)]) {
  mkdirSync(join(dir, ".git"), { recursive: true });
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "Makefile"), "all:\n");
  writeFileSync(join(dir, "config", "default.nix"), "{}\n");
}

// --- the app, and what each keyboard already runs ---------------------------------------------------------------
const app = openApp({ dataDir });
const layouts = listLayouts(app);
// Each keyboard runs its board's config (D-300), which with several configs isn't necessarily the first layout listed.
const keyboardConfig = (boardId: string) => listConfigs(app, { board: boardId }).find((c) => c.onKeyboard)?.id;
const moon = layouts.find((l) => l.id === keyboardConfig("zsa/moonlander")) ?? layouts.find((l) => l.boardId === "zsa/moonlander");
const glv = layouts.find((l) => l.id === keyboardConfig("moergo/glove80")) ?? layouts.find((l) => l.boardId === "moergo/glove80");
if (!moon || !glv) throw new Error("the data dir needs a Moonlander layout and a Glove80 layout");

function seedBuild(layoutId: string, boardRevision: string): string {
  const id = newBuildId();
  createBuild(app.db, { id, revisionId: getLayout(app, layoutId).revision.id, layoutId, boardRevision, logPath: `logs/${id}.log` });
  finishBuild(app.db, id, { artifactPath: `artifacts/${id}.bin` });
  return id;
}
const moonBuild = seedBuild(moon.id, "reva");
const glvBuild = seedBuild(glv.id, "default");
recordHandsFreeProof(app.db, "zsa/moonlander", moonBuild);
recordHandsFreeProof(app.db, "moergo/glove80", glvBuild);

const moonKeyboard = liveKeyboard(workDir, buildMarker(moonBuild));
const volumes = w("Volumes");
mkdirSync(volumes, { recursive: true });
const half = (letter: "L" | "R") => ({ letter, volume: letter === "L" ? "GLV80LHBOOT" : "GLV80RHBOOT", serial: serialOf(buildKey(glvBuild), letter) });
const glvWorld = fakeWorld({ root: volumes, halves: [half("L"), half("R")] });

const handsFree = { ...moonKeyboard.deps, zmk: glvWorld.deps };
const base = appSyncDeps(app, { handsFree, volumesRoot: volumes, bootloaderWaitMs: 60_000 });
const deps = {
  ...base,
  // The fake docker's firmware has no marker in it; give each build the one a real build carries, and make the fake keyboard expect it.
  build: async (a: Parameters<typeof base.build>[0]) => {
    const r = await base.build(a);
    if (r.ok && !r.reused) {
      const built = await getBuild(app, r.buildId);
      if (a.layoutId === glv?.id) await Bun.write(built.artifactPath as string, glove80Image(buildKey(r.buildId)));
      else {
        moonKeyboard.state.expected = buildMarker(r.buildId);
        await stampMarker(built.artifactPath as string, buildMarker(r.buildId));
      }
    }
    return r;
  },
};

// --- the control file ---------------------------------------------------------------------------------------------
type Control = { build?: "ok" | "compile"; moonlander?: "connected" | "unplugged" | "other" | "no_hid"; glove80?: "connected" | "unplugged" | "other" };
let applied = "";
const glvSerials = glvWorld.halves.map((h) => h.serial);
setInterval(() => {
  if (existsSync(w("press-reset"))) {
    rmSync(w("press-reset"));
    void moonKeyboard.pressReset();
  }
  let control: Control = {};
  try {
    control = JSON.parse(readFileSync(w("control.json"), "utf8")) as Control;
  } catch {
    return;
  }
  const text = JSON.stringify(control);
  if (text === applied) return;
  applied = text;
  process.env.FAKE_MODE = control.build ?? "ok";
  process.env.FAKE_LINE = "12";
  process.env.FAKE_COL = "3";
  const m = moonKeyboard.state;
  m.noHid = control.moonlander === "no_hid";
  if (control.moonlander === "unplugged") moonKeyboard.unplug();
  else {
    if (m.mode === "gone") moonKeyboard.plugIn();
    if (control.moonlander === "other") m.serial = "QxKPz/zLQ3Md";
    else if (m.serial === "QxKPz/zLQ3Md") m.serial = m.expected ?? buildMarker(moonBuild);
  }
  glvWorld.halves.forEach((h, i) => {
    if (control.glove80 === "unplugged") delete h.serial;
    else if (control.glove80 === "other") h.serial = "moergo.com:GLV80-0123456789ABCDEF";
    else if (h.serial === undefined || h.serial.startsWith("moergo.com")) h.serial = glvSerials[i] as string;
  });
}, 400);

const running = serve(app, { port: Number(portArg), open: false, handsFree, syncDeps: deps, flash: { volumesRoot: volumes, bootloaderWaitMs: 60_000 } });
console.log(running.url);
