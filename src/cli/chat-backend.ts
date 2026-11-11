// The server's chat interface over the app's conversation use cases (rung 3). The one place that
// knows both the server's wire shapes and the app's errors.
import {
  type AgentModel, type App, BusyError, CredentialError, ModelError, type SaveKeyOptions, cancelCodexSignIn, forgetProviderKey, saveProviderKey, startCodexSignIn, NotFoundError, type ProviderId, UsageError, chooseNextProvider, providerStatus, listConversationSummaries, retirePriority, sendMessage, showConversation,
} from "../app/index.ts";
import { type ChatBackend, ChatError } from "../server/chat-backend.ts";
import { acknowledgeAgentView, answerAgentRun, cancelAgentRequest, cancelAgentRun, drainAgentRuns, inspectAgentRun, latestAgentRun, reconcileAgentRuns, startAgentRun } from "../app/agent-runs.ts";

const CREDENTIAL_STATUS: Record<CredentialError["code"], 400 | 409 | 502 | 503> = {
  key_malformed: 400, key_rejected: 400, key_from_environment: 409, key_store_unavailable: 503, key_store_failed: 502, codex_missing: 409,
};

const MODEL_STATUS: Record<string, 402 | 429 | 502 | 503> = { missing_key: 503, rate_limit: 429, connection: 502, overloaded: 503, no_credits: 402 };

/** Turns the app's typed errors into the status and code the browser acts on; anything else stays a 500. */
export function toChatError(err: unknown): unknown {
  if (err instanceof NotFoundError) return new ChatError(404, "not_found", err.message);
  if (err instanceof BusyError) return new ChatError(409, "busy", err.message);
  if (err instanceof UsageError) return new ChatError(400, "usage", err.message);
  if (err instanceof CredentialError) return new ChatError(CREDENTIAL_STATUS[err.code], err.code, err.message);
  if (err instanceof ModelError) return new ChatError(MODEL_STATUS[err.kind] ?? 502, err.kind === "missing_key" ? "missing_api_key" : `model_${err.kind}`, err.message);
  return err;
}

/** `model` and `verifyKey` are for tests; in use they are omitted and the app picks the provider on each message (19). */
export function appChatBackend(app: App, opts: { model?: AgentModel; provider?: ProviderId; verifyKey?: SaveKeyOptions["verify"] } = {}): ChatBackend {
  return {
    runs: {
      async acknowledgeView(id, ack) { try { return acknowledgeAgentView(app, id, ack); } catch (err) { throw toChatError(err); } },
      async start(request) { try { return await startAgentRun(app, request, opts); } catch (err) { throw toChatError(err); } },
      async get(id) { try { return inspectAgentRun(app, id); } catch (err) { throw toChatError(err); } },
      async latest(id) { return latestAgentRun(app, id); },
      async answer(id, requestId, answer) { try { return await answerAgentRun(app, id, requestId, answer, opts); } catch (err) { throw toChatError(err); } },
      async cancel(id) { try { return cancelAgentRun(app, id); } catch (err) { throw toChatError(err); } },
      async cancelRequest(id) { try { return cancelAgentRequest(app, id); } catch (err) { throw toChatError(err); } },
      async drain() { await drainAgentRuns(app); },
    },
    async send(ref, request, emit, signal) {
      try {
        await sendMessage(app, ref, {
          ...(request.message === undefined ? {} : { message: request.message }),
          ...(request.answer === undefined ? {} : { answer: request.answer }),
          ...(request.conversationId ? { conversationId: request.conversationId } : {}),
          ...(request.selection ? { selection: { layer: request.selection.layerId, positions: request.selection.positions } } : {}),
          ...(request.drafts && request.drafts.length > 0 ? { drafts: request.drafts } : {}),
          ...(request.presentationVersion === 1 ? { presentationVersion: 1 } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          // The serve flag picks the provider for new conversations; an older one stays where it started (D-111).
          ...(opts.provider && !request.conversationId ? { provider: opts.provider } : {}),
          signal,
          onEvent: emit,
        });
      } catch (err) {
        throw toChatError(err);
      }
    },
    async provider() {
      return await providerStatus(app.dataDir, opts.provider ? { provider: opts.provider } : {});
    },
    async chooseProvider(choice) {
      try {
        return await chooseNextProvider(app.dataDir, choice, opts.provider ? { provider: opts.provider } : {});
      } catch (err) {
        throw toChatError(err);
      }
    },
    async saveKey({ provider, key }) {
      try {
        return await saveProviderKey(app.dataDir, provider, key, opts.provider ? { provider: opts.provider } : {}, opts.verifyKey ? { verify: opts.verifyKey } : {});
      } catch (err) {
        throw toChatError(err);
      }
    },
    async forgetKey(provider) {
      try {
        return await forgetProviderKey(app.dataDir, provider, opts.provider ? { provider: opts.provider } : {});
      } catch (err) {
        throw toChatError(err);
      }
    },
    async codexSignIn(action) {
      const current = opts.provider ? { provider: opts.provider } : {};
      try {
        return await (action === "start" ? startCodexSignIn(app.dataDir, current) : cancelCodexSignIn(app.dataDir, current));
      } catch (err) {
        throw toChatError(err);
      }
    },
    async list(ref) {
      try {
        return listConversationSummaries(app, ref).map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, outcome: c.outcome }));
      } catch (err) {
        if (err instanceof NotFoundError) return null;
        throw err;
      }
    },
    async get(id) {
      try {
        reconcileAgentRuns(app);
        const v = showConversation(app, id);
        return {
          conversation: {
            id: v.conversation.id, layoutId: v.conversation.layoutId, title: v.conversation.title, createdAt: v.conversation.createdAt,
            provider: v.conversation.provider, model: v.conversation.model,
          },
          messages: v.messages,
          proposals: v.proposals,
          priorities: v.priorities,
          presentations: v.presentations,
          preparationReceipts: v.preparationReceipts,
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
