// Stopping the keyloom server that is serving a data directory so this one can take over (`serve --replace`, D-454). The only signal
// is SIGTERM: the server finishes a keyboard write in progress before it exits, and a SIGKILL mid-flash is the outcome to avoid.
import { UsageError } from "../app/errors.ts";
import type { Clock } from "./directory-lock.ts";
import { type RunningRecord, processAlive } from "./running-server.ts";

/**
 * How long one takeover may take in all: waiting for the directory lock, then for the old server to finish a keyboard sync and exit.
 * The desktop shell waits 135 s for the sidecar's URL (sidecar.rs, `launch`), so this stays under it; change them together.
 */
export const TAKEOVER_TIMEOUT_MS = 120_000;

export type ProcessDeps = Clock & {
  signal: (pid: number, signal: "SIGTERM") => void;
  alive: (pid: number) => boolean;
};

export const realProcessDeps: ProcessDeps = {
  signal: (pid, signal) => void process.kill(pid, signal),
  alive: processAlive,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
};

export type StopOptions = {
  deps?: ProcessDeps;
  /** Absolute time (in `deps.now()` terms) after which we stop waiting. Never a reason to kill. */
  deadline: number;
  say?: (line: string) => void;
  pollMs?: number;
  /** Asked immediately before the signal: is `server` still the one the directory names? If not, nothing is signalled. */
  stillCurrent?: () => boolean;
};

/**
 * Asks the server to stop and waits for its process to be gone, not just for its record: the record is removed before a sync finishes.
 * Returns "changed" without signalling when the directory no longer names this server, so the caller can look again.
 */
export async function stopServer(server: Pick<RunningRecord, "pid">, opts: StopOptions): Promise<"stopped" | "changed"> {
  const { deps = realProcessDeps, deadline, say = () => {}, pollMs = 100, stillCurrent = () => true } = opts;
  if (!stillCurrent()) return "changed";
  try {
    deps.signal(server.pid, "SIGTERM");
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ESRCH") return "stopped";
    if (code === "EPERM") throw new UsageError(`keyloom process ${server.pid} is serving this data directory but belongs to another user, so it can't be stopped from here. It is still running; stop it yourself.`);
    throw err;
  }
  const signalled = deps.now();
  let told = false;
  while (deps.alive(server.pid)) {
    const now = deps.now();
    if (now >= deadline) {
      throw new UsageError(`keyloom process ${server.pid} was asked to stop ${Math.round((now - signalled) / 1000)} s ago and is still running, perhaps finishing a write to the keyboard. It was not killed and no second server was started; try again once it has exited.`);
    }
    if (!told && now - signalled >= 1000) {
      told = true;
      say("Waiting for the running keyloom to finish a keyboard sync that is writing; don't unplug the keyboard.");
    }
    await deps.sleep(pollMs);
  }
  return "stopped";
}
