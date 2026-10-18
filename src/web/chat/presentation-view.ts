import type { ChatPresentation } from "../../api/http.ts";
import type { AgentRunSnapshot } from "../../api/agent-runs.ts";
import type { AgentOperationView, AgentWorkStatus, AgentWorkView } from "./work-view.ts";

const STATUS = {
  running: "running", waiting_user: "waiting", completed: "completed", incomplete: "failed",
  failed: "failed", cancelled: "stopped", unobserved: "disconnected",
} satisfies Record<ChatPresentation["status"], AgentWorkStatus>;

/** Presentation is validated at the transport boundary; only app-owned observations become rows. */
export function presentationView(presentation: ChatPresentation, preparations: AgentRunSnapshot["preparations"] = []): AgentWorkView {
  const running = presentation.operations.findLast((operation) => operation.status === "running");
  // Receipt rows are independent facts. Never correlate effect_N to op_N, or infer which
  // unfinished operation committed by matching its name, arguments or completion order.
  const needsRecovery = ["unobserved", "failed", "cancelled", "incomplete"].includes(presentation.status) || presentation.operations.some((operation) => operation.status === "unknown");
  const recovered: AgentOperationView[] = (needsRecovery ? preparations : []).map((preparation) => ({
    id: `receipt:${preparation.operationId}`, label: preparation.references.length > 0 ? "Saved preparation receipt" : "Recorded preparation outcome", target: preparation.references.map((reference) => `${reference.kind}: ${reference.id}`).join(" · ") || null,
    status: preparation.references.length > 0 ? "succeeded" : "unknown", durationMs: null,
    summary: preparation.references.length > 0 ? "Committed locally. Any unfinished operation remains unconfirmed." : "Outcome recorded; no saved item reference. Validation may have declined this preparation.",
  }));
  return {
    kind: "observed", status: STATUS[presentation.status], label: running?.label ?? null,
    notes: presentation.messages.filter((message) => message.kind === "working_note"),
    operations: [...presentation.operations.map((operation) => {
      const facts: string[] = [];
      if (operation.accepted > 0) facts.push(`${operation.accepted} accepted`);
      if (operation.declined > 0) facts.push(`${operation.declined} not accepted`);
      if (operation.validationCodes.length > 0) facts.push(`Validation: ${operation.validationCodes.join(", ")}`);
      const configs = operation.references.filter((reference) => reference.kind === "config").length;
      const proposals = operation.references.filter((reference) => reference.kind === "proposal").length;
      if (configs > 0) facts.push(`${configs} prepared ${configs === 1 ? "config" : "configs"}`);
      if (proposals > 0) facts.push(`${proposals} saved ${proposals === 1 ? "proposal" : "proposals"}`);
      return {
        id: operation.id, label: operation.label, target: null, status: operation.status,
        durationMs: operation.status === "running" ? null : operation.durationMs,
        summary: facts.length === 0 ? null : facts.join(" · "),
      };
    }), ...recovered],
    warning: presentation.warning, detailsTruncated: presentation.detailsTruncated,
  };
}
