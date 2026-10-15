// The server's chat interface over the app's conversation use cases (rung 3). The one place that
// knows both the server's wire shapes and the app's errors.
import {
  type AgentModel, type App, BusyError, ModelError, NotFoundError, type ProviderId, UsageError, providerStatus, listConversationSummaries, retirePriority, sendMessage, showConversation,
} from "../app/index.ts";
import { type ChatBackend, ChatError } from "../server/chat-backend.ts";

const MODEL_STATUS: Record<string, 402 | 429 | 502 | 503> = { missing_key: 503, rate_limit: 429, connection: 502, overloaded: 503, no_credits: 402 };

/** Turns the app's typed errors into the status and code the browser acts on; anything else stays a 500. */
export function toChatError(err: unknown): unknown {
  if (err instanceof NotFoundError) return new ChatError(404, "not_found", err.message);
  if (err instanceof BusyError) return new ChatError(409, "busy", err.message);
  if (err instanceof UsageError) return new ChatError(400, "usage", err.message);
  if (err instanceof ModelError) return new ChatError(MODEL_STATUS[err.kind] ?? 502, err.kind === "missing_key" ? "missing_api_key" : `model_${err.kind}`, err.message);
  return err;
}

/** `model` is for tests; in use it is omitted and the app picks the provider on each message (19). */
export function appChatBackend(app: App, opts: { model?: AgentModel; provider?: ProviderId } = {}): ChatBackend {
  return {
    async send(ref, request, emit, signal) {
      try {
        await sendMessage(app, ref, {
          message: request.message,
          ...(request.conversationId ? { conversationId: request.conversationId } : {}),
          ...(request.selection ? { selection: { layer: request.selection.layerId, positions: request.selection.positions } } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.provider ? { provider: opts.provider } : {}),
          signal,
          onEvent: emit,
        });
      } catch (err) {
        throw toChatError(err);
      }
    },
    async provider() {
      return providerStatus(app.dataDir, opts.provider ? { provider: opts.provider } : {});
    },
    async list(ref) {
      try {
        return listConversationSummaries(app, ref).map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt }));
      } catch (err) {
        if (err instanceof NotFoundError) return null;
        throw err;
      }
    },
    async get(id) {
      try {
        const v = showConversation(app, id);
        return {
          conversation: { id: v.conversation.id, layoutId: v.conversation.layoutId, title: v.conversation.title, createdAt: v.conversation.createdAt },
          messages: v.messages,
          proposals: v.proposals,
          priorities: v.priorities,
        };
      } catch (err) {
        if (err instanceof NotFoundError) return null;
        throw err;
      }
    },
    async retirePriority(id) {
      try {
        retirePriority(app, id);
        return true;
      } catch (err) {
        if (err instanceof NotFoundError) return false;
        throw toChatError(err);
      }
    },
  };
}
