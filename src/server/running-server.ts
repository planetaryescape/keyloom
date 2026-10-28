// Which keyloom server is serving a data directory right now. Two servers on one directory would each run a sync engine and a
// board review (D-323), so a server announces itself here and the desktop app attaches to a live one instead of starting its own.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// Unknown keys are dropped, so a `__proto__` or `constructor` entry never reaches the record. pid 0 and negatives address process groups
// with kill(2), and 1 is init, hence the bound. A version or protocol of the wrong type is read as absent (an old record).
const RecordSchema = z.object({
  pid: z.number().int().gt(1),
  url: z.string(),
  startedAt: z.string().catch(""),
  version: z.string().max(64).optional().catch(undefined),
  protocol: z.number().int().optional().catch(undefined),
});

/** `version` is package.json's version of the keyloom that wrote the record and `protocol` its desktop protocol (src/api/desktop-protocol.ts); both are absent from a record written before keyloom checked versions (D-454). `url` is the token URL `keyloom serve` printed; the file is mode 0600 because it carries the session token. */
export type RunningRecord = z.infer<typeof RecordSchema>;

const fileFor = (dataDir: string): string => join(dataDir, "serve.json");

export const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
};

/** Writes the record and returns the function that removes it, which leaves a newer server's record alone. */
export function announceServer(dataDir: string, url: string, identity: { version: string; protocol: number }): () => void {
  mkdirSync(dataDir, { recursive: true });
  const record: RunningRecord = { pid: process.pid, url, startedAt: new Date().toISOString(), version: identity.version, protocol: identity.protocol };
  const path = fileFor(dataDir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return () => {
    try {
      if (readRecord(dataDir)?.pid === process.pid) rmSync(path, { force: true });
    } catch {
      // Already gone, or replaced by a record this process can't read: nothing of ours to remove.
    }
  };
}

/**
 * The record on disk, rebuilt field by field: a hand-edited or damaged file never hands a wrong type (or a pid that would signal a process
 * group) to the code that attaches to or stops a server. Version and protocol that don't read as a string and an integer are absent.
 */
export function readRecord(dataDir: string): RunningRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(fileFor(dataDir), "utf8"));
  } catch {
    return undefined;
  }
  const parsed = RecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** The same server: a new one on the same pid or port would differ in at least `startedAt`. */
export const sameServer = (a: RunningRecord | undefined, b: RunningRecord | undefined): boolean =>
  a !== undefined && b !== undefined && a.pid === b.pid && a.url === b.url && a.startedAt === b.startedAt;

/** How many times discovery looks again when the record changes under its probe. */
const DISCOVERY_ATTEMPTS = 3;

/**
 * A server that answered a probe and then dropped or changed its record while its process is still alive. That is a server shutting
 * down (SIGTERM removes the record before a keyboard write finishes), not an absent one: starting beside it would run two sync engines.
 */
export type DrainingServer = { draining: true; pid: number };

/**
 * The server already serving `dataDir`, or undefined. A record counts only if its process exists and the server answers with its
 * token: a crash leaves the file behind, and a recycled pid is not a keyloom server. The probe takes up to `timeoutMs`, so the record is
 * read again afterwards: one that changed meanwhile is looked at afresh, because acting on the first server's identity could signal it,
 * or start beside its successor. If it changed because the server that answered is going away but its process still exists, that
 * process is returned as `draining` so the caller waits for it instead of treating the directory as free.
 */
export async function liveServer(dataDir: string, timeoutMs = 1500): Promise<RunningRecord | DrainingServer | undefined> {
  for (let attempt = 0; attempt < DISCOVERY_ATTEMPTS; attempt++) {
    const record = readRecord(dataDir);
    if (record === undefined || record.pid === process.pid || !processAlive(record.pid)) return undefined;
    let answered = false;
    try {
      const url = new URL(record.url);
      const token = url.searchParams.get("t");
      if (token === null) return undefined;
      const res = await fetch(new URL("/api/layouts", url.origin), { headers: { "x-keyloom-token": token }, signal: AbortSignal.timeout(timeoutMs) });
      answered = res.ok;
    } catch {
      // Not answering: handled below with a re-read, since a successor may have announced meanwhile.
    }
    const after = readRecord(dataDir);
    if (sameServer(record, after)) return answered ? record : undefined;
    // Only a server that answered is known to be a keyloom server; a pid that merely exists could be anything.
    if (answered && processAlive(record.pid)) return { draining: true, pid: record.pid };
  }
  // The record kept changing under every probe; nothing can be trusted as the server to act on.
  return undefined;
}
