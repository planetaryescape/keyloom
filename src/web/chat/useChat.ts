import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { ChatPresentation, ChatRequest, ChatSelection, ConversationSummary } from "../../api/http.ts";
import type { AgentView, ViewResult } from "../../api/open-view.ts";
import type { AgentRunSnapshot } from "../../api/agent-runs.ts";
import { acknowledgeView } from "./api-chat.ts";

export type OpenRequestedView = (view: AgentView, signal: AbortSignal) => Promise<ViewResult>;

export type ChatDrafts = NonNullable<ChatRequest["drafts"]>;
import { ApiError } from "../api.ts";
import { cancelSavedRequest, cancelSavedRun, fetchConversation, fetchConversations, forgetPriority, latestSavedRun, observeSavedRun, startSavedChat, streamObservedChat } from "./api-chat.ts";
import { EMPTY, isStreaming, lastUser, transcriptReducer, type Action } from "./transcript.ts";

/** A refusal before the reply started, or a history/provider request problem. */
export type Problem = { kind: "missing_key" | "busy" | "rate_limit" | "unreachable" | "other"; message: string };

export type History =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: ConversationSummary[] }
  | { status: "error"; message: string };

function classify(error: unknown): Problem {
  if (error instanceof ApiError) {
    if (error.code === "missing_api_key") return { kind: "missing_key", message: error.message };
    if (error.status === 409) return { kind: "busy", message: error.message };
    if (error.status === 429) return { kind: "rate_limit", message: error.message };
    if (error.status === 0) return { kind: "unreachable", message: error.message };
    return { kind: "other", message: error.message };
  }
  return { kind: "other", message: error instanceof Error ? error.message : "Something went wrong sending that." };
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

/**
 * `liveCompleted` is set when a reply this mount sent has been watched finishing, and for no other: a run found again after a reload,
 * a conversation opened from history and a thread carried in from another config never set it. That is what lets the shell act on a
 * finished reply (open a config it made) without acting again on every replay. It is state, so whoever reads it sees the transcript
 * as rendered with the finished reply in it.
 */
export function useChat(token: string, layoutRef: string, onContinueCopy?: (handoff: NonNullable<ChatPresentation["handoff"]>) => void, initialConversation?: string, beginOpenView?: () => OpenRequestedView) {
  const [liveCompleted, setLiveCompleted] = useState<{ presentation: ChatPresentation; id: number } | null>(null);
  const [transcript, dispatch] = useReducer(transcriptReducer, EMPTY);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [history, setHistory] = useState<History>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const beginView = useRef(beginOpenView);
  useLayoutEffect(() => { beginView.current = beginOpenView; }, [beginOpenView]);
  const viewLife = useRef<AbortController | null>(null);
  const savedRun = useRef<string | null>(null);
  const handoff = useRef<ChatPresentation["handoff"]>(undefined);
  const pendingAcceptance = useRef<{ id: string; stopped: boolean; controller: AbortController } | null>(null);
  const storageKey = `keyloom.agent.current.${layoutRef}`;
  // Read when a message goes out; the reducer's copy is a render behind inside an event handler.
  const conversationId = useRef<string | null>(null);
  conversationId.current = transcript.conversationId;
  const streaming = isStreaming(transcript);

  useEffect(() => () => { viewLife.current?.abort(); controller.current?.abort(); }, [layoutRef]);

  const observe = useCallback(async (id: string, mine: AbortController, finished?: (presentation: ChatPresentation | null) => void, handleView?: (snapshot: AgentRunSnapshot) => void) => {
    let completed: ChatPresentation | null = null;
    await observeSavedRun(token, id, mine.signal, (snapshot, detail) => {
      if (controller.current !== mine || mine.signal.aborted) return;
      handleView?.(snapshot);
      savedRun.current = snapshot.id;
      handoff.current = snapshot.handoff;
      conversationId.current = snapshot.conversationId;
      completed = snapshot.status === "completed" ? snapshot.presentation : null;
      dispatch({ type: "saved", snapshot, detail });
    });
    // Only a run that ended while this request was still the one on screen counts as finished here.
    if (finished !== undefined && controller.current === mine && !mine.signal.aborted) finished(completed);
  }, [token]);

  useEffect(() => {
    if (initialConversation !== undefined) return;
    const id = localStorage.getItem(storageKey);
    if (!id) return;
    const mine = new AbortController();
    controller.current = mine;
    void observe(id, mine).catch((error: unknown) => {
      if (!mine.signal.aborted) setProblem(classify(error));
    }).finally(() => { if (controller.current === mine) controller.current = null; });
    return () => mine.abort();
  }, [storageKey, observe, initialConversation]);

  const nextId = (prefix: string) => `${prefix}-${++counter.current}`;

  const run = useCallback(
    async (text: string, selection: ChatSelection | null, begin: Action, onRejected?: (text: string) => void, drafts: ChatDrafts = [], answer?: { toolUseId: string }) => {
      handoff.current = undefined;
      setProblem(null);
      dispatch(begin);
      const mine = new AbortController();
      viewLife.current?.abort();
      const life = new AbortController();
      viewLife.current = life;
      const loseForeground = () => life.abort();
      window.addEventListener("blur", loseForeground, { once: true });
      document.addEventListener("visibilitychange", loseForeground, { once: true });
      const openView = beginView.current?.();
      const owner = crypto.randomUUID();
      const seen = new Set<string>();
      controller.current = mine;
      let started = false;
      let streamed: ChatPresentation | null = null;
      const announce = (presentation: ChatPresentation | null) => {
        if (presentation?.status === "completed") setLiveCompleted({ presentation, id: ++counter.current });
      };
      try {
        const body = { ...(answer === undefined ? { message: text } : { answer: { toolUseId: answer.toolUseId, text } }), ...(conversationId.current === null ? {} : { conversationId: conversationId.current }), ...(selection === null ? {} : { selection }), ...(drafts.length === 0 ? {} : { drafts }) };
        const requestId = crypto.randomUUID();
        // Save only an opaque identity, never text, tokens or tool data. An ambiguous POST can be
        // recovered with GET by this identity after reload, not with another mutating request.
        localStorage.setItem(storageKey, requestId);
        savedRun.current = requestId;
        const pending = { id: requestId, stopped: false, controller: mine };
        pendingAcceptance.current = pending;
        const accepted = await startSavedChat(token, layoutRef, requestId, body, mine.signal, openView === undefined ? undefined : { version: 1, owner });
        if (pendingAcceptance.current === pending) pendingAcceptance.current = null;
        if (accepted !== null) {
          started = true;
          savedRun.current = accepted.id;
          localStorage.setItem(storageKey, accepted.id);
          await observe(accepted.id, mine, announce, (snapshot) => {
            if (accepted.viewProtocol !== 1 || snapshot.viewProtocol !== 1 || !openView || snapshot.id !== accepted.id || snapshot.requestId !== requestId || snapshot.status !== "running" || snapshot.cancelRequested) return;
            for (const intent of snapshot.presentation?.viewIntents ?? []) {
              if (intent.status !== "pending" || intent.runId !== accepted.id || intent.requestId !== requestId || intent.configId !== layoutRef || seen.has(intent.id)) continue;
              seen.add(intent.id);
              void (async () => {
                const pendingView = new AbortController();
                const abort = () => pendingView.abort();
                life.signal.addEventListener("abort", abort, { once: true });
                const timeout = setTimeout(abort, Math.max(0, intent.expiresAt - Date.now()));
                let result: ViewResult;
                try {
                  if (controller.current !== mine || mine.signal.aborted || life.signal.aborted) result = { version: 1, status: "unavailable", reason: "cancelled" };
                  else if (Date.now() >= intent.expiresAt) result = { version: 1, status: "unavailable", reason: "timeout" };
                  else if (document.visibilityState !== "visible" || !document.hasFocus()) result = { version: 1, status: "unavailable", reason: "background" };
                  else result = await openView(intent.view, pendingView.signal);
                  // Never upgrade a rendered result after this send lost ownership or its deadline.
                  if (life.signal.aborted || controller.current !== mine) result = { version: 1, status: "unavailable", reason: "cancelled" };
                  else if (Date.now() >= intent.expiresAt) result = { version: 1, status: "unavailable", reason: "timeout" };
                  await acknowledgeView(token, accepted.id, { version: 1, owner, configId: layoutRef, intentId: intent.id, result }, pendingView.signal);
                } finally {
                  clearTimeout(timeout);
                  life.signal.removeEventListener("abort", abort);
                }
              })().catch(() => { life.abort(); }); // Lost ack is not success or permission to replay.
            }
          });
          return;
        }
        localStorage.removeItem(storageKey);
        savedRun.current = null;
        if (pending.stopped) { dispatch({ type: "stopped" }); return; }
        await streamObservedChat(
          token,
          layoutRef,
          { ...(answer === undefined ? { message: text } : { answer: { toolUseId: answer.toolUseId, text } }), ...(conversationId.current === null ? {} : { conversationId: conversationId.current }), ...(selection === null ? {} : { selection }), ...(drafts.length === 0 ? {} : { drafts }) },
          mine.signal,
          (event) => {
            if (controller.current !== mine || mine.signal.aborted) return;
            if (event.type === "start") started = true;
            if (event.type === "presentation") streamed = event.presentation;
            dispatch({ type: "event", event });
          },
        );
        if (controller.current === mine && !mine.signal.aborted) announce(streamed);
      } catch (error) {
        if (controller.current !== mine) return; // replaced by a new conversation; nothing to report
        // Only an explicit HTTP refusal proves execution never started. Lost observation is not
        // permission to restore/resend a request that the server may already have accepted.
        const refused = !started && error instanceof ApiError && ((error.status >= 400 && error.status < 500) || error.code === "missing_api_key");
        if (refused) localStorage.removeItem(storageKey);
        if (refused && begin.type === "retry") {
          // The user turn before it is already on screen and stored, so a refused retry fails in place.
          dispatch(isAbort(error) ? { type: "stopped" } : { type: "failed", code: "retry", message: classify(error).message });
        } else if (refused && answer !== undefined) {
          // The question is still open on the server, so it opens again here for another try.
          dispatch({ type: "answerRejected", toolUseId: answer.toolUseId });
          if (!isAbort(error)) setProblem(classify(error));
        } else if (refused) {
          // The reply never opened, so the turn leaves no trace; the message goes back to the composer.
          dispatch({ type: "rolledBack" });
          if (!isAbort(error)) {
            setProblem(classify(error));
            onRejected?.(text);
          }
        } else if (isAbort(error)) {
          dispatch({ type: "stopped" });
        } else {
          const message = error instanceof Error ? error.message : "The reply stopped.";
          dispatch({ type: "failed", code: error instanceof ApiError ? (error.code ?? "stream") : "stream", message: started ? message : `${message} The request may have been accepted. Read conversation history before sending it again.` });
        }
      } finally {
        window.removeEventListener("blur", loseForeground);
        document.removeEventListener("visibilitychange", loseForeground);
        life.abort();
        if (pendingAcceptance.current?.controller === mine) pendingAcceptance.current = null;
        if (controller.current === mine) controller.current = null;
      }
    },
    [token, layoutRef, storageKey, observe],
  );

  const send = useCallback(
    // `drafts` are key changes kept on the board and not applied, which the agent is told of (D-317).
    (text: string, selection: ChatSelection | null, onRejected?: (text: string) => void, drafts: ChatDrafts = []) =>
      run(text, selection, { type: "sent", userId: nextId("you"), assistantId: nextId("reply"), text, selection }, onRejected, drafts),
    [run],
  );

  /** Answers the question the agent is waiting on; the reply continues from it. */
  const answer = useCallback(
    (toolUseId: string, text: string) => run(text, null, { type: "answering", toolUseId, text, assistantId: nextId("reply") }, undefined, [], { toolUseId }),
    [run],
  );

  /** Asks again for the reply that failed, in the same conversation. */
  const retry = useCallback(() => {
    if (handoff.current !== undefined && onContinueCopy !== undefined) { onContinueCopy(handoff.current); return Promise.resolve(); }
    const user = lastUser(transcript);
    if (user === undefined || streaming) return Promise.resolve();
    return run(user.text, user.selection, { type: "retry", assistantId: nextId("reply") });
  }, [transcript, streaming, run, onContinueCopy]);

  const stop = useCallback(() => {
    viewLife.current?.abort();
    if (controller.current === null) return;
    if (pendingAcceptance.current !== null) {
      const pending = pendingAcceptance.current;
      pending.stopped = true;
      void cancelSavedRequest(token, pending.id).catch((error: unknown) => setProblem(classify(error)));
      return;
    }
    if (savedRun.current !== null) {
      void cancelSavedRun(token, savedRun.current).catch((error: unknown) => setProblem(classify(error)));
      return;
    }
    controller.current.abort();
    dispatch({ type: "stopped" });
  }, [token]);

  const newConversation = useCallback(() => {
    viewLife.current?.abort();
    handoff.current = undefined;
    controller.current?.abort();
    controller.current = null;
    savedRun.current = null;
    pendingAcceptance.current = null;
    localStorage.removeItem(storageKey);
    conversationId.current = null;
    setProblem(null);
    dispatch({ type: "reset" });
  }, [storageKey]);

  const loadHistory = useCallback(async () => {
    setHistory({ status: "loading" });
    try {
      setHistory({ status: "ready", items: await fetchConversations(token, layoutRef, new AbortController().signal) });
    } catch (error) {
      setHistory({ status: "error", message: error instanceof Error ? error.message : "Couldn't load your conversations." });
    }
  }, [token, layoutRef]);

  /** Resolves to null once showing, an error message on failure, or undefined if canceled or replaced. */
  const open = useCallback(
    async (id: string): Promise<string | null | undefined> => {
      viewLife.current?.abort();
      handoff.current = undefined;
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      try {
        const detail = await fetchConversation(token, id, mine.signal);
        if (controller.current !== mine || mine.signal.aborted) return undefined;
        setProblem(null);
        dispatch({ type: "loaded", detail });
        conversationId.current = id;
        const saved = await latestSavedRun(token, id, mine.signal);
        if (controller.current !== mine || mine.signal.aborted) return undefined;
        if (saved !== null) {
          savedRun.current = saved.id;
          localStorage.setItem(storageKey, saved.id);
          void observe(saved.id, mine).catch((error: unknown) => { if (!mine.signal.aborted) setProblem(classify(error)); })
            .finally(() => { if (controller.current === mine) controller.current = null; });
        } else { savedRun.current = null; controller.current = null; localStorage.removeItem(storageKey); }
        return null;
      } catch (error) {
        if (controller.current !== mine || mine.signal.aborted) return undefined;
        controller.current = null;
        return error instanceof Error ? error.message : "Couldn't open that conversation.";
      }
    },
    [token, storageKey, observe],
  );

  const markApplied = useCallback((changeSetId: string) => dispatch({ type: "applied", changeSetId }), []);

  /** Rejects with the server's message, so the chip can say why it is still there. */
  const removePriority = useCallback(
    async (id: string) => {
      await forgetPriority(token, id);
      dispatch({ type: "priorityRemoved", id });
    },
    [token],
  );

  return { transcript, streaming, liveCompleted, problem, dismissProblem: () => setProblem(null), history, loadHistory, send, answer, retry, stop, newConversation, open, markApplied, removePriority };
}
