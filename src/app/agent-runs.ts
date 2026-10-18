import type { AgentModel } from "../agent/model.ts";
import { z } from "zod";
import type { ProviderId } from "../agent/provider.ts";
import type { Draft } from "../agent/prompt.ts";
import type { Presentation } from "../persistence/chat-presentations.ts";
import { canonical, conversationRun, effectSummaries, findRequestRun, findRun, requestCancellation, runningRuns, type EffectSummary, type RunRow } from "../persistence/agent-runs.ts";
import { listPresentations, savePresentation } from "../persistence/chat-presentations.ts";
import { newId } from "../persistence/ids.ts";
import { transact } from "../persistence/transaction.ts";
import { processAlive } from "../firmware/toolchain/lock.ts";
import type { App } from "./context.ts";
import { messageModel, runPreparedMessage, storeMessage, type SendMessageInput } from "./conversations.ts";
import { NotFoundError, UsageError } from "./errors.ts";
import { getLayout } from "./layouts.ts";

const ownerToken = crypto.randomUUID();
const owned = new Map<string, { app: App; abort: AbortController; done: Promise<void> }>();

export type AgentRunRequest = {
  version: 1; requestId: string; layoutRef: string;
  input: {
    message?: string | undefined; conversationId?: string | undefined;
    answer?: { toolUseId: string; text: string } | undefined;
    selection?: { layerId: string; positions: number[] } | undefined;
    drafts?: Draft[] | undefined;
  };
};
export type AgentRunSnapshot = {
  version: 1; id: string; requestId: string; conversationId: string; userMessageId: string; status: RunRow["status"];
  seq: number; cancelRequested: boolean; committedPreparations: number; preparations: EffectSummary[]; presentation: Presentation | null;
};
export type AgentRequestCancellation = AgentRunSnapshot | { version: 1; status: "pending_acceptance"; requestId: string; cancelRequested: true };

function requireRun(app: App, id: string): RunRow {
  const row = findRun(app.db, id);
  if (!row) throw new NotFoundError(`no agent run "${id}"`);
  return row;
}

/** A live foreign PID is never declared dead merely because this process does not own it.
 * PID reuse is conservative: unavailable ownership is safer than a false interruption.
 */
export function reconcileAgentRuns(app: App): void {
  for (const row of runningRuns(app.db)) {
    if (row.owner_pid === process.pid ? row.owner_token === ownerToken && owned.has(row.id) : processAlive(row.owner_pid)) continue;
    transact(app.db, () => {
      if (requireRun(app, row.id).status !== "running") return;
      app.db.query("UPDATE agent_runs SET status = 'interrupted', finished_at = ?, seq = seq + 1 WHERE id = ? AND status = 'running'").run(Date.now(), row.id);
      const presentation = listPresentations(app.db, row.conversation_id).find((p) => p.userMessageId === row.user_message_id);
      if (presentation) savePresentation(app.db, row.conversation_id, {
        ...presentation, status: "unobserved", warning: "Execution was interrupted. Saved preparation remains; nothing was automatically rerun. Stop is not rollback.",
        operations: presentation.operations.map((operation) => operation.status === "running" ? { ...operation, status: "unknown" } : operation),
      });
    });
  }
}

export function inspectAgentRun(app: App, id: string): AgentRunSnapshot {
  reconcileAgentRuns(app);
  const row = requireRun(app, id);
  const count = z.object({ count: z.number() }).parse(app.db.query("SELECT count(*) AS count FROM agent_effects WHERE run_id = ?").get(row.id));
  const snapshot: AgentRunSnapshot = {
    version: 1, id: row.id, requestId: row.request_id, conversationId: row.conversation_id, userMessageId: row.user_message_id,
    status: row.status, seq: row.seq, cancelRequested: row.cancel_requested !== 0, committedPreparations: count.count,
    preparations: effectSummaries(app.db, row.id),
    presentation: listPresentations(app.db, row.conversation_id).find((p) => p.userMessageId === row.user_message_id) ?? null,
  };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 64 * 1024 && snapshot.presentation !== null) {
    snapshot.presentation = { ...snapshot.presentation, operations: [], messages: [], detailsTruncated: true };
  }
  return snapshot;
}

export function latestAgentRun(app: App, conversationId: string): AgentRunSnapshot | null {
  const row = conversationRun(app.db, conversationId);
  return row ? inspectAgentRun(app, row.id) : null;
}

function duplicate(app: App, request: AgentRunRequest): RunRow | undefined {
  const prior = findRequestRun(app.db, request.requestId);
  if (prior && prior.request_json !== canonical(request)) throw new UsageError("request identity belongs to a different scope or input");
  return prior;
}

export async function startAgentRun(app: App, raw: AgentRunRequest, opts: { model?: AgentModel; provider?: ProviderId } = {}): Promise<AgentRunSnapshot> {
  const request = raw;
  if (request.version !== 1 || !request.requestId.trim() || request.requestId.length > 128) throw new UsageError("unsupported run version or invalid request identity");
  reconcileAgentRuns(app);
  const prior = duplicate(app, request);
  if (prior) return inspectAgentRun(app, prior.id);
  const input: SendMessageInput = {
    presentationVersion: 1,
    ...(request.input.message === undefined ? {} : { message: request.input.message }),
    ...(request.input.answer === undefined ? {} : { answer: request.input.answer }),
    ...(request.input.conversationId === undefined ? {} : { conversationId: request.input.conversationId }),
    ...(request.input.drafts === undefined ? {} : { drafts: request.input.drafts }),
    ...(request.input.selection === undefined ? {} : { selection: { layer: request.input.selection.layerId, positions: request.input.selection.positions } }),
    ...opts,
  };
  // Resolving credentials/model configuration does not launch a provider request.
  const model = await messageModel(app, request.layoutRef, input);
  const accepted = transact(app.db, () => {
    const raced = duplicate(app, request);
    if (raced) return { row: raced };
    const stoppedBeforeAcceptance = requestCancellation(app.db, request.requestId);
    const pending = z.object({ count: z.number() }).parse(app.db.query("SELECT count(*) AS count FROM agent_request_cancellations").get());
    if (!stoppedBeforeAcceptance && pending.count >= 1024) throw new UsageError("Pending Stop storage is full; new requests are blocked until pending cancellations are accepted.");
    const prepared = storeMessage(app, request.layoutRef, input, model);
    const id = newId("run");
    app.db.query("INSERT INTO agent_runs (id, request_id, request_json, layout_id, conversation_id, user_message_id, revision_id, owner_pid, owner_token, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)")
      .run(id, request.requestId, canonical(request), prepared.view.layout.id, prepared.conversation.id, prepared.userMessage.id, prepared.view.revision.id, process.pid, ownerToken, Date.now());
    if (stoppedBeforeAcceptance) {
      app.db.query("UPDATE agent_runs SET status = 'cancelled', cancel_requested = 1, finished_at = ? WHERE id = ?").run(Date.now(), id);
      savePresentation(app.db, prepared.conversation.id, { version: 1, userMessageId: prepared.userMessage.id, status: "cancelled", operations: [], messages: [], effectsMayHaveOccurred: false, warning: "Stopped before execution. No agent preparation ran for this request. Stop does not roll back earlier work.", detailsTruncated: false });
      app.db.query("DELETE FROM agent_request_cancellations WHERE request_id = ?").run(request.requestId);
      return { row: requireRun(app, id) };
    }
    return { row: requireRun(app, id), prepared };
  });
  if (accepted.prepared !== undefined) {
    const abort = new AbortController();
    // Register ownership BEFORE execution or acknowledgement; no subscriber signal enters here.
    const entry = { app, abort, done: Promise.resolve() };
    owned.set(accepted.row.id, entry);
    const cancelCheck = setInterval(() => {
      if (findRun(app.db, accepted.row.id)?.cancel_requested) abort.abort();
    }, 100);
    entry.done = runPreparedMessage(app, accepted.prepared, {
      ...input, signal: abort.signal,
      onEvent: (event) => {
        if (event.type === "presentation") app.db.query("UPDATE agent_runs SET seq = seq + 1 WHERE id = ?").run(accepted.row.id);
      },
    }, accepted.row.id).then(() => undefined, () => {
      app.db.query("UPDATE agent_runs SET status = ?, finished_at = ?, seq = seq + 1 WHERE id = ? AND status = 'running'")
        .run(abort.signal.aborted ? "cancelled" : "failed", Date.now(), accepted.row.id);
    }).finally(() => { clearInterval(cancelCheck); owned.delete(accepted.row.id); });
  }
  return inspectAgentRun(app, accepted.row.id);
}

export async function answerAgentRun(app: App, id: string, requestId: string, answer: { toolUseId: string; text: string }, opts: { model?: AgentModel; provider?: ProviderId } = {}): Promise<AgentRunSnapshot> {
  const row = requireRun(app, id);
  const request: AgentRunRequest = { version: 1, requestId, layoutRef: row.layout_id, input: { conversationId: row.conversation_id, answer } };
  const prior = duplicate(app, request);
  if (prior) return inspectAgentRun(app, prior.id);
  if (row.status !== "waiting_user" || getLayout(app, row.layout_id).revision.id !== row.revision_id) throw new UsageError("that question or its target is no longer current");
  return startAgentRun(app, request, opts);
}

/** Cross-process cancellation is a request the owning loop polls, never a guessed terminal flag. */
export function cancelAgentRun(app: App, id: string): AgentRunSnapshot {
  reconcileAgentRuns(app);
  const row = requireRun(app, id);
  if (row.status === "running") {
    app.db.query("UPDATE agent_runs SET cancel_requested = 1, seq = seq + 1 WHERE id = ? AND cancel_requested = 0").run(row.id);
    owned.get(row.id)?.abort.abort();
  }
  return inspectAgentRun(app, row.id);
}

/** Persist intent before acceptance, or cancel the already-accepted request. Never evict intent:
 * a delayed POST must not become executable again because time passed or another Stop arrived.
 */
export function cancelAgentRequest(app: App, requestId: string): AgentRequestCancellation {
  if (!requestId.trim() || requestId.length > 128) throw new UsageError("invalid request identity");
  return transact(app.db, () => {
    const run = findRequestRun(app.db, requestId);
    if (run) return cancelAgentRun(app, run.id);
    if (!requestCancellation(app.db, requestId)) {
      const count = z.object({ count: z.number() }).parse(app.db.query("SELECT count(*) AS count FROM agent_request_cancellations").get());
      if (count.count >= 1024) throw new UsageError("Pending Stop storage is full; this Stop was not recorded. Inspect the request before continuing.");
      app.db.query("INSERT INTO agent_request_cancellations (request_id, created_at) VALUES (?, ?)").run(requestId, Date.now());
    }
    return { version: 1, status: "pending_acceptance", requestId, cancelRequested: true };
  });
}

export async function drainAgentRuns(app: App): Promise<void> {
  const entries = [...owned.values()].filter((entry) => entry.app === app);
  for (const entry of entries) entry.abort.abort();
  await Promise.all(entries.map((entry) => entry.done));
}

export async function waitForAgentRun(app: App, id: string): Promise<AgentRunSnapshot> {
  await owned.get(requireRun(app, id).id)?.done;
  return inspectAgentRun(app, id);
}
