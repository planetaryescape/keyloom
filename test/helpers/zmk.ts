// Fixtures and fakes for the Glove80 (ZMK) tests: the board, the two keymaps, UF2 files and a docker that
// stands in for MoErgo's Nix build. Nothing here runs a real build or touches a real volume.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBoardDir } from "../../src/boards/load.ts";
import type { BoardDefinition } from "../../src/boards/schema.ts";
import { git } from "./git-fixture.ts";
import { tempDir } from "./tmp.ts";

export const GLOVE80_DIR = `${import.meta.dir}/../../boards/moergo/glove80`;
/** MoErgo's default keymap from the template, unchanged (see the README beside it). */
export const TEMPLATE_FIXTURE = `${import.meta.dir}/../fixtures/zmk/glove80-template`;
/** Written by hand in the Layout Editor's shape, with modelled hold-taps, macros and combos. */
export const STYLE_FIXTURE = `${import.meta.dir}/../fixtures/zmk/layout-editor-style`;

export const glove80 = () => loadBoardDir(GLOVE80_DIR);

/** One half's UF2 image: `blocks` blocks of 256 payload bytes for `family`, counting up from block 0. */
export function uf2Image(family: number, blocks: number, address = 0x26000): Uint8Array {
  const out = new Uint8Array(blocks * 512);
  const view = new DataView(out.buffer);
  for (let i = 0; i < blocks; i++) {
    const o = i * 512;
    view.setUint32(o, 0x0a324655, true);
    view.setUint32(o + 4, 0x9e5d5157, true);
    view.setUint32(o + 8, 0x2000, true);
    view.setUint32(o + 12, address + i * 256, true);
    view.setUint32(o + 16, 256, true);
    view.setUint32(o + 20, i, true);
    view.setUint32(o + 24, blocks, true);
    view.setUint32(o + 28, family, true);
    out.fill(0x5a, o + 32, o + 32 + 256);
    view.setUint32(o + 508, 0x0ab16f30, true);
  }
  return out;
}

/** What the build produces: the left and right images end to end, at the same addresses, told apart by family. */
export function combinedUf2(): Uint8Array {
  const a = uf2Image(0x9807b007, 6);
  const b = uf2Image(0x9808b007, 4);
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** A local git repo standing in for MoErgo's template: it has config/default.nix, which the build checks it can see. */
export function templateRepo(): { url: string; sha: string; dir: string } {
  const dir = join(tempDir("keyloom-template-"), "glove80-zmk-config");
  mkdirSync(join(dir, "config"), { recursive: true });
  git(dir, "init", "--quiet", "-b", "main");
  writeFileSync(join(dir, "config", "default.nix"), "{}\n");
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "template");
  return { url: `file://${dir}`, sha: git(dir, "rev-parse", "HEAD"), dir };
}

/** The board with its template pointed at a local repo, so a build can clone it. */
export function boardWithTemplate(board: BoardDefinition, repo: { url: string; sha: string }): BoardDefinition {
  return {
    ...board,
    revisions: board.revisions.map((r) => ({ ...r, build: { ...r.build, template: { repo: repo.url, sha: repo.sha } } })),
  };
}

// Stands in for `docker`: `version`, `image inspect`, `build`, `rm`, the probe that the container can see the
// checkout, and the build itself. Modes (FAKE_MODE): ok, nobin, badbin, compile, disk, hang, nodaemon.
// FAKE_IMAGE=missing makes `image inspect` fail until a `build` has run.
export const FAKE_DOCKER_ZMK = `
case "$1" in
  version) [ "$FAKE_MODE" = nodaemon ] && exit 1; echo 28.0.0; exit 0;;
  rm) echo "$@" >> "$FAKE_DOCKER_LOG"; exit 0;;
  image) echo "$@" >> "$FAKE_DOCKER_LOG"; [ "$FAKE_IMAGE" = missing ] && [ ! -f "$FAKE_IMAGE_MARK" ] && exit 1; exit 0;;
  build) echo "$@" >> "$FAKE_DOCKER_LOG"; touch "$FAKE_IMAGE_MARK"; echo "Step 1/6 : FROM nixpkgs/nix"; exit 0;;
esac
echo "$@" >> "$FAKE_DOCKER_LOG"
vol=""; prev=""
for a in "$@"; do [ "$prev" = "-v" ] && vol="\${a%%:/config}"; prev="$a"; done
case " $* " in *" --entrypoint sh "*) [ -f "$vol/config/default.nix" ] || exit 1; rm -f "$vol/glove80.uf2"; exit 0;; esac
case "$FAKE_MODE" in
  ok) cp "$FAKE_UF2" "$vol/glove80.uf2"; echo "building zmk_glove80_lh.drv"; exit 0;;
  nobin) echo "nix-build finished"; exit 0;;
  badbin) echo "not a uf2" > "$vol/glove80.uf2"; exit 0;;
  compile) echo "/nix/store/abc-glove80.keymap:$FAKE_LINE:$FAKE_COL: error: 'NOPE' undeclared"; exit 1;;
  disk) echo "cp: write error: No space left on device"; exit 1;;
  hang) echo started; exec sleep 600;;
esac
exit 9
`;

// An app, a data directory, a PATH of fake docker and git, and a directory standing in for /Volumes: the
// firmware use cases and the CLI run a Glove80 import, build and flash against it without touching anything real.
import { join as joinPath } from "node:path";
import { checkoutDirFor } from "../../src/app/firmware.ts";
import { showBoard } from "../../src/app/boards.ts";
import { closeApp, importLayout, openApp } from "../../src/app/index.ts";
import { FAKE_GIT, fakeBinDir, withPath } from "./fake-bin.ts";

export async function zmkEnv(opts: { keymap?: string } = {}) {
  const root = tempDir();
  const cache = joinPath(root, "cache");
  const dataDir = joinPath(root, "data");
  const volumes = joinPath(root, "Volumes");
  mkdirSync(volumes, { recursive: true });
  const bin = fakeBinDir({ docker: FAKE_DOCKER_ZMK, git: FAKE_GIT });
  const uf2 = joinPath(root, "glove80.uf2");
  await Bun.write(uf2, combinedUf2());
  const board = showBoard("moergo/glove80");
  const template = (board.definition.revisions[0]?.build as unknown as { template: { sha: string } }).template;
  const vars = {
    XDG_CACHE_HOME: cache, FAKE_MODE: "ok", FAKE_DOCKER_LOG: joinPath(root, "docker.calls"), FAKE_UF2: uf2, FAKE_IMAGE_MARK: joinPath(root, "image.mark"),
    FAKE_GIT_HEAD: template.sha,
  };
  // The pinned checkout "exists": a .git folder for the state check and config/default.nix for the mount probe.
  const dir = await withPath(bin, async () => checkoutDirFor(board), vars);
  mkdirSync(joinPath(dir, ".git"), { recursive: true });
  mkdirSync(joinPath(dir, "config"), { recursive: true });
  await Bun.write(joinPath(dir, "config", "default.nix"), "{}\n");
  const app = openApp({ dataDir });
  const imported = await importLayout(app, { board: "moergo/glove80", source: opts.keymap ?? TEMPLATE_FIXTURE });
  const run = <T>(fn: () => Promise<T>, extra: Record<string, string> = {}) => withPath(bin, fn, { ...vars, ...extra });
  return { app, root, dataDir, volumes, checkout: dir, run, imported, vars, closeApp: () => closeApp(app) };
}

/** A fake bootloader for `volumes`: each boot drive that gets a .uf2 written to it unmounts, as a real one does. */
export function fakeBootloaders(volumes: string, labels: readonly string[], opts: { mountAfterMs?: number[] } = {}) {
  const written: string[] = [];
  labels.forEach((label, i) => setTimeout(() => mkdirSync(joinPath(volumes, label), { recursive: true }), opts.mountAfterMs?.[i] ?? 50 + i * 400));
  const timer = setInterval(() => {
    for (const label of labels) {
      if (!written.includes(label) && existsSync(joinPath(volumes, label, "glove80.uf2"))) {
        written.push(label);
        setTimeout(() => rmSync(joinPath(volumes, label), { recursive: true, force: true }), 30);
      }
    }
  }, 10);
  return { written, stop: () => clearInterval(timer) };
}
