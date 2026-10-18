import type { ObservedChatEvent, ChatProviderChoice, ChatProviderStatus, ChatRequest, ConversationDetail, ConversationSummary } from "../api/http.ts";

// The server's chat interface (rung 3). Like EditorBackend, the CLI injects the app-backed
// implementation, so the server knows nothing about the model, the SDK or the database.
export interface ChatBackend {
  /**
   * Runs one agent turn, calling `emit` as it goes. The first event is `start`, once the message is
   * validated and stored; a failure before that rejects with a ChatError, and one after it rejects
   * and is reported to the browser as an `error` event. `signal` aborts when the browser goes away.
   */
  send(ref: string, request: ChatRequest, emit: (event: ObservedChatEvent) => void, signal: AbortSignal): Promise<void>;
  /** Which provider the next new conversation uses, and what each still needs. */
  provider(): Promise<ChatProviderStatus>;
  /** Saves the provider and model the next new conversation starts on; a conversation already going keeps its own (D-111). */
  chooseProvider(choice: ChatProviderChoice): Promise<ChatProviderStatus>;
  list(ref: string): Promise<ConversationSummary[] | null>;
  get(id: string): Promise<ConversationDetail | null>;
  /** Retires a priority from its chip; false when there is no such priority. */
  retirePriority(id: string): Promise<boolean>;
}

/** A failure the browser should see as-is: the status and code go into ApiErrorBody (or an `error` event). */
export class ChatError extends Error {
  constructor(
    readonly status: 400 | 402 | 404 | 409 | 429 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ChatError";
  }
}
