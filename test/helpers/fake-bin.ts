import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./tmp.ts";

/** A directory of fake executables, to put on PATH in place of docker, zapp or git. Nothing here ever runs the real tool. */
export function fakeBinDir(scripts: Record<string, string>): string {
  const dir = tempDir("keyloom-bin-");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(scripts)) {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  }
  return dir;
}

/** Runs `fn` with `dir` first on PATH, then restores it. */
export async function withPath<T>(dir: string, fn: () => Promise<T>, env: Record<string, string> = {}): Promise<T> {
  const saved = { PATH: process.env.PATH, ...Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]])) };
  process.env.PATH = `${dir}:${process.env.PATH}`;
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A well-formed DFU file for `vid:pid`: payload, then the 16-byte suffix with a real CRC. */
export function dfuImage(bootloader: string, payloadBytes = 64): Uint8Array {
  const [vid, pid] = bootloader.split(":").map((h) => Number.parseInt(h as string, 16)) as [number, number];
  const out = new Uint8Array(payloadBytes + 16);
  for (let i = 0; i < payloadBytes; i++) out[i] = (i * 7) & 0xff;
  const view = new DataView(out.buffer);
  const s = payloadBytes;
  view.setUint16(s + 0, 0xffff, true);
  view.setUint16(s + 2, pid, true);
  view.setUint16(s + 4, vid, true);
  view.setUint16(s + 6, 0x0100, true);
  out.set([0x55, 0x46, 0x44, 16], s + 8);
  view.setUint32(s + 12, ~Bun.hash.crc32(out.subarray(0, s + 12)) >>> 0, true);
  return out;
}

// Stands in for `docker`: `version`, `rm`, the "can the container see the checkout" probe, and `make`.
// Modes (FAKE_MODE): ok, nobin, compile, disk, hang, nodaemon.
export const FAKE_DOCKER = `
case "$1" in
  version) [ "$FAKE_MODE" = nodaemon ] && exit 1; echo 28.0.0; exit 0;;
  rm) echo "$@" >> "$FAKE_DOCKER_LOG"; exit 0;;
esac
echo "$@" >> "$FAKE_DOCKER_LOG"
vol=""; prev=""
for a in "$@"; do [ "$prev" = "-v" ] && vol="\${a%%:/qmk_firmware}"; prev="$a"; done
case " $* " in *" test -f Makefile "*) [ -f "$vol/Makefile" ] && exit 0 || exit 1;; esac
for a in "$@"; do target="$a"; done
id="$(echo "\${target%%:*}" | tr / _)_keyloom"
case "$id" in *reva*) bin="$FAKE_BIN_REVA";; *) bin="$FAKE_BIN_REVB";; esac
case "$FAKE_MODE" in
  ok) mkdir -p "$vol/.build"; cp "$bin" "$vol/.build/$id.bin"; echo "Compiling: quantum/keymap.c  [OK]"; exit 0;;
  nobin) echo "make finished"; exit 0;;
  compile) echo "keyboards/zsa/moonlander/keymaps/keyloom/keymap.c:$FAKE_LINE:$FAKE_COL: error: 'KC_NOPE' undeclared"; exit 2;;
  disk) echo "cp: write error: No space left on device"; exit 2;;
  hang) echo started; exec sleep 600;;
esac
exit 9
`;


// Stands in for git where the app looks at the pinned checkout: HEAD is whatever PINNED says, and
// every requested submodule is initialised and at its recorded commit.
export const FAKE_GIT = `
shift 2
case "$1" in
  rev-parse) echo "$FAKE_GIT_HEAD"; exit 0;;
  submodule)
    shift 3
    for p in "$@"; do echo " 0000000000000000000000000000000000000000 $p (heads/x)"; done
    exit 0;;
esac
exit 9
`;
