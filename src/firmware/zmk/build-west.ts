// Generated keymap -> one UF2 per half, with `west build` in ZMK's own Docker image, from upstream
// ZMK (or any fork) pinned in board.json (06#build-runs-the-moergo-template-in-docker has the MoErgo
// route). The work folder holds a user config (`config/west.yml`, the keymap and conf) and the
// firmware tree west fetches beside it; it persists, so only the first build downloads Zephyr.
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { zipSync } from "fflate";
import type { ZmkWestDockerBuild } from "../../boards/recipes.ts";
import { BuildFailure } from "../toolchain/build-failure.ts";
import { withLock } from "../toolchain/lock.ts";
import { awaitMountedFiles } from "../toolchain/mounted-files.ts";
import { writeFresh } from "../toolchain/write-fresh.ts";
import { run } from "../toolchain/run.ts";
import { describeUf2, inspectUf2, uf2Problem } from "../toolchain/uf2.ts";
import { zmkRevision } from "./board-config.ts";
import { BUILD_TIMEOUT_MS, type ZmkBuildInput, type ZmkBuildResult, hint } from "./build.ts";
import { moduleReport } from "./handsfree.ts";
import { MODULE_DIR, MODULE_FILES, OVERLAY_FILE, writeModule } from "./module.ts";
import { describeLocation, locateCompileError, locateConfError } from "./locate-error.ts";

/** The user config's manifest: ZMK at the pinned SHA, with its own `app/west.yml` for Zephyr and the modules. */
export function westManifest(repo: string, sha: string, boardModule?: ZmkWestDockerBuild["boardModule"], rgbMatrix?: ZmkWestDockerBuild["rgbMatrix"]): string {
  return `manifest:\n  projects:\n    - name: zmk\n      url: ${repo}\n      revision: ${sha}\n      import: app/west.yml${boardModule ? `\n    - name: board-module\n      url: ${boardModule.repo}\n      revision: ${boardModule.sha}` : ""}${rgbMatrix ? `\n    - name: zmk-rgb-matrix\n      url: ${rgbMatrix.module.repo}\n      revision: ${rgbMatrix.module.sha}` : ""}\n  self:\n    path: config\n`;
}

/** What a build with keyloom's module adds to `west build`: the module, and the overlay that gives it a serial port (a module can't add an overlay itself). */
export const moduleFlags = (): string => `-DZMK_EXTRA_MODULES=/work/${MODULE_DIR} -DEXTRA_DTC_OVERLAY_FILE=/work/${MODULE_DIR}/${OVERLAY_FILE}`;

/** The conf fragment that gives one half its own USB product name, written beside the keymap's conf. */
export const targetConfFile = (id: string): string => `keyloom-${id}.conf`;

/** One shell script for the whole build, so the container starts once. `set -e` stops at the first failing target. */
export function westScript(build: ZmkWestDockerBuild, withModule = false): string {
  const lines = [
    "set -e",
    "export CMAKE_BUILD_PARALLEL_LEVEL=5",
    "rm -rf build",
    "[ -d .west ] || west init -l config",
    "west update --fetch-opt=--filter=tree:0",
    "west zephyr-export",
    ...build.targets.map((t) => `west build -p always -s zmk/app -d build/${t.id} -b ${t.board ?? build.board} --${t.shield ? ` -DSHIELD=${t.shield}` : ""} -DZMK_CONFIG=/work/config${t.productName === undefined ? "" : ` -DEXTRA_CONF_FILE=/work/config/${targetConfFile(t.id)}`}${build.rgbMatrix ? ` -DDTS_EXTRA_CPPFLAGS=-DKEYLOOM_RGB_LEFT=${t.id === build.rgbMatrix.leftTarget ? 1 : 0}` : ""}${withModule ? ` ${moduleFlags()}` : ""}`),
  ];
  return lines.join("\n");
}

export async function buildZmkWest(input: ZmkBuildInput): Promise<ZmkBuildResult> {
  const started = Date.now();
  const rev = zmkRevision(input.board);
  if (rev.build.kind !== "zmk-west-docker") throw new BuildFailure(`${input.board.id} builds with ${rev.build.kind}, not zmk-west-docker`);
  const build = rev.build;
  const say = (line: string) => {
    input.log.line(line);
    input.onLine?.(line);
  };

  return withLock(
    `${input.checkoutDir}.lock`,
    async () => {
      const config = join(input.checkoutDir, "config");
      await mkdir(config, { recursive: true });
      // A keymap or conf left from another layout must not be built.
      for (const f of await readdir(config)) if (/\.(keymap|conf)$/.test(f)) await rm(join(config, f));
      await writeFresh(join(config, "west.yml"), westManifest(rev.source.repo, rev.source.sha, build.boardModule, build.rgbMatrix));
      for (const f of input.source.files) await writeFresh(join(config, f.path), f.content);
      // A half that names itself gets its own conf: the keymap's conf is shared by both builds.
      const named = build.targets.filter((t) => t.productName !== undefined);
      for (const t of named) await writeFresh(join(config, targetConfFile(t.id)), `# Written by keyloom: this half's USB product name.\nCONFIG_USB_DEVICE_PRODUCT="${t.productName}"\n`);
      const handsFree = rev.flash.handsFree !== undefined;
      if (handsFree) await writeModule(input.checkoutDir);

      const uid = process.getuid?.() ?? 1000;
      const gid = process.getgid?.() ?? 1000;
      // git refuses a folder it thinks belongs to someone else, which is what a mounted volume looks like inside the container.
      const base = [
        "docker", "run", "--rm", "--user", `${uid}:${gid}`, "-w", "/work", "-v", `${input.checkoutDir}:/work`, "-e", "HOME=/tmp",
        "-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory", "-e", "GIT_CONFIG_VALUE_0=*",
      ];
      // Docker mounts an empty folder for a path it isn't allowed to share; this fails early with a message that points the right way.
      const visible = await run({ cmd: [...base, build.image, "test", "-f", "config/west.yml"], log: input.log, timeoutMs: 5 * 60_000 });
      if (visible.exitCode !== 0) {
        throw new BuildFailure(`Docker can't see ${input.checkoutDir}. Share that folder with Docker, or set XDG_CACHE_HOME to a folder it can see (Colima shares only your home directory).`);
      }

      await awaitMountedFiles({
        image: build.image,
        mountArgs: base.slice(3),
        hostRoot: input.checkoutDir,
        containerRoot: "/work",
        files: [
          join(config, "west.yml"),
          ...input.source.files.map((f) => join(config, f.path)),
          ...named.map((t) => join(config, targetConfFile(t.id))),
          ...(handsFree ? Object.keys(MODULE_FILES).map((f) => join(input.checkoutDir, MODULE_DIR, f)) : []),
        ],
        log: input.log,
        ...(input.signal ? { signal: input.signal } : {}),
      });

      const output: string[] = [];
      say(`keyloom: building ${build.targets.map((t) => (t.shield ?? t.board ?? build.board)).join(" and ")} for ${build.board} from ${rev.source.repo} ${rev.source.ref} (${rev.source.sha.slice(0, 9)}); the first build downloads Zephyr and takes a while`);
      const result = await run({
        cmd: [...base.slice(0, 3), "--name", input.containerName, ...base.slice(3), build.image, "sh", "-c", westScript(build, handsFree)],
        log: input.log,
        timeoutMs: input.timeoutMs ?? BUILD_TIMEOUT_MS,
        ...(input.signal ? { signal: input.signal } : {}),
        onLine: (line) => {
          output.push(line);
          input.onLine?.(line);
        },
        // SIGTERM to the docker client doesn't reliably stop the container; remove it by name.
        onKill: async () => {
          await run({ cmd: ["docker", "rm", "-f", input.containerName] }).catch(() => undefined);
        },
      });

      if (result.timedOut) throw new BuildFailure(`The build took longer than ${Math.round((input.timeoutMs ?? BUILD_TIMEOUT_MS) / 60_000)} minutes and was stopped.`);
      if (result.aborted) throw new BuildFailure("The build was cancelled.");
      if (result.exitCode !== 0) {
        const keymapFile = input.source.files.find((f) => f.path.endsWith(".keymap"));
        const at = locateCompileError(output);
        const conf = locateConfError(output, input.source.files.find((f) => f.path.endsWith(".conf"))?.content ?? "");
        const detail =
          hint(output) ??
          conf ??
          (at && keymapFile
            ? `The generated keymap doesn't compile: ${at.message || "error"} at ${describeLocation(keymapFile.content, at, keymapFile.path)}.`
            : `The firmware build failed (exit ${result.exitCode ?? result.signalCode}): ${output.filter((l) => l.trim()).slice(-3).join(" | ")}`);
        throw new BuildFailure(detail);
      }

      const bundle: Record<string, Uint8Array> = {};
      for (const t of build.targets) {
        const file = Bun.file(join(input.checkoutDir, "build", t.id, "zephyr", "zmk.uf2"));
        if (!(await file.exists())) throw new BuildFailure(`The build finished but ${t.shield ?? t.board ?? build.board} produced no zmk.uf2.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const problem = uf2Problem(bytes, "single");
        if (problem) throw new BuildFailure(`The build produced a file for ${t.shield ?? t.board ?? build.board} that can't be flashed: ${problem}.`);
        bundle[`${t.id}.uf2`] = bytes;
        const info = inspectUf2(bytes);
        if (!("problem" in info)) say(`keyloom: ${t.shield ?? t.board ?? build.board}: ${bytes.length} bytes, ${describeUf2(info)}`);
      }

      const zip = zipSync(bundle);
      const carried = moduleReport(input.source.files, zip);
      if (carried) say(carried);
      await mkdir(dirname(input.artifactPath), { recursive: true });
      await Bun.write(input.artifactPath, zip);
      say(`keyloom: wrote ${input.artifactPath} (${build.targets.map((t) => `${t.id}.uf2`).join(", ")})`);
      return { artifactPath: input.artifactPath, bytes: zip.length, durationMs: Date.now() - started };
    },
    { timeoutMs: BUILD_TIMEOUT_MS, onWait: (pid) => say(`keyloom: waiting for another build to finish${pid ? ` (pid ${pid})` : ""}`) },
  );
}
