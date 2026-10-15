// Generated keymap -> one combined glove80.uf2, in a Docker image of MoErgo's fork, through their
// template's Nix build (06#build-runs-the-moergo-template-in-docker).
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BoardDefinition } from "../../boards/schema.ts";
import { BuildFailure } from "../toolchain/build-failure.ts";
import { type CheckoutSpec, ensureCheckout } from "../toolchain/checkout.ts";
import { withLock } from "../toolchain/lock.ts";
import { type LogSink, run } from "../toolchain/run.ts";
import { zmkRevision } from "./board-config.ts";
import type { GeneratedSource } from "./generate.ts";
import { ImageBuildError, ensureImage } from "./image.ts";
import { GLOVE80_NIX, halfConfFile, moduleReport } from "./handsfree.ts";
import { describeLocation, locateCompileError, locateConfError } from "./locate-error.ts";
import { writeModule } from "./module.ts";
import { CONF_FILE, KEYMAP_FILE } from "./files.ts";
import { describeUf2, inspectUf2, uf2Problem } from "../toolchain/uf2.ts";

export { BuildFailure } from "../toolchain/build-failure.ts";

export const BUILD_TIMEOUT_MS = 30 * 60_000;

export type ZmkBuildInput = {
  board: BoardDefinition;
  source: GeneratedSource;
  /** The template checkout; it must be under a folder Docker can mount (the home directory on Colima). */
  checkoutDir: string;
  /** Where the Dockerfile is written to build the image from. */
  imageContextDir: string;
  /** Where the finished .uf2 is copied. */
  artifactPath: string;
  log: LogSink;
  /** Docker container name, so a timeout can remove the container as well as the docker client. */
  containerName: string;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ZmkBuildResult = { artifactPath: string; bytes: number; durationMs: number };

export function hint(lines: readonly string[]): string | undefined {
  const text = lines.join("\n");
  if (/No space left on device/i.test(text)) return "Docker ran out of disk space. Free some with `docker builder prune` or raise the disk limit, then build again.";
  if (/Cannot connect to the Docker daemon/i.test(text)) return "Docker isn't running. Start it and build again.";
  return undefined;
}

export async function buildZmk(input: ZmkBuildInput): Promise<ZmkBuildResult> {
  const started = Date.now();
  const rev = zmkRevision(input.board);
  if (rev.build.kind !== "zmk-moergo-template") throw new BuildFailure(`${input.board.id} builds with ${rev.build.kind}, not MoErgo's template`);
  const template = rev.build.template;
  const say = (line: string) => {
    input.log.line(line);
    input.onLine?.(line);
  };
  const spec: CheckoutSpec = { dir: input.checkoutDir, repo: template.repo, sha: template.sha, submodules: [] };
  const hooks = { log: input.log, ...(input.onLine ? { onLine: input.onLine } : {}), ...(input.signal ? { signal: input.signal } : {}) };

  return withLock(
    `${input.checkoutDir}.lock`,
    async () => {
      await ensureCheckout(spec, hooks);
      let image: string;
      try {
        image = (await ensureImage(rev.source.sha, input.imageContextDir, hooks)).tag;
      } catch (err) {
        if (err instanceof ImageBuildError) throw new BuildFailure(err.message);
        throw err;
      }

      // The template's build reads config/glove80.keymap and config/glove80.conf (default.nix).
      for (const f of input.source.files) await Bun.write(join(input.checkoutDir, "config", f.path), f.content);
      const uid = process.getuid?.() ?? 1000;
      const gid = process.getgid?.() ?? 1000;
      const mount = ["-v", `${input.checkoutDir}:/config`];
      // Stale output is removed inside the container: deleting it from the host left Colima's sshfs mount with
      // a cached view of the old directory (seen with QMK builds, 903da6b). The same command is the probe that
      // the container can see the checkout at all; Docker mounts an empty directory for a path it isn't
      // allowed to share, and the build then fails with a message that points the wrong way.
      const visible = await run({
        cmd: ["docker", "run", "--rm", ...mount, "--entrypoint", "sh", image, "-c", "test -f config/default.nix && rm -f glove80.uf2"],
        log: input.log,
        timeoutMs: 5 * 60_000,
      });
      if (visible.exitCode !== 0) {
        throw new BuildFailure(`Docker can't see ${input.checkoutDir}. Share that folder with Docker, or set XDG_CACHE_HOME to a folder it can see (Colima shares only your home directory).`);
      }

      const handsFree = rev.flash.handsFree;
      // After the probe, which is about the template's own default.nix: this replaces it.
      if (handsFree) {
        await writeModule(input.checkoutDir);
        // The Nix expression reads one serial-number conf per half. A source made without a build ID has none, and a file left from
        // an earlier build must not be used in its place.
        for (const half of handsFree.halves) {
          const path = halfConfFile(half.marker);
          if (!input.source.files.some((f) => f.path === path)) await Bun.write(join(input.checkoutDir, "config", path), "# keyloom: no build marker\n");
        }
        await Bun.write(join(input.checkoutDir, "config", "default.nix"), GLOVE80_NIX);
      }

      const output: string[] = [];
      say(`keyloom: building glove80.uf2 from moergo-sc/zmk ${rev.source.ref} (${rev.source.sha.slice(0, 9)}) in ${image}`);
      const result = await run({
        cmd: ["docker", "run", "--rm", "--name", input.containerName, ...mount, "-e", `UID=${uid}`, "-e", `GID=${gid}`, image],
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
        const at = locateCompileError(output);
        const keymap = input.source.files.find((f) => f.path === KEYMAP_FILE)?.content ?? "";
        const conf = locateConfError(output, input.source.files.find((f) => f.path === CONF_FILE)?.content ?? "");
        const detail =
          hint(output) ??
          conf ??
          (at
            ? `The generated keymap doesn't compile: ${at.message || "error"} at ${describeLocation(keymap, at)}.`
            : `The firmware build failed (exit ${result.exitCode ?? result.signalCode}): ${output.filter((l) => l.trim()).slice(-3).join(" | ")}`);
        throw new BuildFailure(detail);
      }

      const file = Bun.file(join(input.checkoutDir, "glove80.uf2"));
      if (!(await file.exists())) throw new BuildFailure("The build finished but glove80.uf2 was not produced.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const problem = uf2Problem(bytes);
      if (problem) throw new BuildFailure(`The build produced a file that can't be flashed: ${problem}.`);

      const carried = moduleReport(input.source.files, bytes);
      if (carried) say(carried);
      await mkdir(dirname(input.artifactPath), { recursive: true });
      await copyFile(file.name as string, input.artifactPath);
      const info = inspectUf2(bytes);
      say(`keyloom: wrote ${input.artifactPath} (${bytes.length} bytes${"problem" in info ? "" : `, ${describeUf2(info)}`})`);
      return { artifactPath: input.artifactPath, bytes: bytes.length, durationMs: Date.now() - started };
    },
    { timeoutMs: BUILD_TIMEOUT_MS, onWait: (pid) => say(`keyloom: waiting for another build to finish${pid ? ` (pid ${pid})` : ""}`) },
  );
}
