// The server's keyboard sync interface over the app's engine (rung 13). The server stays ignorant of USB and
// builds; this adapter is the one place that knows both sides.
import { NotFoundError, UsageError } from "../app/index.ts";
import type { SyncEngine } from "../app/sync-engine.ts";
import { SyncError, type SyncBackend } from "../server/sync-backend.ts";

/** Turns the app's typed errors into the status and code the browser acts on; anything else stays a 500. */
async function translate<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) throw new SyncError(404, "not_found", err.message);
    if (err instanceof UsageError) throw new SyncError(400, "usage", err.message);
    throw err;
  }
}

export function appSyncBackend(engine: SyncEngine): SyncBackend {
  return {
    status: () => translate(() => engine.snapshot()),
    syncNow: (layoutId) =>
      translate(async () => {
        const r = await engine.syncNow(layoutId);
        return { result: r.kind, boards: engine.views() };
      }),
    setAutoSync: (boardId, enabled) => translate(() => (engine.setAutoSync(boardId, enabled), engine.views())),
    setPaused: (boardId, paused) => translate(() => (engine.setPaused(boardId, paused), engine.views())),
    disableRemapping: (boardId) => translate(async () => (await engine.disableRemapping(boardId), engine.views())),
    subscribe: (listener) => engine.subscribe(listener),
    newKeyboards: () => engine.newKeyboards(),
  };
}
