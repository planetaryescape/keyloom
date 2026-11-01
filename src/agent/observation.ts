import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelTool } from "./model.ts";
import type { AgentPorts } from "./ports.ts";
import type { ValidationResult } from "../validation/result.ts";
import { PublicToolError } from "./tools/public-error.ts";

export type OperationReference = { kind: "config" | "proposal" | "priority" | "decision"; id: string };
export type OperationResult = { accepted: number; declined: number; validationCodes: string[]; references: OperationReference[] };
export type AgentObservation =
  | { type: "operation_started"; operationId: string; tool: string }
  | ({ type: "operation_finished"; operationId: string; status: "succeeded" | "failed" | "declined" | "partial"; durationMs: number; failureCode?: "invalid_input" | "function_id" | "unknown_layer" | "tool_error" } & OperationResult)
  | { type: "limit_reached" }
  | { type: "public_message"; id: string; kind: "working_note" | "answer"; text: string };

/** Per-invocation port facts, not string parsing. Async context keeps parallel same-named calls separate. */
export function toolObserver(ports: AgentPorts, emit: (event: AgentObservation) => void, signal?: AbortSignal) {
  const context = new AsyncLocalStorage<OperationResult>();
  let calls = 0;
  let limited = false;
  let completed = false;
  const validation = (result: ValidationResult) => {
    const current = context.getStore();
    if (!current) return;
    if (result.ok) current.accepted++;
    else {
      current.declined++;
      current.validationCodes.push(...result.errors.map((e) => e.code));
    }
  };
  const reference = (kind: OperationReference["kind"], id: string) => context.getStore()?.references.push({ kind, id });
  const observed: AgentPorts = {
    ...ports,
    check: (ops) => { const result = ports.check(ops); validation(result); return result; },
    propose: (alternatives, options) => {
      const results = ports.propose(alternatives, options);
      for (const result of results) {
        validation(result.validation);
        if (result.changeSetId !== null) reference("proposal", result.changeSetId);
      }
      return results;
    },
    newConfig: (input) => {
      const result = ports.newConfig(input);
      if (result instanceof Promise) return result.then((r) => { reference("config", r.id); return r; });
      reference("config", result.id);
      return result;
    },
    put: (input) => {
      const result = ports.put(input);
      reference("config", result.config.id);
      for (const proposal of result.proposals) reference("proposal", proposal.changeSetId);
      return result;
    },
    recordPriority: (input) => { const result = ports.recordPriority(input); reference("priority", result.id); return result; },
    recordOutcome: (input) => { const result = ports.recordOutcome(input); reference("decision", result.id); return result; },
  };
  return {
    limited: () => limited,
    completed: () => completed,
    ports: observed,
    wrap: (tools: ModelTool[]): ModelTool[] => tools.map((tool) => ({
      ...tool,
      run: async (raw) => {
        signal?.throwIfAborted();
        if (completed) throw new Error("Not run: this task continued on its new config.");
        if (calls >= 64) {
          limited = true;
          emit({ type: "limit_reached" });
          throw new Error("keyloom stopped this turn: activity limit reached");
        }
        const operationId = `op_${++calls}`;
        const started = performance.now();
        const result: OperationResult = { accepted: 0, declined: 0, validationCodes: [], references: [] };
        emit({ type: "operation_started", operationId, tool: tool.name });
        return context.run(result, async () => {
          try {
            const out = await tool.run(raw);
            if (tool.completes) completed = true;
            // The proposal attempt guard refuses without calling a port again.
            if (tool.name === "propose_changes" && result.accepted + result.declined === 0) result.declined++;
            emit({ type: "operation_finished", operationId, status: result.declined ? result.accepted ? "partial" : "declined" : "succeeded", durationMs: Math.round(performance.now() - started), ...result });
            return out;
          } catch (error) {
            emit({ type: "operation_finished", operationId, status: "failed", durationMs: Math.round(performance.now() - started), failureCode: error instanceof PublicToolError ? error.publicCode : "tool_error", ...result });
            throw error;
          }
        });
      },
    })),
  };
}
