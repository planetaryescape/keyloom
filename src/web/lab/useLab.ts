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
  const [typed, setTyped] = useState("");
  const listening = useRef(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setProblem(null);
    void api.fetchPassages(token, layoutRef, controller.signal).then((r) => {
      setPassages(r.passages);
      setCanRecord({ ok: r.canRecord, why: r.why });
    }, () => {});
    void api.fetchSessions(token, layoutRef, controller.signal).then(setSessions, () => {});
    return () => controller.abort();
  }, [token, layoutRef, open]);

  // Closing the lab while it listens stops the keyboard's stream; nothing heard is kept.
  useEffect(() => {
    if (open || !listening.current) return;
    listening.current = false;
    void api.cancelRecording(token).catch(() => {});
    setPhase({ kind: "start" });
  }, [open, token]);

  const say = (error: unknown) => setProblem(error instanceof ApiError || error instanceof Error ? error.message : "That didn't work.");

  const start = useCallback(async (choice: { passageId?: string; text?: string }) => {
    setProblem(null);
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
    try {
      const r = run ? await api.analyse(token, id) : await api.fetchReadout(token, id);
      const readout = r.readout ?? (await api.analyse(token, id)).readout;
      if (readout === null) throw new Error("This recording has no read-out yet.");
      setPhase({ kind: "readout", session: r.session, readout, open: null, trying: null });
    } catch (error) {
      say(error);
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

  const cancel = useCallback(async () => {
    listening.current = false;
    await api.cancelRecording(token).catch(() => {});
    setPhase({ kind: "start" });
  }, [token]);

  const remove = useCallback(async (id: string) => {
    await api.deleteSession(token, id).catch(say);
    setSessions((list) => list.filter((s) => s.id !== id));
    setPhase({ kind: "start" });
  }, [token]);

  const openFinding = (id: string | null) => setPhase((p) => (p.kind === "readout" ? { ...p, open: id, trying: null } : p));
  const tryFix = (index: number | null) => setPhase((p) => (p.kind === "readout" ? { ...p, trying: index } : p));

  return { phase, passages, canRecord, sessions, problem, typed, setTyped, start, stop, cancel, showSession, remove, openFinding, tryFix, again: () => setPhase({ kind: "start" }) };
}

export type Lab = ReturnType<typeof useLab>;
