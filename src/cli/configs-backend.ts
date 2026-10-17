// The server's configs and versions interface over the app (rung 23). The server stays ignorant of storage and the sync
// engine; this adapter is the one place that knows both.
import {
  NotFoundError, StaleBaseError, UsageError, ValidationFailedError, archiveConfig, compareRevision, deleteConfig, listConfigs, nameVersion, newBlankConfig, newConfig, newConfigFromUpload, openProposalsOutsideChat, renameConfig, restoreConfig,
  restoreVersion, versionHistory, ValidationResultSchema, type App, type GeometryOptions,
} from "../app/index.ts";
import type { SyncEngine } from "../app/sync-engine.ts";
import { ConfigsError, type ConfigsBackend } from "../server/configs-backend.ts";

/** Turns the app's typed errors into the status and code the browser acts on; anything else stays a 500. */
async function translate<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) throw new ConfigsError(404, "not_found", err.message);
    if (err instanceof UsageError) throw new ConfigsError(400, "usage", err.message);
    if (err instanceof StaleBaseError) throw new ConfigsError(409, "stale_base", err.message);
    if (err instanceof ValidationFailedError) throw new ConfigsError(422, "validation", err.message, ValidationResultSchema.parse(err.details));
    throw err;
  }
}

/** `firmware` is where a blank config's default keymap is read from; tests pass fixtures, otherwise the pinned tree on GitHub (D-370). */
export function appConfigsBackend(app: App, engine: SyncEngine, firmware: GeometryOptions = {}): ConfigsBackend {
  return {
    list: (opts) => translate(() => listConfigs(app, { ...(opts.board === undefined ? {} : { board: opts.board }), includeArchived: opts.includeArchived })),
    create: (request) =>
      translate(async () => {
        if (request.from === "blank") {
          const made = await newBlankConfig(app, request, firmware);
          return { config: made.config, note: made.note };
        }
        if (request.from === "import") {
          const made = await newConfigFromUpload(app, { name: request.name, board: request.board, filename: request.filename, bytes: Buffer.from(request.data, "base64") });
          return { config: made.config };
        }
        return {
          config: newConfig(app, {
            name: request.name, from: "config", config: request.config, ...(request.revision === undefined ? {} : { revision: request.revision }), ...(request.version === undefined ? {} : { version: request.version }),
          }),
        };
      }),
    rename: (ref, name) => translate(() => renameConfig(app, ref, name)),
    archive: (ref) => translate(() => archiveConfig(app, ref)),
    restore: (ref) => translate(() => restoreConfig(app, ref)),
    remove: (ref, name) => translate(() => void deleteConfig(app, ref, name)),
    use: (ref) =>
      translate(async () => {
        const r = await engine.useConfig(ref);
        return { result: r.kind, boards: engine.views() };
      }),
    versions: (ref) => translate(() => versionHistory(app, ref)),
    nameVersion: (ref, target, name) => translate(() => nameVersion(app, ref, target, name)),
    restoreVersion: (ref, target) =>
      translate(() => {
        const out = restoreVersion(app, ref, target);
        // A new revision is an Apply as far as the keyboard goes: if this is the config on it, the engine should see it now.
        engine.notifyApplied();
        return { revisionId: out.revision.id, restoredRevisionId: out.restoredRevisionId };
      }),
    compare: (ref, target) => translate(() => compareRevision(app, ref, target)),
    proposals: (ref) => translate(() => openProposalsOutsideChat(app, ref)),
  };
}
