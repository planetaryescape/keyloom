// The server's write interface over the app's use cases (rung 2). The server stays ignorant of
// storage, Docker and Zapp; this adapter is the one place that knows both sides.
import {
  type App, type BuildView, type FlashOptions, type FlashView, NotFoundError, StaleBaseError, UsageError, ValidationFailedError, applyChange, applyOps, checkChange, parseBindingExpression,
  ValidationResultSchema, getBuild, getFlash, importUpload, listBoardDefinitions, listRevisions, startBuild, startFlash, undo, upgradeLayout,
} from "../app/index.ts";
import { type EditorBackend, EditorError } from "../server/editor-backend.ts";

type Build = Awaited<ReturnType<EditorBackend["startBuild"]>>;
type Flash = Awaited<ReturnType<EditorBackend["startFlash"]>>;

const toBuild = (b: BuildView): Build => ({
  id: b.id, revisionId: b.revisionId, status: b.status, error: b.error, startedAt: b.startedAt, finishedAt: b.finishedAt, logTail: b.logTail,
});

const toFlash = (f: FlashView): Flash => ({
  id: f.id, buildId: f.buildId, status: f.status, error: f.error, startedAt: f.startedAt, finishedAt: f.finishedAt,
  instruction: f.instruction, note: f.note, logTail: f.logTail,
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

/** `flash` carries what a flash needs beyond the build: tests point `volumesRoot` at a temporary directory and shorten the wait. */
export function appEditorBackend(app: App, flash: Pick<FlashOptions, "volumesRoot" | "bootloaderWaitMs" | "handsFree"> = {}, onApplied?: () => void): EditorBackend {
  // Keyboard sync wakes at once on an Apply instead of at its next look; it would see the new head either way (it reads the database).
  const applied = <T>(value: T): T => {
    onApplied?.();
    return value;
  };
  return {
    check: (ref, request) => translate(() => checkChange(app, ref, request)),
    parseBinding: (ref, request) => translate(() => parseBindingExpression(app, ref, request)),
    apply: (ref, request) => translate(() => applied(applyOps(app, ref, request))),
    applyChangeSet: (changeSetId) => translate(() => applied(applyChange(app, changeSetId))),
    undo: (ref, request) => translate(() => applied({ revisionId: undo(app, ref, { revisionId: request.revisionId, ...(request.to === undefined ? {} : { to: request.to }) }).revision.id })),
    upgrade: (ref) => translate(() => {
      const out = upgradeLayout(app, ref);
      if (out.changed) applied(undefined);
      return { changed: out.changed, message: out.message, revisionId: out.changed ? out.revisionId : null };
    }),
    revisions: async (ref) => translate(() => {
      const rows = listRevisions(app, ref);
      return rows.map((r, index) => ({ id: r.id, parentId: r.parentId, origin: r.origin, summary: r.summary, createdAt: r.createdAt, isHead: index === 0 }));
    }),
    boards: async () => listBoardDefinitions().map((b) => ({
      id: b.definition.id, name: b.definition.name, vendor: b.definition.vendor, firmware: b.definition.firmware, keyCount: b.definition.keyCount, importers: b.definition.importers,
      keys: b.geometry.keys, display: b.definition.display,
    })),
    importUpload: (request) =>
      translate(async () => {
        const out = await importUpload(app, request);
        return { layoutId: out.layoutId, revisionId: out.revisionId, name: out.name, layers: out.report.layers, keysPerLayer: out.report.keysPerLayer, warnings: out.report.warnings };
      }),
    startBuild: (ref, request) =>
      translate(async () =>
        toBuild(await startBuild(app, ref, {
          revisionId: request.revisionId,
          ...(request.boardRevision === undefined ? {} : { boardRevision: request.boardRevision }),
        })),
      ),
    getBuild: async (id) => orNull(async () => toBuild(await getBuild(app, id))),
    startFlash: (buildId) => translate(async () => toFlash(await startFlash(app, { buildId, ...flash }))),
    getFlash: async (id) => orNull(async () => toFlash(await getFlash(app, id))),
  };
}
