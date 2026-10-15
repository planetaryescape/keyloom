// Generated keymap -> .bin, in QMK's Docker image, from the pinned ZSA checkout (05#build).
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BoardDefinition } from "../../boards/schema.ts";
import { type CheckoutSpec, ensureCheckout } from "../toolchain/checkout.ts";
import { withLock } from "../toolchain/lock.ts";
import { type LogSink, run } from "../toolchain/run.ts";
import { qmkRevision } from "./board-config.ts";
import { dfuProblem } from "./dfu.ts";
import type { GeneratedSource } from "./generate.ts";
import { describeLocated, locateCompileError } from "./locate-error.ts";
import { writeSource } from "./write-source.ts";

export const BUILD_TIMEOUT_MS = 20 * 60_000;

/** The build did not produce a usable binary; `message` is fit to show a person. */
export class BuildFailure extends Error {
  override name = "BuildFailure";
}

export type QmkBuildInput = {
  board: BoardDefinition;
  boardRevisionId: string;
  source: GeneratedSource;
  checkoutDir: string;
  /** Where the finished .bin is copied. */
  artifactPath: string;
  log: LogSink;
  /** Docker container name, so a timeout can remove the container as well as the docker client. */
  containerName: string;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type QmkBuildResult = { artifactPath: string; bytes: number; durationMs: number };

const idFor = (qmkTarget: string): string => qmkTarget.replaceAll("/", "_");

function hint(lines: readonly string[]): string | undefined {
  const text = lines.join("\n");
  if (/No space left on device/i.test(text)) return "Docker ran out of disk space. Free some with `docker system prune` or raise the disk limit in Docker Desktop, then build again.";
  if (/Cannot connect to the Docker daemon/i.test(text)) return "Docker isn't running. Start Docker Desktop and build again.";
  return undefined;
}

export async function buildQmk(input: QmkBuildInput): Promise<QmkBuildResult> {
  const started = Date.now();
  const rev = qmkRevision(input.board, input.boardRevisionId);
  const say = (line: string) => {
    input.log.line(line);
    input.onLine?.(line);
  };
  const spec: CheckoutSpec = { dir: input.checkoutDir, repo: rev.source.repo, sha: rev.source.sha, submodules: rev.build.submodules };
  const output: string[] = [];

  return withLock(
    `${input.checkoutDir}.lock`,
    async () => {
      await ensureCheckout(spec, { log: input.log, ...(input.onLine ? { onLine: input.onLine } : {}), ...(input.signal ? { signal: input.signal } : {}) });

      const keymapDir = join(input.checkoutDir, rev.build.keymapsDir, input.source.keymapName);
      await writeSource(keymapDir, input.source, { clean: true });
      const id = `${idFor(rev.qmkTarget)}_${input.source.keymapName}`;
      // A stale .bin from an earlier layout must not be able to pass for this build. Stale objects are
      // removed inside the container below instead: deleting them from the host left Colima's sshfs
      // mount with a cached view of the old directory, so QMK's mkdir -p skipped `src/` and the next
      // build failed writing into it (seen 2026-10-15, second reva build in a row).
      for (const ext of ["bin", "elf", "hex"]) await rm(join(input.checkoutDir, ".build", `${id}.${ext}`), { force: true });
      await rm(join(input.checkoutDir, `${id}.bin`), { force: true });

      const uid = process.getuid?.() ?? 1000;
      const gid = process.getgid?.() ?? 1000;
      const base = [
        "docker", "run", "--rm", "--user", `${uid}:${gid}`, "-w", "/qmk_firmware", "-v", `${input.checkoutDir}:/qmk_firmware`,
      ];
      // Docker Desktop mounts an empty directory for a path it isn't allowed to share, and make then says only
      // "No rule to make target", which sends people hunting in the wrong place.
      const visible = await run({
        cmd: [...base, rev.build.image, "sh", "-c", `test -f Makefile && rm -rf .build/obj_${id}`],
        log: input.log,
        timeoutMs: 5 * 60_000,
      });
      if (visible.exitCode !== 0) {
        throw new BuildFailure(
          `Docker can't see ${input.checkoutDir}. Allow that folder under Docker Desktop's Settings > Resources > File sharing, or set XDG_CACHE_HOME to a folder it can see.`,
        );
      }
      const cmd = [
        ...base.slice(0, 3), "--name", input.containerName, ...base.slice(3), "-e", "SKIP_GIT=1", "-e", "MAKEFLAGS=-j4",
        rev.build.image, "make", `${rev.qmkTarget}:${input.source.keymapName}`,
      ];
      say(`keyloom: building ${rev.qmkTarget}:${input.source.keymapName} in ${rev.build.image.split("@")[0]}`);
      const result = await run({
        cmd,
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
        const located = locateCompileError(output, input.source.files.find((f) => f.path === "keymap.c")?.content ?? "", input.board);
        const detail =
          hint(output) ??
          (located ? `The generated firmware doesn't compile: ${describeLocated(located)}` : `QMK's build failed (exit ${result.exitCode ?? result.signalCode}): ${output.filter((l) => l.trim()).slice(-3).join(" | ")}`);
        throw new BuildFailure(detail);
      }

      const built = [join(input.checkoutDir, ".build", `${id}.bin`), join(input.checkoutDir, `${id}.bin`)].map((p) => Bun.file(p));
      const file = (await Promise.all(built.map(async (f) => ((await f.exists()) ? f : undefined)))).find((f) => f !== undefined);
      if (!file) throw new BuildFailure(`The build finished but ${id}.bin was not produced.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const problem = dfuProblem(bytes, rev.flash.bootloader);
      if (problem) throw new BuildFailure(`The build produced a file that can't be flashed: ${problem}.`);

      await mkdir(dirname(input.artifactPath), { recursive: true });
      await copyFile(file.name as string, input.artifactPath);
      say(`keyloom: wrote ${input.artifactPath} (${bytes.length} bytes, DFU ${rev.flash.bootloader})`);
      return { artifactPath: input.artifactPath, bytes: bytes.length, durationMs: Date.now() - started };
    },
    { timeoutMs: BUILD_TIMEOUT_MS, onWait: (pid) => say(`keyloom: waiting for another build to finish${pid ? ` (pid ${pid})` : ""}`) },
  );
}
