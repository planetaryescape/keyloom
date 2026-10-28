// What `keyloom serve` does when another keyloom already serves the data directory (D-323, D-454): refuse, attach with --reuse, or
// stop it with --replace. Split from main.ts so every branch is testable without starting processes.
import { IncompatibleError, UsageError, assertDataDirOpenable } from "../app/index.ts";
import { acquireDirectoryLock } from "../server/directory-lock.ts";
import { type Identity, assessServer, wouldDowngrade } from "../server/server-compat.ts";
import { type ProcessDeps, TAKEOVER_TIMEOUT_MS, realProcessDeps, stopServer, waitForExit } from "../server/replace-server.ts";
import { type DrainingServer, type RunningRecord, liveServer, readRecord, sameServer } from "../server/running-server.ts";

export type ExistingServerRequest = {
  dir: string;
  reuse: boolean;
  replace: boolean;
  /** The desktop protocol the caller was built for; absent from a terminal, where --reuse attaches to any server as it always did. */
  clientProtocol: number | undefined;
  mine: Identity;
  say: (text: string) => void;
};

export type ExistingServerDeps = {
  live?: (dir: string) => Promise<RunningRecord | DrainingServer | undefined>;
  /** The record on disk now, for the check just before a signal. */
  record?: (dir: string) => RunningRecord | undefined;
  process?: ProcessDeps;
  /** The budget for the whole takeover: waiting for the lock, then for the old server to exit. */
  timeoutMs?: number;
  /** Throws if this binary can't open the data directory; reads only. */
  canOpen?: (dir: string) => void;
};

/** `attached`: the caller has nothing more to do. Otherwise it starts a server and calls `release` once that server has announced itself. */
export type ExistingServerOutcome = { attached: true } | { attached: false; release: () => void };

/** How many times --replace looks again when the server it was about to stop turns out not to be the one on record any more. */
const REASSESSMENTS = 3;

export async function resolveExistingServer(req: ExistingServerRequest, deps: ExistingServerDeps = {}): Promise<ExistingServerOutcome> {
  const live = deps.live ?? liveServer;
  const recordOnDisk = deps.record ?? readRecord;
  const clock = deps.process ?? realProcessDeps;
  const sayLine = (line: string) => req.say(`${line}\n`);
  const deadline = clock.now() + (deps.timeoutMs ?? TAKEOVER_TIMEOUT_MS);

  // Replace checks the data directory first: stopping a server this binary then can't replace would leave the person with none.
  if (req.replace) (deps.canOpen ?? assertDataDirOpenable)(req.dir);
  // Every start takes the lock, so a plain serve can't start between a replacer's old server exiting and its replacement announcing.
  const release = await acquireDirectoryLock(req.dir, { ...clock, deadline, say: sayLine });
  try {
    for (let attempt = 0; ; attempt++) {
      const other = await live(req.dir);
      if (other === undefined) return { attached: false, release };
      if ("draining" in other) {
        // A server we verified is shutting down and has dropped its record, but its process may still be writing to a keyboard. The
        // directory is not free until that process is gone; wait, never signal, then look again.
        await waitForExit(other.pid, "was already shutting down", { deps: clock, deadline, say: sayLine });
        continue;
      }

      if (!req.replace) {
        if (!req.reuse) throw new UsageError(`keyloom is already serving ${req.dir} at ${other.url} (process ${other.pid}); open that, or stop it first`);
        const verdict = req.clientProtocol === undefined ? ({ compatible: true } as const) : assessServer(other, req.mine, req.dir);
        if (verdict.compatible) {
          req.say(`keyloom is already running at ${other.url}\n`);
          release();
          return { attached: true };
        }
        // The two marker lines are what the desktop shell reads; the error is for a person at a terminal.
        req.say(`keyloom cannot attach: ${verdict.words}\n`);
        if (verdict.replaceLabel !== null) req.say(`keyloom can replace it: ${verdict.replaceLabel}\n`);
        throw new IncompatibleError("server_incompatible", verdict.replaceLabel === null ? verdict.words : `${verdict.words} Run \`keyloom serve --replace\` to stop it and serve with this keyloom.`);
      }

      if (other.version === req.mine.version && other.protocol === req.mine.protocol) {
        req.say(`keyloom is already running at ${other.url}\n`);
        release();
        return { attached: true };
      }
      if (wouldDowngrade(other, req.mine)) {
        const words = `${req.dir} is already being served by keyloom ${other.version}, which is newer than this ${req.mine.version}. Replacing it would downgrade it, so it was left running; update this keyloom instead.`;
        req.say(`keyloom cannot attach: ${words}\n`);
        throw new IncompatibleError("server_incompatible", words);
      }
      const outcome = await stopServer(other, { deps: clock, deadline, say: sayLine, stillCurrent: () => sameServer(other, recordOnDisk(req.dir)) });
      if (outcome === "stopped") return { attached: false, release };
      // The record changed between looking and signalling. If the server we verified is still alive it is shutting down (its record goes
      // before its last keyboard write finishes): wait for it without signalling, then judge what is there now.
      if (clock.alive(other.pid)) await waitForExit(other.pid, "was already shutting down", { deps: clock, deadline, say: sayLine });
      if (attempt + 1 >= REASSESSMENTS) throw new UsageError(`the server for ${req.dir} keeps changing, so none was stopped; try again in a moment.`);
    }
  } catch (err) {
    release();
    throw err;
  }
}
