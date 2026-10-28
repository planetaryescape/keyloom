// What `keyloom serve` does when another keyloom already serves the data directory (D-323, D-454): refuse, attach with --reuse, or
// stop it with --replace. Split from main.ts so every branch is testable without starting processes.
import { IncompatibleError, UsageError, assertDataDirOpenable } from "../app/index.ts";
import { type Identity, assessServer, wouldDowngrade } from "../server/server-compat.ts";
import { type ProcessDeps, acquireReplaceLock, stopServer } from "../server/replace-server.ts";
import { type RunningRecord, liveServer } from "../server/running-server.ts";

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
  live?: (dir: string) => Promise<RunningRecord | undefined>;
  process?: ProcessDeps;
  timeoutMs?: number;
  /** Throws if this binary can't open the data directory; reads only. */
  canOpen?: (dir: string) => void;
};

/** `attached`: the caller has nothing more to do. Otherwise it starts a server and calls `release` once that server has announced itself. */
export type ExistingServerOutcome = { attached: true } | { attached: false; release: () => void };

export async function resolveExistingServer(req: ExistingServerRequest, deps: ExistingServerDeps = {}): Promise<ExistingServerOutcome> {
  const live = deps.live ?? liveServer;
  const other = await live(req.dir);
  if (!req.replace) {
    if (other === undefined) return { attached: false, release: () => {} };
    if (!req.reuse) throw new UsageError(`keyloom is already serving ${req.dir} at ${other.url} (process ${other.pid}); open that, or stop it first`);
    const verdict = req.clientProtocol === undefined ? ({ compatible: true } as const) : assessServer(other, req.mine, req.dir);
    if (verdict.compatible) {
      req.say(`keyloom is already running at ${other.url}\n`);
      return { attached: true };
    }
    // The two marker lines are what the desktop shell reads; the error is for a person at a terminal.
    req.say(`keyloom cannot attach: ${verdict.words}\n`);
    if (verdict.replaceLabel !== null) req.say(`keyloom can replace it: ${verdict.replaceLabel}\n`);
    throw new IncompatibleError("server_incompatible", verdict.replaceLabel === null ? verdict.words : `${verdict.words} Run \`keyloom serve --replace\` to stop it and serve with this keyloom.`);
  }

  // The data directory first: stopping a server this binary then can't replace would leave the person with none.
  (deps.canOpen ?? assertDataDirOpenable)(req.dir);
  const lockOptions = { ...(deps.process ? { deps: deps.process } : {}), ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}), say: (line: string) => req.say(`${line}\n`) };
  const release = await acquireReplaceLock(req.dir, lockOptions);
  try {
    // Looked at again under the lock: a racing --replace may have finished, and the server it started is the one to judge.
    const current = await live(req.dir);
    if (current !== undefined) {
      if (current.version === req.mine.version && current.protocol === req.mine.protocol) {
        req.say(`keyloom is already running at ${current.url}\n`);
        release();
        return { attached: true };
      }
      if (wouldDowngrade(current, req.mine)) {
        const words = `${req.dir} is already being served by keyloom ${current.version}, which is newer than this ${req.mine.version}. Replacing it would downgrade it, so it was left running; update this keyloom instead.`;
        req.say(`keyloom cannot attach: ${words}\n`);
        throw new IncompatibleError("server_incompatible", words);
      }
      await stopServer(current, lockOptions);
    }
    return { attached: false, release };
  } catch (err) {
    release();
    throw err;
  }
}
