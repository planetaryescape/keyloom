// The server's new-keyboard interface over the app (22, D-336). The keyboards on USB come from the sync engine's own reads, so the card
// and the engine share one look at USB; previews and adds read the pinned firmware trees as `keyloom keyboard add` does.
import {
  NotFoundError, StaleBaseError, UsageError, ValidationFailedError, addKeyboard, previewKeyboard, previewPut, putConfig, searchKeyboards, type AddDeps, type App,
} from "../app/index.ts";
import type { SyncEngine } from "../app/sync-engine.ts";
import { KeyboardsError, type KeyboardsBackend } from "../server/keyboards-backend.ts";

async function translate<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) throw new KeyboardsError(404, "not_found", err.message);
    if (err instanceof UsageError) throw new KeyboardsError(400, "usage", err.message);
    // The validator refused the mapping: the page shows why against the keys it names, not "internal error" (D-014).
    if (err instanceof ValidationFailedError) throw new KeyboardsError(400, "validation", err.message);
    if (err instanceof StaleBaseError) throw new KeyboardsError(409, "stale", err.message);
    throw err;
  }
}

// zod's optional fields carry `undefined`; the app's inputs leave them out.
const defined = <T extends Record<string, unknown>>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };

export function appKeyboardsBackend(app: App, engine: SyncEngine, deps: AddDeps = {}): KeyboardsBackend {
  return {
    detect: (search) => translate(() => ({ keyboards: engine.newKeyboards(), candidates: search === null ? [] : searchKeyboards(search) })),
    preview: (request) => translate(() => previewKeyboard(defined(request), deps)),
    add: (request) =>
      translate(async () => {
        const out = await addKeyboard(app, defined(request), deps);
        // The keyboard is known from now on; the engine reads it at once so the card and the board switch agree.
        engine.notifyApplied();
        return { boardId: out.boardId, name: out.name, displayName: out.displayName, warnings: out.warnings };
      }),
    previewPut: (request) => translate(() => previewPut(app, defined(request))),
    put: (request) => translate(() => putConfig(app, defined(request))),
  };
}
