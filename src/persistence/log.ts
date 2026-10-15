// The structured log (11#logs): JSON lines in `<data dir>/logs/keyloom.log`, rotated at 10 MB with
// 5 files kept. Written synchronously and by hand rather than with pino's transports, because a
// CLI that exits right after a turn must not lose the line to a worker thread that hasn't flushed,
// and the whole job is an append plus a rename.
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { logsDir } from "./paths.ts";

export const MAX_LOG_BYTES = 10 * 1024 * 1024;
export const KEPT_LOG_FILES = 5;

const LOG_NAME = "keyloom.log";

function rotate(dir: string): void {
  const current = join(dir, LOG_NAME);
  rmSync(join(dir, `${LOG_NAME}.${KEPT_LOG_FILES - 1}`), { force: true });
  for (let i = KEPT_LOG_FILES - 2; i >= 1; i--) {
    const from = join(dir, `${LOG_NAME}.${i}`);
    if (existsSync(from)) renameSync(from, join(dir, `${LOG_NAME}.${i + 1}`));
  }
  renameSync(current, join(dir, `${LOG_NAME}.1`));
}

/**
 * Appends one record. A log line is a convenience: failing to write it must never fail the
 * turn it describes, so errors are swallowed.
 */
export function appendLog(dataDir: string, record: Record<string, unknown>, now = Date.now()): void {
  try {
    const dir = logsDir(dataDir);
    mkdirSync(dir, { recursive: true });
    const current = join(dir, LOG_NAME);
    if (existsSync(current) && statSync(current).size >= MAX_LOG_BYTES) rotate(dir);
    appendFileSync(current, `${JSON.stringify({ time: new Date(now).toISOString(), ...record })}\n`);
  } catch {
    // See above.
  }
}
