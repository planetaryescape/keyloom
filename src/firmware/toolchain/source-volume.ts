import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BuildFailure, DISK_FULL_MESSAGE, diskFull } from "./build-failure.ts";
import { capture, type LogSink, run } from "./run.ts";

type Hooks = { log?: LogSink; onLine?: (line: string) => void; signal?: AbortSignal };
export type SourceTree = { dir: string; path: string };
const CACHE_VERSION = "v3";
const LABEL = "dev.keyloom.source-key";

async function checked(cmd: string[], hooks: Hooks, what: string, container?: string): Promise<void> {
  const lines: string[] = [];
  const result = await run({
    cmd, timeoutMs: 20 * 60_000, processGroup: true,
    // BSD tar otherwise synthesizes AppleDouble files that Zephyr reads as source.
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    ...(hooks.log ? { log: hooks.log } : {}), ...(hooks.signal ? { signal: hooks.signal } : {}),
    ...(container ? { onKill: async () => { await capture(["docker", "rm", "-f", container], { timeoutMs: 30_000 }); } } : {}),
    onLine: (line) => { lines.push(line); if (lines.length > 10) lines.shift(); hooks.onLine?.(line); },
  });
  if (result.aborted) throw new BuildFailure("The build was cancelled.");
  if (diskFull(lines)) throw new BuildFailure(DISK_FULL_MESSAGE, "disk_full");
  if (result.exitCode !== 0 || result.timedOut) throw new BuildFailure(`${what} failed (${result.timedOut ? "timed out" : `exit ${result.exitCode}`}): ${lines.slice(-3).join(" | ")}`);
}

async function archive(dir: string, hooks: Hooks): Promise<string> {
  const path = `${dir}.source-${CACHE_VERSION}.tar`;
  if (existsSync(path)) return path;
  const partial = `${path}.partial-${crypto.randomUUID()}`;
  try {
    // tar preserves symlinks instead of following them outside the trusted snapshot.
    await checked(["tar", "-cf", partial, "--no-xattrs", "--no-acls", "-C", dir, "."], hooks, "Archiving pinned firmware source");
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
  return path;
}

/**
 * Only this copy step can write the volume. It runs no firmware or generated code.
 * User builds mount the published volume read-only. Their output never enters this cache.
 * The caller holds the workspace lock through preparation and the build.
 */
export async function ensureSourceVolume(workspace: string, identity: string, image: string, sources: readonly SourceTree[], hooks: Hooks, manifest?: string): Promise<string> {
  for (const { path } of sources) {
    if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(path) || path.split("/").some((p) => p === "." || p === "..")) {
      throw new BuildFailure(`Invalid firmware source path: ${path}`);
    }
  }
  const prefix = `keyloom-source-${CACHE_VERSION}-${identity.slice(0, 16)}-`;
  const record = join(`${workspace}.source-volumes-${CACHE_VERSION}`, `${identity}.json`);
  if (existsSync(record)) {
    const cached: unknown = await Bun.file(record).json();
    if (!cached || typeof cached !== "object" || !("volume" in cached) || typeof cached.volume !== "string" || !cached.volume.startsWith(prefix) || !/^[a-z0-9-]+$/.test(cached.volume)) {
      throw new BuildFailure(`Invalid firmware source cache record: ${record}`);
    }
    const found = await capture(["docker", "volume", "inspect", "--format", `{{index .Labels "${LABEL}"}}`, cached.volume], { timeoutMs: 30_000, ...(hooks.signal ? { signal: hooks.signal } : {}) });
    if (found.aborted) throw new BuildFailure("The build was cancelled.");
    if (found.exitCode === 0 && !found.timedOut) {
      if (found.stdout.trim() !== identity) throw new BuildFailure("The Docker firmware source cache has a different identity.");
      return cached.volume;
    }
    if (found.timedOut || !/no such volume/i.test(found.stderr)) throw new BuildFailure(`Docker could not inspect its firmware source cache: ${found.stderr || "timed out"}`);
  }
  const say = "keyloom: staging pinned firmware sources in Docker; later builds reuse this read-only copy";
  hooks.log?.line(say); hooks.onLine?.(say);
  const archives: string[] = [];
  for (let i = 0; i < sources.length; i += 5) {
    const batch = await Promise.allSettled(sources.slice(i, i + 5).map((source) => archive(source.dir, hooks)));
    // All writers settle before a failure can release the caller's lock.
    for (const result of batch) {
      if (result.status === "rejected") throw result.reason;
      archives.push(result.value);
    }
  }
  if (hooks.signal?.aborted) throw new BuildFailure("The build was cancelled.");
  const volume = `${prefix}${crypto.randomUUID()}`;
  const container = `keyloom-source-copy-${crypto.randomUUID()}`;
  let published = false;
  const temporary = `${record}.partial-${crypto.randomUUID()}`;
  try {
    await checked(["docker", "volume", "create", "--label", `${LABEL}=${identity}`, volume], hooks, "Creating firmware source cache");
    // The seed container gets individual immutable archives, never their parent or user input.
    // Its default root user owns only this new Docker volume, so it can create its directories.
    await checked([
      "docker", "run", "--rm", "--name", container,
      "--mount", `type=volume,src=${volume},dst=/cache`,
      ...archives.flatMap((path, i) => ["--mount", `type=bind,src=${path},dst=/archives/${i}.tar,readonly`]),
      ...(manifest ? ["-e", `KEYLOOM_SOURCE_MANIFEST=${manifest}`] : []),
      "--entrypoint", "sh", image, "-c", 'set -e; while [ "$#" -gt 0 ]; do mkdir -p "/cache/$1"; tar -xf "/archives/$2.tar" -C "/cache/$1"; shift 2; done; if [ -n "$KEYLOOM_SOURCE_MANIFEST" ]; then mkdir -p /cache/config /cache/.west; printf \'[manifest]\\npath = config\\nfile = west.yml\\n[zephyr]\\nbase = zephyr\\n\' > /cache/.west/config; printf \'%s\\n\' "$KEYLOOM_SOURCE_MANIFEST" > /cache/config/west.yml; fi',
      "keyloom-source-copy", ...sources.flatMap((source, i) => [source.path, String(i)]),
    ], hooks, "Copying pinned firmware source", container);
    if (hooks.signal?.aborted) throw new BuildFailure("The build was cancelled.");
    await mkdir(dirname(record), { recursive: true });
    await Bun.write(temporary, JSON.stringify({ volume }));
    await rename(temporary, record);
    published = true;
    return volume;
  } finally {
    await rm(temporary, { force: true });
    if (!published) await capture(["docker", "volume", "rm", volume], { timeoutMs: 30_000 });
  }
}
