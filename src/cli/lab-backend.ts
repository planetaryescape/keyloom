// The server's typing lab over the app (rung 22, D-314): it holds the one recording in progress, so the browser starts and stops it
// and the keyboard's stream lives in this process. The keyboard and the emulator come from LabDeps, so tests run on a fake keyboard.
import {
  LabCaptureError, NotFoundError, UsageError, analyseSession, beginRecording, cannotRecord, deleteSession, endRecording, getLayout, labPassages, labReadout, labSessions,
  type App, type LabDeps, type RecordingInProgress,
} from "../app/index.ts";
import { LabError, type LabBackend } from "../server/lab-backend.ts";

async function translate<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LabCaptureError) throw new LabError(409, err.code, err.message);
    if (err instanceof NotFoundError) throw new LabError(404, "not_found", err.message);
    if (err instanceof UsageError) throw new LabError(400, "usage", err.message);
    throw err;
  }
}

const sessionView = (s: ReturnType<typeof labSessions>[number]) => ({
  id: s.id, layoutId: s.layoutId, passageId: s.passageId, startedAt: s.startedAt, endedAt: s.endedAt, eventCount: s.eventCount, analysed: s.analysed, warnings: s.warnings,
});

export function appLabBackend(app: App, deps: LabDeps): LabBackend {
  // One keyboard, one recording: a second start while one runs is refused, never stacked.
  let recording: RecordingInProgress | null = null;
  const starting = new Set<Promise<unknown>>();
  const stopping = new Set<Promise<unknown>>();
  let cancellation: Promise<void> | undefined;
  let shuttingDown = false;
  const readout = (id: string) => {
    const r = labReadout(app, id);
    return { session: sessionView(r.session), readout: r.readout };
  };
  return {
    passages: (ref) =>
      translate(() => {
        const board = getLayout(app, ref).board.definition;
        const why = cannotRecord(board);
        return { passages: labPassages(app, ref), canRecord: why === null, why };
      }),
    sessions: (ref) => translate(() => labSessions(app, ref).map(sessionView)),
    start: (ref, request) => {
      const operation = translate(async () => {
        if (shuttingDown || recording !== null || starting.size > 0) throw new LabError(409, "busy", "A recording is already running. Stop it first.");
        const why = cannotRecord(getLayout(app, ref).board.definition);
        if (why !== null) throw new UsageError(why);
        recording = await beginRecording(app, ref, deps, { ...(request.passageId ? { passageId: request.passageId } : {}), ...(request.text !== undefined ? { text: request.text } : {}) });
        const p = recording.passage;
        const passage = labPassages(app, ref).find((x) => x.id === p.id) ?? { id: p.id, title: p.title, why: p.why, text: request.text ?? "" };
        return { passage, startedAt: recording.startedAt };
      });
      starting.add(operation);
      void operation.then(() => { starting.delete(operation); }, () => { starting.delete(operation); });
      return operation;
    },
    stop: (typedText) => {
      const operation = translate(async () => {
        const rec = recording;
        if (rec === null) throw new UsageError("no recording is running");
        recording = null;
        const { session } = await endRecording(app, rec, typedText);
        return sessionView(session);
      });
      stopping.add(operation);
      void operation.then(() => { stopping.delete(operation); }, () => { stopping.delete(operation); });
      return operation;
    },
    cancel: async () => {
      shuttingDown = true;
      cancellation ??= (async () => {
        // Shutdown must not close the helper or database while a start or stop still owns them.
        while (starting.size > 0 || stopping.size > 0) {
          await Promise.allSettled([...starting, ...stopping]);
        }
        const rec = recording;
        recording = null;
        // The keyboard is asked to stop; what it heard is dropped.
        await rec?.capture.finish().catch(() => {});
      })();
      await cancellation;
    },
    readout: (id) => translate(() => readout(id)),
    analyse: (id) =>
      translate(async () => {
        await analyseSession(app, id, deps);
        return readout(id);
      }),
    remove: (id) => translate(() => deleteSession(app, id)),
  };
}
