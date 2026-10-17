// Which keyloom server is serving a data directory right now. Two servers on one directory would each run a sync engine and a
// board review (D-323), so a server announces itself here and the desktop app attaches to a live one instead of starting its own.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RunningRecord {
  pid: number;
  /** The token URL `keyloom serve` printed. The file is mode 0600 because the URL carries the session token. */
  url: string;
  startedAt: string;
}

const fileFor = (dataDir: string): string => join(dataDir, "serve.json");

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
};

/** Writes the record and returns the function that removes it, which leaves a newer server's record alone. */
export function announceServer(dataDir: string, url: string): () => void {
  mkdirSync(dataDir, { recursive: true });
  const record: RunningRecord = { pid: process.pid, url, startedAt: new Date().toISOString() };
  const path = fileFor(dataDir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return () => {
    try {
      if ((JSON.parse(readFileSync(path, "utf8")) as RunningRecord).pid === process.pid) rmSync(path, { force: true });
    } catch {
      // Already gone, or replaced by a record this process can't read: nothing of ours to remove.
    }
  };
}

/**
 * The server already serving `dataDir`, or undefined. A record counts only if its process exists and the server answers with its
 * token: a crash leaves the file behind, and a recycled pid is not a keyloom server.
 */
export async function liveServer(dataDir: string, timeoutMs = 1500): Promise<RunningRecord | undefined> {
  let record: RunningRecord;
  try {
    record = JSON.parse(readFileSync(fileFor(dataDir), "utf8")) as RunningRecord;
  } catch {
    return undefined;
  }
  if (typeof record.url !== "string" || !Number.isInteger(record.pid) || record.pid === process.pid || !processAlive(record.pid)) return undefined;
  try {
    const url = new URL(record.url);
    const token = url.searchParams.get("t");
    if (token === null) return undefined;
    const res = await fetch(new URL("/api/layouts", url.origin), { headers: { "x-keyloom-token": token }, signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? record : undefined;
  } catch {
    return undefined;
  }
}
