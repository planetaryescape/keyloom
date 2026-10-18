import type { AgentObservation } from "../agent/observation.ts";
import type { ModelMessage } from "../agent/model.ts";
import type { MessageRow } from "../persistence/conversations.ts";
import { type Presentation, listPresentations, savePresentation } from "../persistence/chat-presentations.ts";
import type { App } from "./context.ts";

export type { Presentation } from "../persistence/chat-presentations.ts";

const LABELS: Readonly<Record<string, string>> = {
  list_layouts: "List configs", get_layout: "Read layout", find_function: "Find function",
  analyse_change: "Check changes", propose_changes: "Prepare proposals", mirror_keys: "Match mirrored keys",
  map_keys: "Match keys", put_config: "Prepare copied config", get_typing_findings: "Read typing findings",
  ask_user: "Ask a question", create_config: "Create config", record_priority: "Remember priority", update_decision_outcome: "Record outcome",
};
const MUTATING = new Set(["propose_changes", "put_config", "create_config", "record_priority", "update_decision_outcome"]);
const CODES = new Set(["schema", "firmware_unsupported", "unknown_ref", "function_lost", "layer_unreachable", "layer_trap", "outside_selection", "moved_pinned", "large_relearn", "contradicts_decision", "qmk_tapdance_mixed_hands"]);
const ID = /^(?:lay|cs|dec)_[0-9A-HJKMNP-TV-Z]{26}$/;
const WARNING = "Work did not finish. Preparation may already have completed; inspect configs and proposals before retrying. Stop is not rollback. Reconnecting does not resend this request.";
const UNOBSERVED_WARNING = "Live progress is unavailable here. Work may still be running or may have stopped; inspect configs and proposals before retrying. Reading this history does not resend the request.";

/** Bound serialized text bytes by Unicode code point, including JSON escapes. */
export function clipPublicText(text: string, budget: number): string {
  let bytes = 0;
  let end = 0;
  for (const point of text) {
    bytes += Buffer.byteLength(JSON.stringify(point)) - 2;
    if (bytes > budget) break;
    end += point.length;
  }
  return text.slice(0, end);
}

export function unobservedPresentation(presentation: Presentation): Presentation {
  return { ...presentation, status: "unobserved", warning: UNOBSERVED_WARNING, operations: presentation.operations.map((operation) => operation.status === "running" ? { ...operation, status: "unknown" } : operation) };
}

export function resolvePresentedQuestion(app: App, conversationId: string, toolUseId: string): Presentation[] {
  const resolved: Presentation[] = [];
  for (const presentation of listPresentations(app.db, conversationId)) {
    if (presentation.status === "waiting_user" && presentation.questionToolUseId === toolUseId) {
      const completed: Presentation = { ...presentation, status: "completed" };
      savePresentation(app.db, conversationId, completed);
      resolved.push(completed);
    }
  }
  return resolved;
}

/** A bounded observation snapshot, deliberately not an execution log or atomic effect receipt. */
export function chatPresentation(app: App, conversationId: string, userMessageId: string, emit?: (presentation: Presentation) => void) {
  let state: Presentation = { version: 1, userMessageId, status: "running", operations: [], messages: [], effectsMayHaveOccurred: false, warning: null, detailsTruncated: false };
  const publish = () => {
    savePresentation(app.db, conversationId, state);
    // Do not hand consumers the mutable snapshot used by the next observation.
    emit?.(structuredClone(state));
  };
  const message = (input: Presentation["messages"][number]) => {
    const remaining = Math.max(0, 8_192 - state.messages.reduce((sum, m) => sum + Buffer.byteLength(JSON.stringify(m.text)), 0));
    const clipped = clipPublicText(input.text, Math.max(0, remaining - 2));
    if (clipped !== input.text || state.messages.length >= 64) state.detailsTruncated = true;
    if (state.messages.length < 64) state.messages.push({ ...input, text: clipped });
  };
  publish();
  return {
    observe(event: AgentObservation) {
      if (event.type === "operation_started") {
        const known = Object.hasOwn(LABELS, event.tool);
        state.effectsMayHaveOccurred ||= MUTATING.has(event.tool);
        state.operations.push({ id: event.operationId, tool: known ? event.tool : "unknown", label: known ? LABELS[event.tool] ?? "Run operation" : "Run operation", status: "running", durationMs: 0, accepted: 0, declined: 0, validationCodes: [], references: [] });
      } else if (event.type === "operation_finished") {
        const operation = state.operations.find((o) => o.id === event.operationId);
        if (operation) Object.assign(operation, {
          status: operation.tool === "unknown" && event.status === "succeeded" ? "unknown" : event.status,
          durationMs: event.durationMs, accepted: event.accepted, declined: event.declined,
          validationCodes: [...new Set(event.validationCodes.map((code) => CODES.has(code) ? code : "validation_declined"))].slice(0, 4),
          references: event.references.filter((ref) => ID.test(ref.id)).slice(0, 2),
        });
        if (event.validationCodes.length > 4 || event.references.length > 2) state.detailsTruncated = true;
      } else if (event.type === "limit_reached") state.detailsTruncated = true;
      else message({ id: event.id, kind: event.kind, text: event.text });
      publish();
    },
    finish(status: Presentation["status"], models?: ModelMessage[], stored?: MessageRow[], questionToolUseId?: string) {
      if (questionToolUseId !== undefined) {
        if (questionToolUseId.length <= 128) state.questionToolUseId = questionToolUseId;
        else state.detailsTruncated = true;
      }
      if (models && stored) {
        state.messages = [];
        models.forEach((model, index) => {
          if (model.role !== "assistant") return;
          const text = model.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
          if (!text) return;
          const messageId = stored[index]?.id;
          message({ id: `public_${state.messages.length + 1}`, kind: status === "completed" && index === models.length - 1 && !model.content.some((b) => b.type === "tool_use") ? "answer" : "working_note", text, ...(messageId ? { messageId } : {}) });
        });
      }
      state = { ...state, status, warning: ["failed", "cancelled", "incomplete"].includes(status) ? WARNING : null, operations: state.operations.map((operation) => operation.status === "running" ? { ...operation, status: "unknown" } : operation) };
      publish();
    },
  };
}
