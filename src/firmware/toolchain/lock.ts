// A directory lock shared between keyloom processes: two builds in one checkout would overwrite
// each other's keymap and outputs. mkdir is atomic, and the owner's pid lets a lock left by a
// crashed process be taken over.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Whether a process with this pid exists (we may not be allowed to signal it, which still means it exists). */
export const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
};

export class LockTimeoutError extends Error {
  override name = "LockTimeoutError";
}

export async function withLock<T>(
  dir: string,
  fn: () => Promise<T>,
  opts: { timeoutMs: number; onWait?: (heldBy: number | undefined) => void; pollMs?: number },
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  let announced = false;
  for (;;) {
    try {
      await mkdir(dir);
      break;
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err;
    }
    const owner = Number.parseInt(await readFile(join(dir, "pid"), "utf8").catch(() => ""), 10);
    // A lock with no pid file yet is being created; only an owner known to be dead is taken over.
    if (Number.isInteger(owner) && !processAlive(owner)) {
      await rm(dir, { recursive: true, force: true });
      continue;
    }
    if (!announced) {
      announced = true;
      opts.onWait?.(Number.isInteger(owner) ? owner : undefined);
    }
    if (Date.now() > deadline) throw new LockTimeoutError(`${dir} is held by another keyloom process (pid ${Number.isInteger(owner) ? owner : "unknown"})`);
    await Bun.sleep(opts.pollMs ?? 500);
  }
  try {
    await writeFile(join(dir, "pid"), String(process.pid));
    return await fn();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
