import type { Database } from "bun:sqlite";

/**
 * Runs `fn` in one write transaction taken up front. A read that decides what to write (the head
 * revision) must not be upgraded to a write later: with the server and the CLI on one file, that
 * upgrade can fail with SQLITE_BUSY, or lose a race the lock was meant to settle.
 */
export const transact = <T>(db: Database, fn: () => T): T => db.transaction(fn).immediate();
