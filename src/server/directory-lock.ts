// One keyloom decides what to do about a data directory's server at a time (D-454). Every `keyloom serve` takes this lock before it looks
// for a live server and keeps it until its own server has announced itself (or it has decided not to start one), so a plain `serve`
// can't start between a replacer's old server exiting and the replacement announcing, and two replacers can't both win.
//
// Why a SQLite lock and not a pid file: a pid file needs "create it, then write the pid", and in that gap a reader sees an empty file
// it must treat as stale or as held; either choice lets two holders through or deadlocks, and breaking a stale file is itself a race.
// `BEGIN EXCLUSIVE` on a SQLite file is an OS file lock taken in one step. The kernel drops it when the process dies, however it dies,
// so there is no stale lock and no takeover. The rollback-journal mode (the default, not WAL) is used because EXCLUSIVE is then a real
// whole-file lock. bun:sqlite is already how keyloom opens its database, so it works the same in the compiled binary.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../app/errors.ts";

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

export type LockOptions = Clock & {
  /** Absolute time (in `now()` terms) after which waiting gives up. Shared with the stop wait, so the whole takeover has one budget. */
  deadline: number;
  say?: (line: string) => void;
  pollMs?: number;
};

const contended = (err: unknown): boolean => ["SQLITE_BUSY", "SQLITE_LOCKED"].includes((err as { code?: string }).code ?? "");

/** Waits for the directory's lock and returns the function that releases it. Release is idempotent. */
export async function acquireDirectoryLock(dataDir: string, opts: LockOptions): Promise<() => void> {
  const { now, sleep, deadline, say = () => {}, pollMs = 100 } = opts;
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "serve.lock"), { create: true, strict: true });
  // No SQLite-side waiting: it would block the event loop. The retry below waits asynchronously and can say what it is waiting for.
  db.run("PRAGMA busy_timeout = 0");
  const started = now();
  let told = false;
  try {
    for (;;) {
      try {
        db.run("BEGIN EXCLUSIVE");
        break;
      } catch (err) {
        if (!contended(err)) throw err;
      }
      if (now() >= deadline) throw new UsageError(`another keyloom is starting or replacing the server for ${dataDir}, and did not finish in time; try again in a moment.`);
      if (!told && now() - started >= 1000) {
        told = true;
        say("Waiting for another keyloom that is starting or replacing the server here.");
      }
      await sleep(pollMs);
    }
  } catch (err) {
    db.close();
    throw err;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      db.run("COMMIT");
    } finally {
      db.close();
    }
  };
}
