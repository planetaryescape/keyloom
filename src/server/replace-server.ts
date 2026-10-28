// Stopping the keyloom server that is serving a data directory so this one can take over (`serve --replace`, D-454). The only signal
// is SIGTERM: the server finishes a keyboard write in progress before it exits, and a SIGKILL mid-flash is the outcome to avoid.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../app/errors.ts";
import { type RunningRecord, processAlive } from "./running-server.ts";

/** How long a server may take to finish a keyboard sync before we give up waiting for it (it is never killed). */
export const STOP_TIMEOUT_MS = 120_000;

export type ProcessDeps = {
  signal: (pid: number, signal: "SIGTERM") => void;
  alive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export const realProcessDeps: ProcessDeps = {
  signal: (pid, signal) => void process.kill(pid, signal),
  alive: processAlive,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
};

type Options = { deps?: ProcessDeps; timeoutMs?: number; say?: (line: string) => void; pollMs?: number };

/** Asks the server to stop and waits for its process to be gone, not just for its record: the record is removed before a sync finishes. */
export async function stopServer(server: Pick<RunningRecord, "pid">, opts: Options = {}): Promise<void> {
  const { deps = realProcessDeps, timeoutMs = STOP_TIMEOUT_MS, say = () => {}, pollMs = 100 } = opts;
  try {
    deps.signal(server.pid, "SIGTERM");
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ESRCH") return;
    if (code === "EPERM") throw new UsageError(`keyloom process ${server.pid} is serving this data directory but belongs to another user, so it can't be stopped from here. It is still running; stop it yourself.`);
    throw err;
  }
  const started = deps.now();
  let told = false;
  while (deps.alive(server.pid)) {
    const waited = deps.now() - started;
    if (waited >= timeoutMs) {
      throw new UsageError(`keyloom process ${server.pid} was asked to stop ${Math.round(waited / 1000)} s ago and is still running, perhaps finishing a write to the keyboard. It was not killed and no second server was started; try again once it has exited.`);
    }
    if (!told && waited >= 1000) {
      told = true;
      say("Waiting for the running keyloom to finish a keyboard sync that is writing; don't unplug the keyboard.");
    }
    await deps.sleep(pollMs);
  }
}

const lockFile = (dataDir: string): string => join(dataDir, "serve.lock");

/**
 * One `serve --replace` at a time per data directory: two racing replacers would each wait out the old server and then each start a
 * new one, and two servers on one directory run two sync engines (D-323). Held until the new server has announced itself.
 * A lock whose holder is gone is taken over; a live holder is waited for, then given up on.
 */
export async function acquireReplaceLock(dataDir: string, opts: Options = {}): Promise<() => void> {
  const { deps = realProcessDeps, timeoutMs = STOP_TIMEOUT_MS, pollMs = 100 } = opts;
  mkdirSync(dataDir, { recursive: true });
  const path = lockFile(dataDir);
  const started = deps.now();
  for (;;) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
      return () => {
        try {
          if (readFileSync(path, "utf8") === String(process.pid)) rmSync(path, { force: true });
        } catch {
          // Already gone: nothing of ours to remove.
        }
      };
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err;
    }
    let holder = Number.NaN;
    try {
      holder = Number(readFileSync(path, "utf8"));
    } catch {
      continue; // released between our write and read
    }
    if (!Number.isInteger(holder) || holder <= 1 || !deps.alive(holder)) {
      rmSync(path, { force: true });
      continue;
    }
    if (deps.now() - started >= timeoutMs) throw new UsageError(`another keyloom (process ${holder}) is replacing the server for ${dataDir}; try again when it has finished.`);
    await deps.sleep(pollMs);
  }
}
