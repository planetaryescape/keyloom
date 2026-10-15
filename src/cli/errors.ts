// Exit codes (10#exit-codes). Only the codes this build can produce are mapped.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NotFoundError, StaleBaseError, UsageError, ValidationFailedError, logsDir } from "../app/index.ts";

export const EXIT = { ok: 0, bug: 1, usage: 2, notFound: 3, validation: 4, staleBase: 5 } as const;

export type Classified = { code: number; kind: string; message: string };

export function classify(err: unknown, dataDir: string): Classified {
  if (err instanceof UsageError) return { code: EXIT.usage, kind: "usage", message: err.message };
  if (err instanceof NotFoundError) return { code: EXIT.notFound, kind: "not_found", message: err.message };
  if (err instanceof ValidationFailedError) return { code: EXIT.validation, kind: "validation_failed", message: err.message };
  if (err instanceof StaleBaseError) return { code: EXIT.staleBase, kind: "stale_base", message: err.message };
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  let where = "";
  try {
    const dir = logsDir(dataDir);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `cli-${new Date().toISOString().replaceAll(":", "-")}.log`);
    writeFileSync(file, `${detail}\n`);
    where = ` Details: ${file}`;
  } catch {
    // The log is a convenience; losing it must not hide the error.
  }
  return { code: EXIT.bug, kind: "bug", message: `unexpected error: ${err instanceof Error ? err.message : String(err)}.${where}` };
}
