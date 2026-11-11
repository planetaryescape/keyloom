// Exit codes (10#exit-codes). Only the codes this build can produce are mapped.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CredentialError, PlatformUnavailableError, BuildFailedError, BusyError, IncompatibleError, SchemaTooNewError, LabCaptureError, EmulateFailedError, FlashFailedError, ModelError, NotFoundError, StaleBaseError, ToolchainUnavailableError, UsageError, ValidationFailedError, logsDir } from "../app/index.ts";

export const EXIT = { ok: 0, bug: 1, usage: 2, notFound: 3, validation: 4, staleBase: 5, toolchain: 6, buildFailed: 7, flashFailed: 8, modelApi: 9, incompatible: 10 } as const;

export type Classified = { code: number; kind: string; message: string };

export function classify(err: unknown, dataDir: string): Classified {
  if (err instanceof PlatformUnavailableError) return { code: EXIT.toolchain, kind: err.code, message: err.message };
  // A refused key is the provider's answer (9); a key store that failed is this computer's tooling (6); the rest are the input (2).
  if (err instanceof CredentialError) return { code: err.code === "key_rejected" ? EXIT.modelApi : err.code === "key_store_failed" ? EXIT.toolchain : EXIT.usage, kind: err.code, message: err.message };
  if (err instanceof ModelError) {
    // The model's own sentence is shared with the page, which has a button for this; the terminal gets the command (R3-11).
    const next = err.kind === "auth" ? " Save one with `keyloom provider key set <provider>`; `keyloom provider` shows which provider is in use."
      : err.kind === "no_credits" ? " Or switch provider with --provider."
      : err.kind === "context_full" ? " Start a new conversation (omit --conversation)." : "";
    return { code: EXIT.modelApi, kind: err.kind === "missing_key" ? "missing_api_key" : "model_api", message: `${err.message}${next}` };
  }
  if (err instanceof SchemaTooNewError) return { code: EXIT.incompatible, kind: "schema_too_new", message: err.message };
  if (err instanceof IncompatibleError) return { code: EXIT.incompatible, kind: err.kind, message: err.message };
  if (err instanceof BusyError) return { code: EXIT.usage, kind: "busy", message: err.message };
  if (err instanceof LabCaptureError) return { code: EXIT.usage, kind: err.code, message: err.message };
  if (err instanceof UsageError) return { code: EXIT.usage, kind: "usage", message: err.message };
  if (err instanceof NotFoundError) return { code: EXIT.notFound, kind: "not_found", message: err.message };
  if (err instanceof ValidationFailedError) return { code: EXIT.validation, kind: "validation_failed", message: err.message };
  if (err instanceof StaleBaseError) return { code: EXIT.staleBase, kind: "stale_base", message: err.message };
  if (err instanceof ToolchainUnavailableError) return { code: EXIT.toolchain, kind: "toolchain_unavailable", message: err.message };
  if (err instanceof BuildFailedError) return { code: EXIT.buildFailed, kind: "build_failed", message: err.message };
  if (err instanceof EmulateFailedError) return { code: EXIT.buildFailed, kind: "emulate_failed", message: err.message };
  if (err instanceof FlashFailedError) return { code: EXIT.flashFailed, kind: "flash_failed", message: err.message };
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
