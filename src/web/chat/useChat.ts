import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ChatRequest, ChatSelection, ConversationSummary } from "../../api/http.ts";

export type ChatDrafts = NonNullable<ChatRequest["drafts"]>;
import { ApiError } from "../api.ts";
import { fetchConversation, fetchConversations, forgetPriority, streamObservedChat } from "./api-chat.ts";
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

export function useChat(token: string, layoutRef: string) {
  const [transcript, dispatch] = useReducer(transcriptReducer, EMPTY);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [history, setHistory] = useState<History>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  const counter = useRef(0);
  // Read when a message goes out; the reducer's copy is a render behind inside an event handler.
  const conversationId = useRef<string | null>(null);
  conversationId.current = transcript.conversationId;
  const streaming = isStreaming(transcript);

  useEffect(() => () => controller.current?.abort(), []);

  const nextId = (prefix: string) => `${prefix}-${++counter.current}`;

  const run = useCallback(
    async (text: string, selection: ChatSelection | null, begin: Action, onRejected?: (text: string) => void, drafts: ChatDrafts = [], answer?: { toolUseId: string }) => {
      setProblem(null);
      dispatch(begin);
      const mine = new AbortController();
      controller.current = mine;
      let started = false;
      try {
        await streamObservedChat(
          token,
          layoutRef,
          { ...(answer === undefined ? { message: text } : { answer: { toolUseId: answer.toolUseId, text } }), ...(conversationId.current === null ? {} : { conversationId: conversationId.current }), ...(selection === null ? {} : { selection }), ...(drafts.length === 0 ? {} : { drafts }) },
          mine.signal,
          (event) => {
            if (controller.current !== mine || mine.signal.aborted) return;
            if (event.type === "start") started = true;
            dispatch({ type: "event", event });
          },
        );
      } catch (error) {
        if (controller.current !== mine) return; // replaced by a new conversation; nothing to report
        // Only an explicit HTTP refusal proves execution never started. Lost observation is not
        // permission to restore/resend a request that the server may already have accepted.
        const refused = !started && error instanceof ApiError && error.status >= 400;
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
        if (controller.current === mine) controller.current = null;
      }
    },
    [token, layoutRef],
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
    const user = lastUser(transcript);
    if (user === undefined || streaming) return Promise.resolve();
    return run(user.text, user.selection, { type: "retry", assistantId: nextId("reply") });
  }, [transcript, streaming, run]);

  const stop = useCallback(() => {
    if (controller.current === null) return;
    controller.current.abort();
    dispatch({ type: "stopped" });
  }, []);

  const newConversation = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setProblem(null);
    dispatch({ type: "reset" });
  }, []);

  const loadHistory = useCallback(async () => {
    setHistory({ status: "loading" });
    try {
      setHistory({ status: "ready", items: await fetchConversations(token, layoutRef, new AbortController().signal) });
    } catch (error) {
      setHistory({ status: "error", message: error instanceof Error ? error.message : "Couldn't load your conversations." });
    }
  }, [token, layoutRef]);

  /** Resolves to an error message, or null once the conversation is showing. */
  const open = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        const detail = await fetchConversation(token, id, new AbortController().signal);
        controller.current?.abort();
        controller.current = null;
        setProblem(null);
        dispatch({ type: "loaded", detail });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : "Couldn't open that conversation.";
      }
    },
    [token],
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

  return { transcript, streaming, problem, dismissProblem: () => setProblem(null), history, loadHistory, send, answer, retry, stop, newConversation, open, markApplied, removePriority };
}
