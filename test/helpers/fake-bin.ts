import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./tmp.ts";

const syntheticExecutables = new Set<string>();
/** The device guard permits only fixtures created in this process, never the machine's profiler. */
export const isSyntheticExecutable = (path: string): boolean => syntheticExecutables.has(path);

/** A directory of fake executables, to put on PATH in place of docker, zapp or git. Nothing here ever runs the real tool. */
export function fakeBinDir(scripts: Record<string, string>): string {
  const dir = tempDir("keyloom-bin-");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(scripts)) {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    syntheticExecutables.add(path);
  }
  return dir;
}

type Scope = { dir: string; env: Record<string, string> };
let activeScopes: Scope[] = [];
// What each variable held before the first scope that touched it. Cleared when the last scope ends.
let original = new Map<string, string | undefined>();

/**
 * Runs `fn` with `dir` first on PATH, then removes this scope's changes. A test that times out leaves its `fn` running, so
 * scopes overlap and end in any order. Restoring a snapshot taken at the start would put a stale fake git back for every
 * later file, so a variable goes back to the newest scope still active that sets it, or else to its original value.
 */
export async function withPath<T>(dir: string, fn: () => Promise<T>, env: Record<string, string> = {}): Promise<T> {
  const scope: Scope = { dir, env };
  for (const k of Object.keys(env)) if (!original.has(k)) original.set(k, process.env[k]);
  activeScopes.push(scope);
  process.env.PATH = `${dir}:${process.env.PATH}`;
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    const index = activeScopes.indexOf(scope);
    // resetWithPath dropped this scope when its test timed out: the next test owns the environment now, so there is nothing to give back.
    if (index !== -1) {
      activeScopes.splice(index, 1);
      // One occurrence only: a nested scope with the same directory leaves the outer scope's entry in place.
      const entries = (process.env.PATH ?? "").split(":");
      const at = entries.indexOf(dir);
      if (at !== -1) entries.splice(at, 1);
      process.env.PATH = entries.join(":");
      for (const k of Object.keys(env)) {
        const owner = activeScopes.findLast((s) => k in s.env);
        const value = owner ? owner.env[k] : original.get(k);
        if (!owner) original.delete(k);
        if (value === undefined) delete process.env[k];
        else process.env[k] = value;
      }
    }
  }
}

/**
 * Forgets every active scope. The guard calls it before each test: a scope still running from a test that timed out would
 * otherwise re-apply its variables when a later scope ends, and its own `finally` would take things back from the next test.
 */
export function resetWithPath(): void {
  activeScopes = [];
  original = new Map();
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

/**
 * The part of a fake docker that answers keyloom's "does the container see the files as written" check
 * (`--entrypoint sha256sum`). It needs `$vol`, the host folder behind the mount, and `root`, where the
 * container sees it. FAKE_STALE_CALLS=N makes the first N checks report a wrong hash for every file, as a
 * stale sshfs view does; FAKE_STALE_CALLS=forever never settles. Calls are counted in "$FAKE_DOCKER_LOG.sha".
 */
export const fakeSha256Probe = (root: string): string => `
case " $* " in *" --entrypoint sha256sum "*)
  n=1000000; if [ -n "$FAKE_DOCKER_LOG" ]; then n=$(cat "$FAKE_DOCKER_LOG.sha" 2>/dev/null || echo 0); echo $((n+1)) > "$FAKE_DOCKER_LOG.sha"; fi
  stale="\${FAKE_STALE_CALLS:-0}"; [ "$stale" = forever ] && stale=1000000
  rc=0
  for a in "$@"; do case "$a" in ${root}/*)
    if [ ! -f "$vol/\${a#${root}/}" ]; then echo "sha256sum: $a: No such file or directory" >&2; rc=1; continue; fi
    if [ "$n" -lt "$stale" ]; then hash=0000000000000000000000000000000000000000000000000000000000000000
    else hash=$(shasum -a 256 "$vol/\${a#${root}/}" | cut -d' ' -f1); fi
    printf '%s  %s\\n' "$hash" "$a";;
  esac; done
  exit $rc;;
esac`;

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
${fakeSha256Probe("/qmk_firmware")}
case " $* " in *" test -f Makefile "*) [ -f "$vol/Makefile" ] && exit 0 || exit 1;; esac
for a in "$@"; do target="$a"; done
id="$(echo "\${target%%:*}" | tr / _)_keyloom"
case "$id" in *reva*) bin="$FAKE_BIN_REVA";; *) bin="$FAKE_BIN_REVB";; esac
case "$FAKE_MODE" in
  ok) mkdir -p "$vol/.build"; cp "$bin" "$vol/.build/$id.bin"; [ -n "$FAKE_ELF" ] && cp "$FAKE_ELF" "$vol/.build/$id.elf"; echo "Compiling: quantum/keymap.c  [OK]"; exit 0;;
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
