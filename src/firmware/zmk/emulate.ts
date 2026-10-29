// Runs a generated keymap on this machine: ZMK built for Zephyr's native_posix_64 board with a mock kscan that
// replays the key events, in the same Docker images the real builds use (06#emulate-runs-zmk-itself-on-the-host-with-a-mock-keyboard). Upstream boards (Corne)
// build in ZMK's own image against the west workspace the real build keeps; the Glove80 builds in the
// MoErgo image, whose Nix store already holds Zephyr and the modules and also has a host gcc.
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { EmulationError } from "../emulate/error.ts";
import { typedText } from "../emulate/text.ts";
import type { Emulator, EmulatorInput } from "../emulate/emulator.ts";
import type { EmulationResult } from "../emulate/types.ts";
import { BuildFailure } from "../toolchain/build-failure.ts";
import { withLock } from "../toolchain/lock.ts";
import { run } from "../toolchain/run.ts";
import { zmkRevision } from "./board-config.ts";
import { hint } from "./build.ts";
import { westManifest } from "./build-west.ts";
import { readZmkLighting } from "./import-lighting.ts";
import { nativeFiles } from "./emulate-keymap.ts";
import { parseRunLog } from "./emulate-log.ts";
import { ImageBuildError, ensureImage, imageTag } from "./image.ts";

export const EMULATE_TIMEOUT_MS = 30 * 60_000;

/** Printed between the build and the run, so the run's log can be read apart from the build's. */
export const RUN_MARKER = "KEYLOOM-EMULATE-RUN";

/**
 * The keymap and conf reach the container on standard input, as one base64 line each, and are written inside
 * it. Writing them to the mounted folder from the host instead let Colima's file sharing show the container
 * an older, shorter copy of a rewritten file (seen: a keymap cut off mid-way), so nothing the host rewrites is read.
 */
const CONFIG_DIR = "/tmp/emu-config";
// Built inside the container too. A build folder on the shared mount kept timestamps from the host's clock, which
// made ninja think the previous run's binary was current (seen: a run replaying the last run's keys). The
// build is mostly a full rebuild anyway, because a new keymap changes the devicetree everything includes.
const BUILD_DIR = "/tmp/emu-build";
const READ_CONFIG = [
  `mkdir -p ${CONFIG_DIR}`,
  "read -r KEYLOOM_KEYMAP; read -r KEYLOOM_CONF",
  `printf '%s' "$KEYLOOM_KEYMAP" | base64 -d > ${CONFIG_DIR}/native_posix_64.keymap`,
  `printf '%s' "$KEYLOOM_CONF" | base64 -d > ${CONFIG_DIR}/native_posix_64.conf`,
];

const toStdin = (files: { keymap: string; conf: string }): string =>
  `${Buffer.from(files.keymap).toString("base64")}\n${Buffer.from(files.conf).toString("base64")}\n`;

/** The shell run inside ZMK's own image: the real build's workspace, a build of its own beside it, then the binary. */
export function westEmulateScript(sha: string): string {
  return [
    "set -e",
    ...READ_CONFIG,
    "[ -d .west ] || west init -l config",
    // The workspace is the one the real build keeps; only a missing or moved firmware tree needs west's download.
    `[ "$(git -C zmk rev-parse HEAD 2>/dev/null)" = ${sha} ] || west update --fetch-opt=--filter=tree:0`,
    "west zephyr-export > /dev/null",
    `west build -s zmk/app -d ${BUILD_DIR} -b native_posix_64 -- -DCONFIG_ASSERT=y -DZMK_CONFIG=${CONFIG_DIR}`,
    `echo ${RUN_MARKER}`,
    `${BUILD_DIR}/zephyr/zmk.exe -no-rt`,
    "",
  ].join("\n");
}

/** Run inside the MoErgo image's `nix-shell -A zmk`, which supplies cmake, ninja, dtc and the Python Zephyr needs. */
export const MOERGO_INNER_SCRIPT = [
  "set -e",
  ...READ_CONFIG,
  "cd /src",
  'eval_nix() { nix-instantiate --eval --json --strict -E "let p = import ./default.nix {}; in $1" | sed \'s/^"//;s/"$//\'; }',
  'ZEPHYR=$(eval_nix "toString p.zephyr")',
  'MODULES=$(eval_nix \'builtins.concatStringsSep ";" (map toString p.zmk.zephyrModuleDeps)\')',
  // The only host compiler in the image is the one Nix's stdenv was bootstrapped with; the derivations of it end in .drv.
  'GCC=$(ls -d /nix/store/*-gcc-wrapper-* | while read d; do case "$d" in *.drv) ;; *) echo "$d"; break;; esac; done)',
  '[ -n "$GCC" ] || { echo "keyloom: no host gcc in the image"; exit 3; }',
  'export PATH="$GCC/bin:$PATH"',
  `cmake -GNinja -S /src/app -B ${BUILD_DIR} -DBOARD=native_posix_64 -DZEPHYR_TOOLCHAIN_VARIANT=host -DZEPHYR_BASE="$ZEPHYR/zephyr" -DZEPHYR_MODULES="$MODULES" -DUSER_CACHE_DIR=/tmp/.cache -DCONFIG_ASSERT=y -DZMK_CONFIG=${CONFIG_DIR} > ${BUILD_DIR}.cmake.log 2>&1 || { cat ${BUILD_DIR}.cmake.log; exit 1; }`,
  `ninja -C ${BUILD_DIR}`,
  `echo ${RUN_MARKER}`,
  `${BUILD_DIR}/zephyr/zmk.exe -no-rt`,
  "",
].join("\n");

// The script travels in the environment so the quoting stays one level deep; nix-shell passes it and standard input on.
const MOERGO_OUTER_SCRIPT = `cd /src && nix-shell -A zmk default.nix --run 'sh -c "$KEYLOOM_EMULATE"'`;

async function writeIfChanged(path: string, content: string): Promise<void> {
  const file = Bun.file(path);
  if (!(await file.exists()) || (await file.text()) !== content) await Bun.write(path, content);
}

// The firmware is deterministic (its clock is simulated), so the same keymap, settings and events give the
// same log. Keeping the log saves the 10 to 30 seconds of building when an agent asks the same question twice.
const KEPT_RUNS = 40;

async function readCached(dir: string, key: string): Promise<string[] | undefined> {
  const file = Bun.file(join(dir, `${key}.log`));
  return (await file.exists()) ? (await file.text()).split("\n") : undefined;
}

async function keepRun(dir: string, key: string, lines: readonly string[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, `${key}.log`), lines.join("\n"));
  const names = (await readdir(dir)).filter((n) => n.endsWith(".log"));
  if (names.length <= KEPT_RUNS) return;
  const aged = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(dir, n))).mtimeMs })));
  for (const { n } of aged.sort((a, b) => a.t - b.t).slice(0, names.length - KEPT_RUNS)) await rm(join(dir, n), { force: true });
}

export const emulateZmk: Emulator = async (input) => {
  const rev = zmkRevision(input.board);
  const keymap = input.source.files.find((f) => f.path.endsWith(".keymap"))?.content;
  if (keymap === undefined) throw new EmulationError("the generated source has no keymap");
  const files = nativeFiles({
    keymap: readZmkLighting(keymap, input.board).source, conf: input.source.files.find((f) => f.path.endsWith(".conf"))?.content ?? "", keyCount: input.board.keyCount, events: input.events,
  });
  const say = (line: string) => {
    input.log.line(line);
    input.onLine?.(line);
  };
  // What the build depends on: the firmware, the image it builds in, the emulator's own scripts and the native keymap and settings (events included).
  const toolchain = rev.build.kind === "zmk-west-docker" ? rev.build.image : imageTag(rev.source.sha);
  const key = new Bun.CryptoHasher("sha256")
    .update([rev.source.sha, toolchain, westEmulateScript(rev.source.sha), MOERGO_INNER_SCRIPT, files.keymap, files.conf].join("\n--\n"))
    .digest("hex")
    .slice(0, 24);
  const runsDir = join(input.workDir, "runs");

  const useCache = input.cache !== false;
  const cached = useCache ? await readCached(runsDir, key) : undefined;
  let runLines: string[];
  if (cached) {
    say("keyloom: the same keys on the same keymap were emulated before; using that run");
    runLines = cached;
  } else {
    const output: string[] = [];
    const execute = async (cmd: string[]) => {
      let ran = false;
      const result = await run({
        cmd,
        stdin: toStdin(files),
        log: input.log,
        timeoutMs: input.timeoutMs ?? EMULATE_TIMEOUT_MS,
        ...(input.signal ? { signal: input.signal } : {}),
        onLine: (line) => {
          if (line.trim() === RUN_MARKER) ran = true;
          output.push(line);
          if (!ran) input.onLine?.(line);
        },
        // SIGTERM to the docker client doesn't reliably stop the container; remove it by name.
        onKill: async () => {
          await run({ cmd: ["docker", "rm", "-f", input.containerName] }).catch(() => undefined);
        },
      });
      if (result.timedOut) throw new EmulationError(`the emulator took longer than ${Math.round((input.timeoutMs ?? EMULATE_TIMEOUT_MS) / 60_000)} minutes and was stopped.`);
      if (result.aborted) throw new EmulationError("the emulation was cancelled.");
      if (result.exitCode !== 0) {
        const tail = output.filter((l) => l.trim()).slice(-4).join(" | ");
        throw new EmulationError(hint(output) ?? (ran ? `the emulated firmware stopped with exit ${result.exitCode ?? result.signalCode}: ${tail}` : `the emulator couldn't build this keymap: ${tail}`));
      }
    };

    if (rev.build.kind === "zmk-west-docker") {
      const build = rev.build;
      await withLock(`${input.checkoutDir}.lock`, async () => {
        const config = join(input.checkoutDir, "config");
        await mkdir(config, { recursive: true });
        await writeIfChanged(join(config, "west.yml"), westManifest(rev.source.repo, rev.source.sha));
        const uid = process.getuid?.() ?? 1000;
        const gid = process.getgid?.() ?? 1000;
        // git refuses a folder it thinks belongs to someone else, which is what a mounted volume looks like inside the container.
        const cmd = [
          "docker", "run", "-i", "--rm", "--name", input.containerName, "--user", `${uid}:${gid}`, "-w", "/work", "-v", `${input.checkoutDir}:/work`, "-e", "HOME=/tmp",
          "-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory", "-e", "GIT_CONFIG_VALUE_0=*", build.image, "sh", "-c", westEmulateScript(rev.source.sha),
        ];
        say(`keyloom: emulating ${input.board.name} on ZMK ${rev.source.ref} (${rev.source.sha.slice(0, 9)}) in ${build.image.split("@")[0]}`);
        await execute(cmd);
      }, { timeoutMs: EMULATE_TIMEOUT_MS, onWait: (pid) => say(`keyloom: waiting for another build to finish${pid ? ` (pid ${pid})` : ""}`) });
    } else {
      await withLock(`${input.workDir}.lock`, async () => {
        let image: string;
        try {
          image = (await ensureImage(rev.source.sha, input.imageContextDir, { log: input.log, ...(input.onLine ? { onLine: input.onLine } : {}), ...(input.signal ? { signal: input.signal } : {}) })).tag;
        } catch (err) {
          if (err instanceof ImageBuildError) throw new BuildFailure(err.message);
          throw err;
        }
        await mkdir(input.workDir, { recursive: true });
        const cmd = [
          "docker", "run", "-i", "--rm", "--name", input.containerName, "-e", `KEYLOOM_EMULATE=${MOERGO_INNER_SCRIPT}`, "--entrypoint", "sh", image, "-c",
          MOERGO_OUTER_SCRIPT,
        ];
        say(`keyloom: emulating ${input.board.name} on moergo-sc/zmk ${rev.source.ref} (${rev.source.sha.slice(0, 9)}) in ${image}`);
        await execute(cmd);
      }, { timeoutMs: EMULATE_TIMEOUT_MS, onWait: (pid) => say(`keyloom: waiting for another emulation to finish${pid ? ` (pid ${pid})` : ""}`) });
    }

    const at = output.indexOf(RUN_MARKER);
    if (at < 0) throw new EmulationError("the emulator built the keymap but never ran it");
    runLines = output.slice(at + 1);
  }

  const parsed = parseRunLog(runLines, { keyCount: input.board.keyCount, nkro: files.nkro });
  if (parsed.eventsSeen !== input.events.length) {
    throw new EmulationError(`the firmware saw ${parsed.eventsSeen} of the ${input.events.length} key events; the run was cut short, so the result isn't shown.`);
  }
  if (!cached && useCache) await keepRun(runsDir, key, runLines);
  return { firmware: "zmk", reports: parsed.reports, text: typedText(parsed.reports), warnings: [...files.warnings, ...parsed.warnings] };
};
