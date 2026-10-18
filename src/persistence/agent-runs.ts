import type { Database } from "bun:sqlite";
import { z } from "zod";
import { transact } from "./transaction.ts";

export const RunRowSchema = z.object({
  id: z.string(), request_id: z.string(), request_json: z.string(), layout_id: z.string(), conversation_id: z.string(),
  user_message_id: z.string(), revision_id: z.string(), owner_pid: z.number(), owner_token: z.string(),
  status: z.enum(["running", "waiting_user", "completed", "failed", "cancelled", "interrupted"]),
  cancel_requested: z.number(), seq: z.number(), created_at: z.number(), finished_at: z.number().nullable(), outcome_json: z.string().nullable(),
});
export type RunRow = z.infer<typeof RunRowSchema>;
const effectTool = z.enum(["put_config", "create_config", "propose_changes", "record_priority", "update_decision_outcome"]);
const resultReference = z.object({ id: z.string().optional(), config: z.object({ id: z.string() }).optional(), changeSetId: z.string().nullable().optional() });
export type EffectSummary = { operationId: string; tool: z.infer<typeof effectTool>; references: Array<{ kind: "config" | "proposal" | "priority" | "decision"; id: string }> };

/** Allowlisted references survive a crash between receipt commit and tool observation. No raw result/input escapes. */
export function effectSummaries(db: Database, runId: string): EffectSummary[] {
  const rows = db.query("SELECT operation_id, input_json, result_json FROM agent_effects WHERE run_id = ? ORDER BY rowid LIMIT 64").all(runId);
  return rows.flatMap((raw) => {
    const row = z.object({ operation_id: z.string(), input_json: z.string(), result_json: z.string() }).parse(raw);
    const input = z.object({ name: effectTool }).safeParse(JSON.parse(row.input_json));
    if (!input.success) return [];
    const value: unknown = JSON.parse(row.result_json);
    const parsed = z.array(resultReference).safeParse(Array.isArray(value) ? value : [value]);
    const references: EffectSummary["references"] = [];
    for (const result of parsed.success ? parsed.data : []) {
      if (result.config) references.push({ kind: "config", id: result.config.id });
      if (result.changeSetId) references.push({ kind: "proposal", id: result.changeSetId });
      if (result.id) references.push({ kind: input.data.name === "create_config" ? "config" : input.data.name === "record_priority" ? "priority" : "decision", id: result.id });
    }
    return [{ operationId: row.operation_id, tool: input.data.name, references: references.filter((ref) => /^(?:lay|cs|dec)_[0-9A-HJKMNP-TV-Z]{26}$/.test(ref.id)).slice(0, 2) }];
  });
}

export function findRun(db: Database, id: string): RunRow | undefined {
  const row = db.query("SELECT * FROM agent_runs WHERE id = ? OR request_id = ?").get(id, id);
  return row === null ? undefined : RunRowSchema.parse(row);
}

export function findRequestRun(db: Database, requestId: string): RunRow | undefined {
  const row = db.query("SELECT * FROM agent_runs WHERE request_id = ?").get(requestId);
  return row === null ? undefined : RunRowSchema.parse(row);
}

export function requestCancellation(db: Database, requestId: string): boolean {
  return db.query("SELECT 1 FROM agent_request_cancellations WHERE request_id = ?").get(requestId) !== null;
}

export function conversationRun(db: Database, conversationId: string): RunRow | undefined {
  const row = db.query("SELECT * FROM agent_runs WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").get(conversationId);
  return row === null ? undefined : RunRowSchema.parse(row);
}

export function conversationPreparations(db: Database, conversationId: string): Array<{ userMessageId: string; preparations: EffectSummary[] }> {
  return db.query("SELECT id, user_message_id FROM agent_runs WHERE conversation_id = ? ORDER BY created_at, id").all(conversationId).flatMap((raw) => {
    const row = z.object({ id: z.string(), user_message_id: z.string() }).parse(raw);
    const preparations = effectSummaries(db, row.id);
    return preparations.length > 0 ? [{ userMessageId: row.user_message_id, preparations }] : [];
  });
}

export function runningRuns(db: Database): RunRow[] {
  return db.query("SELECT * FROM agent_runs WHERE status = 'running'").all().map((row) => RunRowSchema.parse(row));
}

/** Canonical JSON binds identities to values rather than object insertion order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

/** Synchronous domain work and its original return value share the outer write transaction.
 * Nested use-case transactions are savepoints, not independent commits (agent-runs tests).
 * This is an application invocation identity, NOT a provider call-ID deduplicator.
 */
export function effectReceipt<T>(db: Database, runId: string, operationId: string, input: unknown, perform: () => T): T {
  return transact(db, () => {
    const run = findRun(db, runId);
    if (!run || run.status !== "running" || run.cancel_requested) throw new Error("agent work is no longer running");
    const key = canonical(input);
    const receipt = db.query("SELECT input_json, result_json FROM agent_effects WHERE run_id = ? AND operation_id = ?").get(runId, operationId);
    if (receipt !== null) {
      const saved = z.object({ input_json: z.string(), result_json: z.string() }).parse(receipt);
      if (saved.input_json !== key) throw new Error("operation identity belongs to different input");
      // SAFETY: only this typed synchronous application callback writes this private, immutable
      // receipt. The operation/input comparison above binds it to the same callback contract.
      return JSON.parse(saved.result_json) as T;
    }
    const result = perform();
    db.query("INSERT INTO agent_effects (run_id, operation_id, input_json, result_json) VALUES (?, ?, ?, ?)")
      .run(runId, operationId, key, JSON.stringify(result));
    db.query("UPDATE agent_runs SET seq = seq + 1 WHERE id = ?").run(runId);
    return result;
  });
}
