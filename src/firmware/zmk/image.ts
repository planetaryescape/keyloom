// The Docker image the Glove80 firmware builds in (06#build-runs-the-moergo-template-in-docker, S7).
// It is infra/glove80/Dockerfile: MoErgo's own, cut down to pre-build one pinned moergo-sc/zmk ref
// instead of four, because MoErgo's ran out of space on a 157 GB Docker disk. The Dockerfile is
// embedded in the binary and written out to build from, so a released keyloom needs no checkout of
// this repository.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import DOCKERFILE from "../../../infra/glove80/Dockerfile" with { type: "text" };
import { DISK_FULL_MESSAGE, diskFull } from "../toolchain/build-failure.ts";
import { type LogSink, capture, run } from "../toolchain/run.ts";

export const IMAGE_REPO = "keyloom-glove80";
export const IMAGE_BUILD_TIMEOUT_MS = 40 * 60_000;

/** The tag names the firmware ref and the Dockerfile, so changing either builds a new image instead of reusing an old one. */
export function imageTag(zmkSha: string): string {
  const hash = new Bun.CryptoHasher("sha256").update(DOCKERFILE).digest("hex").slice(0, 10);
  return `${IMAGE_REPO}:${zmkSha.slice(0, 12)}-${hash}`;
}

export type ImageHooks = { log: LogSink; onLine?: (line: string) => void; signal?: AbortSignal; timeoutMs?: number };

/** Builds the image if it isn't local. The first build takes a few minutes and about 5 GB; later ones are instant. */
export async function ensureImage(zmkSha: string, contextDir: string, hooks: ImageHooks): Promise<{ tag: string; built: boolean }> {
  const tag = imageTag(zmkSha);
  const present = await capture(["docker", "image", "inspect", tag], { timeoutMs: 30_000 });
  if (present.exitCode === 0) return { tag, built: false };

  const say = (line: string) => {
    hooks.log.line(line);
    hooks.onLine?.(line);
  };
  say(`keyloom: building the Glove80 firmware image ${tag}; the first time takes a few minutes`);
  await mkdir(contextDir, { recursive: true });
  await Bun.write(join(contextDir, "Dockerfile"), DOCKERFILE);
  // Kept so a full disk gets its code: this is the one step that writes BuildKit's cache, which the page's prune frees (R8-04).
  const output: string[] = [];
  const r = await run({
    cmd: ["docker", "build", "-t", tag, "--build-arg", `ZMK_REF=${zmkSha}`, contextDir],
    log: hooks.log,
    timeoutMs: hooks.timeoutMs ?? IMAGE_BUILD_TIMEOUT_MS,
    onLine: (line) => {
      output.push(line);
      hooks.onLine?.(line);
    },
    ...(hooks.signal ? { signal: hooks.signal } : {}),
  });
  if (r.exitCode !== 0) {
    if (!r.timedOut && !r.aborted && diskFull(output)) throw new ImageBuildError(DISK_FULL_MESSAGE, "disk_full");
    throw new ImageBuildError(r.timedOut ? "Building the firmware image timed out." : r.aborted ? "The build was cancelled." : `Building the firmware image failed (exit ${r.exitCode ?? r.signalCode}); the log has the output.`);
  }
  return { tag, built: true };
}

export class ImageBuildError extends Error {
  override name = "ImageBuildError";
  constructor(message: string, readonly code: "disk_full" | null = null) {
    super(message);
  }
}
