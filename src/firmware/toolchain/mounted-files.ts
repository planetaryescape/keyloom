import { relative } from "node:path";
import { BuildFailure } from "./build-failure.ts";
import { type LogSink, run } from "./run.ts";

export type MountedFilesCheck = {
  /** The image the build runs in; it is only used to run `sha256sum`, so nothing is pulled or built for the check. */
  image: string;
  /** `docker run` options that mount the folder (and set the user and working directory if the build does), exactly as the build mounts it. */
  mountArgs: readonly string[];
  /** The host folder that is mounted, and where it appears in the container. */
  hostRoot: string;
  containerRoot: string;
  /** Absolute host paths, all under `hostRoot`: the files keyloom just wrote and the build is about to read. */
  files: readonly string[];
  log: LogSink;
  signal?: AbortSignal;
  /** How long the container may keep seeing a different file before the build is refused. */
  settleMs?: number;
  retryEveryMs?: number;
};

export const MOUNT_SETTLE_MS = 30_000;
const RETRY_EVERY_MS = 500;

const hostHash = async (path: string): Promise<string> => new Bun.CryptoHasher("sha256").update(await Bun.file(path).bytes()).digest("hex");

/**
 * Waits until a container sees every file with the content the host wrote. Colima's sshfs mount can serve a
 * file at its old size for about a second after the host replaced it (docs/issues/colima-stale-default-nix.md),
 * and writing under a fresh name (write-fresh.ts) narrows that window without closing it. One `docker run` of
 * the build image hashes the files where the build will read them; a build that starts on a stale view fails
 * late and confusingly, so a view that never settles is refused here.
 */
export async function awaitMountedFiles(check: MountedFilesCheck): Promise<void> {
  const settleMs = check.settleMs ?? MOUNT_SETTLE_MS;
  const retryEveryMs = check.retryEveryMs ?? RETRY_EVERY_MS;
  const expected = new Map<string, string>();
  for (const file of check.files) expected.set(`${check.containerRoot}/${relative(check.hostRoot, file)}`, await hostHash(file));
  if (expected.size === 0) return;

  const started = Date.now();
  let differing: string[] = [];
  let detail = "";
  // Whether the last probe itself failed (Docker didn't answer or couldn't run it), so no copy was seen at all.
  let probeFailed = false;
  for (;;) {
    if (check.signal?.aborted) throw new BuildFailure("The build was cancelled.");
    const seen = new Map<string, string>();
    const errors: string[] = [];
    const result = await run({
      cmd: ["docker", "run", "--rm", ...check.mountArgs, "--entrypoint", "sha256sum", check.image, ...expected.keys()],
      timeoutMs: 5 * 60_000,
      ...(check.signal ? { signal: check.signal } : {}),
      onLine: (line, stream) => {
        const hashed = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
        if (stream === "stdout" && hashed) seen.set(hashed[2] as string, hashed[1] as string);
        else if (line.trim()) errors.push(line.trim());
      },
    });
    if (result.aborted) throw new BuildFailure("The build was cancelled.");
    // sha256sum exits 1 for a file it can't read, which is a missing copy; any other exit is Docker's (125 to 127) or a timeout.
    probeFailed = result.timedOut || (result.exitCode !== 0 && result.exitCode !== 1);
    differing = [...expected].filter(([path, hash]) => seen.get(path) !== hash).map(([path]) => path);
    detail = errors.slice(0, 3).join(" | ");
    if (differing.length === 0) {
      if (Date.now() - started > retryEveryMs) check.log.line(`keyloom: the container saw the written files after ${Date.now() - started} ms`);
      return;
    }
    check.log.line(probeFailed
      ? `keyloom: Docker couldn't check the written files (${result.timedOut ? "timed out" : `exit ${result.exitCode}`})${detail ? `: ${detail}` : ""}; checking again`
      : `keyloom: the container sees a different copy of ${differing.join(", ")}${detail ? ` (${detail})` : ""}; checking again`);
    if (Date.now() - started >= settleMs) break;
    await Bun.sleep(retryEveryMs);
  }
  // No copy was seen, so this is not a stale share, and a restart of the engine isn't the fix: no code, so Build again stays (PR #297).
  if (probeFailed) {
    throw new BuildFailure(`Docker couldn't check the files keyloom wrote for ${Math.round(settleMs / 1000)} s, so keyloom didn't start the build.${detail ? ` Docker said: ${detail}` : ""}`);
  }
  throw new BuildFailure(
    `Docker still sees an old or missing copy of ${differing.map((p) => p.slice(check.containerRoot.length + 1)).join(", ")} after ${Math.round(settleMs / 1000)} s, so the build would not use what keyloom wrote. ` +
      `This is a stale shared folder (Colima's sshfs mount); restart it with \`colima restart\`, or move XDG_CACHE_HOME to a folder it shares reliably, then build again.${detail ? ` Docker said: ${detail}` : ""}`,
    // The page reads the code and offers the restart; the terminal keeps this sentence (R6-09).
    "stale_mount",
  );
}
