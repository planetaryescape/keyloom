// The server's write interface over the app's use cases (rung 2). The server stays ignorant of
// storage, Docker and Zapp; this adapter is the one place that knows both sides.
import {
  type App, type BuildView, type FlashView, NotFoundError, StaleBaseError, UsageError, ValidationFailedError, applyOps, checkChange,
  ValidationResultSchema, getBuild, getFlash, startBuild, startFlash, undo,
} from "../app/index.ts";
import { type EditorBackend, EditorError } from "../server/editor-backend.ts";

type Build = Awaited<ReturnType<EditorBackend["startBuild"]>>;
type Flash = Awaited<ReturnType<EditorBackend["startFlash"]>>;

const toBuild = (b: BuildView): Build => ({
  id: b.id, revisionId: b.revisionId, status: b.status, error: b.error, startedAt: b.startedAt, finishedAt: b.finishedAt, logTail: b.logTail,
});

const toFlash = (f: FlashView): Flash => ({
  id: f.id, buildId: f.buildId, status: f.status, error: f.error, startedAt: f.startedAt, finishedAt: f.finishedAt,
  instruction: f.instruction, logTail: f.logTail,
});

/** Turns the app's typed errors into the status and code the browser acts on; anything else stays a 500. */
async function translate<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) throw new EditorError(404, "not_found", err.message);
    if (err instanceof StaleBaseError) throw new EditorError(409, "stale_base", err.message);
    if (err instanceof ValidationFailedError) {
      const parsed = ValidationResultSchema.safeParse(err.details);
      throw new EditorError(409, "validation_failed", err.message, parsed.success ? parsed.data : undefined);
    }
    if (err instanceof UsageError) throw new EditorError(400, "usage", err.message);
    throw err;
  }
}

/** Reads that find nothing are null, which the server turns into 404. */
async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export function appEditorBackend(app: App): EditorBackend {
  return {
    check: (ref, request) => translate(() => checkChange(app, ref, request)),
    apply: (ref, request) => translate(() => applyOps(app, ref, request)),
    undo: (ref, request) => translate(() => ({ revisionId: undo(app, ref, request).revision.id })),
    startBuild: (ref, request) =>
      translate(async () =>
        toBuild(await startBuild(app, ref, {
          revisionId: request.revisionId,
          ...(request.boardRevision === undefined ? {} : { boardRevision: request.boardRevision }),
        })),
      ),
    getBuild: async (id) => orNull(async () => toBuild(await getBuild(app, id))),
    startFlash: (buildId) => translate(async () => toFlash(await startFlash(app, { buildId }))),
    getFlash: async (id) => orNull(async () => toFlash(await getFlash(app, id))),
  };
}
