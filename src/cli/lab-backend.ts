// The server's typing lab over the app (rung 22, D-314): it holds the one recording in progress, so the browser starts and stops it
// and the keyboard's stream lives in this process. The keyboard and the emulator come from LabDeps, so tests run on a fake keyboard.
import {
  EmulateFailedError, LabCaptureError, LabStartError, NotFoundError, UsageError, analyseSession, beginRecording, cannotRecord, deleteSession, endRecording, getLayout, incompleteRecording, labPassages, labReadout, labSessions,
  type App, type LabDeps, type RecordingInProgress,
} from "../app/index.ts";
import { LabError, type LabBackend } from "../server/lab-backend.ts";

async function translate<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LabCaptureError) throw new LabError(409, err.code, err.message);
    if (err instanceof NotFoundError) throw new LabError(404, "not_found", err.message);
    // Before UsageError, which it extends: the code puts Sync now beside the problem (R1-19).
    if (err instanceof LabStartError) throw new LabError(400, err.code, err.message);
    if (err instanceof UsageError) throw new LabError(400, "usage", err.message);
    // A replay that stopped at Docker gets the Docker callout; any other gets its own code, never "internal error" (R6-02). The
    // emulator's message can name checkout and lock directories, and its last output lines are the firmware's key log, which is the
    // recording; the lab API never carries the raw trace (src/api/lab.ts). So the page gets keyloom's words and the server's log the rest.
    if (err instanceof EmulateFailedError) {
      console.error(`keyloom: typing lab replay failed: ${err.message}`);
      if (err.code === "docker_unavailable") throw new LabError(503, "docker_unavailable", "Docker isn't ready, so the recording couldn't be played back.");
      throw new LabError(500, "replay_failed", "The firmware replay stopped with an error. The details are in keyloom's log.");
    }
    throw err;
  }
}

const sessionView = (s: ReturnType<typeof labSessions>[number]) => ({
  id: s.id, layoutId: s.layoutId, passageId: s.passageId, startedAt: s.startedAt, endedAt: s.endedAt, eventCount: s.eventCount, analysed: s.analysed, warnings: s.warnings,
  incomplete: incompleteRecording(s.warnings),
});

export function appLabBackend(app: App, deps: LabDeps): LabBackend {
  // One keyboard, one recording: a second start while one runs is refused, never stacked.
  let recording: RecordingInProgress | null = null;
  const starting = new Set<Promise<unknown>>();
  const stopping = new Set<Promise<unknown>>();
  let cancellation: Promise<void> | undefined;
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
        // Its own code, apart from a keyboard another app holds (`busy`): the lab offers Stop and discard that recording for this one (R6-20).
        if (cancellation !== undefined || recording !== null || starting.size > 0) throw new LabError(409, "recording_running", "A recording is already running. Stop it first.");
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
        // Another tab's Stop or Cancel, or a closed lab, ended it first. Its own code, so the page says the passage was lost (R7-07).
        if (rec === null) throw new LabError(409, "not_recording", "No recording is running. Another tab may have stopped it.");
        recording = null;
        const { session } = await endRecording(app, rec, typedText);
        return sessionView(session);
      });
      stopping.add(operation);
      void operation.then(() => { stopping.delete(operation); }, () => { stopping.delete(operation); });
      return operation;
    },
    cancel: async () => {
      if (cancellation === undefined) {
        const operation = (async () => {
          // Do not close the helper or database while a start or stop still owns them.
          while (starting.size > 0 || stopping.size > 0) {
            await Promise.allSettled([...starting, ...stopping]);
          }
          const rec = recording;
          recording = null;
          // The keyboard is asked to stop; what it heard is dropped.
          await rec?.capture.finish().catch(() => {});
        })();
        cancellation = operation;
        void operation.then(() => {
          if (cancellation === operation) cancellation = undefined;
        }, () => {
          if (cancellation === operation) cancellation = undefined;
        });
      }
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
