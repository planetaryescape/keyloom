import { useCallback, useEffect, useRef, useState } from "react";
import type { LabPassage, LabReadout, LabSession } from "../../api/lab.ts";
import { ApiError } from "../api.ts";
import * as api from "./api-lab.ts";

// The typing lab's moments (24#key-moments, D-314): choosing a passage, listening while BK types, reading the recording back, and the
// read-out, with one finding open or one fix being tried. One recording at a time; closing while listening cancels it, saving nothing.
export type LabPhase =
  | { kind: "start" }
  | { kind: "listening"; passage: LabPassage; startedAt: number }
  | { kind: "reading" }
  | { kind: "readout"; session: LabSession; readout: LabReadout; open: string | null; trying: number | null };

export function useLab(token: string, layoutRef: string, open: boolean) {
  const [phase, setPhase] = useState<LabPhase>({ kind: "start" });
  const [passages, setPassages] = useState<LabPassage[]>([]);
  const [canRecord, setCanRecord] = useState<{ ok: boolean; why: string | null }>({ ok: true, why: null });
  const [sessions, setSessions] = useState<LabSession[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  // The server's code for the problem, which puts its fix beside it (R1-19), and whether the lab's own lists failed to load.
  const [problemCode, setProblemCode] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loads, setLoads] = useState(0);
  // The saved session whose read-out failed, so Read it again reads that one (R6-02).
  const [failedRead, setFailedRead] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const listening = useRef(false);
  const cancelling = useRef(false);
  // What was last asked for, so Try again after a refusal (an Input Monitoring prompt, a busy keyboard) starts the same passage.
  const lastChoice = useRef<{ passageId?: string; text?: string }>({});

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setProblem(null);
    setProblemCode(null);
    setLoadFailed(false);
    // A failed read says so with Try again, instead of a lab with nothing to choose (R1-28).
    const failed = (error: unknown) => {
      if (controller.signal.aborted) return;
      setLoadFailed(true);
      // The code picks the button: Restart keyloom for an answer that fails the same way again (R7-01), Try again otherwise.
      setProblemCode(error instanceof ApiError ? (error.code ?? null) : null);
      setProblem(error instanceof Error ? `keyloom couldn't load the typing lab. ${error.message}` : "keyloom couldn't load the typing lab.");
    };
    void api.fetchPassages(token, layoutRef, controller.signal).then((r) => {
      setPassages(r.passages);
      setCanRecord({ ok: r.canRecord, why: r.why });
    }, failed);
    void api.fetchSessions(token, layoutRef, controller.signal).then(setSessions, failed);
    return () => controller.abort();
  }, [token, layoutRef, open, loads]);

  // Closing the lab while it listens stops the keyboard's stream; nothing heard is kept.
  useEffect(() => {
    if (open || !listening.current) return;
    listening.current = false;
    void api.cancelRecording(token).catch(() => {});
    setPhase({ kind: "start" });
  }, [open, token]);

  const say = (error: unknown) => {
    setFailedRead(null);
    setProblem(error instanceof ApiError || error instanceof Error ? error.message : "That didn't work.");
    setProblemCode(error instanceof ApiError ? (error.code ?? null) : null);
  };

  const start = useCallback(async (choice: { passageId?: string; text?: string }) => {
    lastChoice.current = choice;
    setProblem(null);
    setProblemCode(null);
    setFailedRead(null);
    try {
      const r = await api.startRecording(token, layoutRef, choice);
      listening.current = true;
      setTyped("");
      setPhase({ kind: "listening", passage: r.recording.passage, startedAt: r.recording.startedAt });
    } catch (error) {
      say(error);
    }
  }, [token, layoutRef]);

  const showSession = useCallback(async (id: string, run: boolean) => {
    setPhase({ kind: "reading" });
    setProblem(null);
    setProblemCode(null);
    setFailedRead(null);
    try {
      const r = run ? await api.analyse(token, id) : await api.fetchReadout(token, id);
      const readout = r.readout ?? (await api.analyse(token, id)).readout;
      if (readout === null) throw new Error("This recording has no read-out yet.");
      setPhase({ kind: "readout", session: r.session, readout, open: null, trying: null });
    } catch (error) {
      say(error);
      setFailedRead(id);
      setPhase({ kind: "start" });
    } finally {
      // An incomplete capture is saved even when analysis is refused.
      void api.fetchSessions(token, layoutRef).then(setSessions, () => {});
    }
  }, [token, layoutRef]);

  const stop = useCallback(async () => {
    if (phase.kind !== "listening") return;
    listening.current = false;
    setPhase({ kind: "reading" });
    try {
      const session = await api.stopRecording(token, typed);
      await showSession(session.id, true);
    } catch (error) {
      say(error);
      setPhase({ kind: "start" });
    }
  }, [phase, token, typed, showSession]);

  // Also Stop and discard that recording, after a Cancel that failed or a start refused because one is running. A failed stop says so
  // with that button, instead of a start screen that would only be refused (R6-20).
  const cancel = useCallback(async () => {
    // Held Escape repeats; a second cancel landing after a new start would hide that recording.
    if (cancelling.current) return;
    cancelling.current = true;
    listening.current = false;
    try {
      await api.cancelRecording(token);
      setProblem(null);
      setProblemCode(null);
    } catch (error) {
      setFailedRead(null);
      setProblem(error instanceof Error ? error.message : "The server didn't answer.");
      setProblemCode("cancel_failed");
    } finally {
      cancelling.current = false;
    }
    setPhase({ kind: "start" });
  }, [token]);

  // A session leaves the list only once the server has deleted it; a failed delete keeps the row and says why (R3-23).
  const remove = useCallback(async (id: string) => {
    try {
      await api.deleteSession(token, id);
    } catch (error) {
      say(error);
      return;
    }
    setSessions((list) => list.filter((s) => s.id !== id));
    setPhase({ kind: "start" });
  }, [token]);

  const openFinding = (id: string | null) => setPhase((p) => (p.kind === "readout" ? { ...p, open: id, trying: null } : p));
  const tryFix = (index: number | null) => setPhase((p) => (p.kind === "readout" ? { ...p, trying: index } : p));

  return {
    token, phase, passages, canRecord, sessions, problem, problemCode, loadFailed, reload: () => setLoads((n) => n + 1), typed, setTyped, start, retry: () => start(lastChoice.current),
    stop, cancel, showSession, remove, openFinding, tryFix, again: () => setPhase({ kind: "start" }),
    readAgain: failedRead === null ? null : () => void showSession(failedRead, true),
  };
}

export type Lab = ReturnType<typeof useLab>;
