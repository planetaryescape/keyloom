// Docker checks: is the daemon up, and how much room does its VM have (S7: a full Docker Desktop
// disk fails a build late, with "No space left on device").
import { capture } from "./run.ts";

export type DockerStatus = { ok: true; version: string } | { ok: false; reason: string };

export async function dockerStatus(timeoutMs = 15_000): Promise<DockerStatus> {
  if (!Bun.which("docker")) return { ok: false, reason: "docker is not on PATH; install Docker Desktop or OrbStack" };
  const r = await capture(["docker", "version", "--format", "{{.Server.Version}}"], { timeoutMs });
  if (r.timedOut) return { ok: false, reason: "docker did not answer within 15 s; is Docker Desktop starting?" };
  if (r.exitCode !== 0) return { ok: false, reason: "the docker daemon isn't running; start Docker Desktop" };
  return { ok: true, version: r.stdout.trim() };
}

export const LOW_DISK_BYTES = 15 * 1024 ** 3;

export type DockerDisk = { freeBytes: number } | { unknown: string };

/** Free bytes on the Docker VM's disk, measured with an image that is already local (`--pull=never`, so a check never downloads). */
export async function dockerFreeSpace(images: readonly string[], timeoutMs = 30_000): Promise<DockerDisk> {
  for (const image of images) {
    const r = await capture(["docker", "run", "--rm", "--pull=never", "--entrypoint", "df", image, "-Pk", "/"], { timeoutMs });
    if (r.exitCode !== 0) continue;
    const free = parseDfFreeBytes(r.stdout);
    if (free !== undefined) return { freeBytes: free };
  }
  return { unknown: "no image is local yet to measure with; it is checked after the first build" };
}

/** `df -Pk /` output to available bytes. */
export function parseDfFreeBytes(output: string): number | undefined {
  const row = output.trim().split("\n").at(-1)?.trim().split(/\s+/);
  const availableKb = Number(row?.[3]);
  return Number.isFinite(availableKb) && row && row.length >= 6 ? availableKb * 1024 : undefined;
}
