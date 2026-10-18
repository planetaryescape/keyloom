// The browser side of the chat routes (src/api/http.ts, "Chat"). Same token and error handling as
// the editor's writes; the reply is read as a stream of frames.
import {
  ChatProviderStatusSchema,
  ConversationDetailSchema,
  ConversationListResponseSchema,
  type ChatEvent,
  type ObservedChatEvent,
  type ChatProviderChoice,
  type ChatProviderStatus,
  type ChatRequest,
  type ConversationDetail,
  type ConversationSummary,
} from "../../api/http.ts";
import { ApiError } from "../api.ts";
import { failure, request } from "../api-write.ts";
import { createObservedSseParser, createSseParser, SseError } from "./sse.ts";

export function fetchProviderStatus(token: string, signal: AbortSignal): Promise<ChatProviderStatus> {
  return request("GET", "/api/chat/provider", token, ChatProviderStatusSchema, signal);
}

export function chooseProvider(token: string, choice: ChatProviderChoice): Promise<ChatProviderStatus> {
  return request("POST", "/api/chat/provider", token, ChatProviderStatusSchema, undefined, choice);
}

export async function fetchConversations(token: string, ref: string, signal: AbortSignal): Promise<ConversationSummary[]> {
  const body = await request("GET", `/api/layouts/${encodeURIComponent(ref)}/conversations`, token, ConversationListResponseSchema, signal);
  return body.conversations;
}

export function fetchConversation(token: string, id: string, signal: AbortSignal): Promise<ConversationDetail> {
  return request("GET", `/api/conversations/${encodeURIComponent(id)}`, token, ConversationDetailSchema, signal);
}

/**
 * Sends one message and calls `onEvent` for each frame until the stream ends. Rejects with an
 * ApiError for a refusal before the stream opens (busy, missing key, ...) and for a stream that ends
 * without `done` or `error`; an abort rejects with the AbortError so the caller can tell a stop.
 */
export async function streamChat(
  token: string,
  ref: string,
  body: ChatRequest,
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  return stream(token, ref, body, signal, onEvent, createSseParser);
}

/** Opt in without retrying the POST. An older server can still send only legacy events. */
export async function streamObservedChat(
  token: string,
  ref: string,
  body: ChatRequest,
  signal: AbortSignal,
  onEvent: (event: ObservedChatEvent) => void,
): Promise<void> {
  return stream(token, ref, { ...body, presentationVersion: 1 }, signal, onEvent, createObservedSseParser);
}

async function stream<Event extends { type: string }>(
  token: string,
  ref: string,
  body: ChatRequest,
  signal: AbortSignal,
  onEvent: (event: Event) => void,
  createParser: (onEvent: (event: Event) => void) => { push: (chunk: string) => void; end: () => void },
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/layouts/${encodeURIComponent(ref)}/chat`, {
      method: "POST",
      headers: { "x-keyloom-token": token, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(0, "Can't reach keyloom. Is it still running in your terminal?");
  }
  if (!response.ok) throw await failure(response);
  if (response.body === null) throw new ApiError(response.status, "keyloom sent no reply.");

  let finished = false;
  const parser = createParser((event) => {
    if (event.type === "done" || event.type === "error") finished = true;
    onEvent(event);
  });
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (signal.aborted) throw error;
    if (error instanceof SseError) throw new ApiError(response.status, error.message);
    throw new ApiError(0, "The connection to keyloom dropped before the reply finished.");
  } finally {
    reader.releaseLock();
  }
  if (!finished) throw new ApiError(0, "The connection to keyloom dropped before the reply finished.");
}

/** Forgets a priority. The server retires it, so the record of what BK once said survives (08). */
export async function forgetPriority(token: string, id: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/priorities/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-keyloom-token": token } });
  } catch {
    throw new ApiError(0, "Can't reach keyloom. Is it still running in your terminal?");
  }
  if (!response.ok) throw await failure(response);
}
