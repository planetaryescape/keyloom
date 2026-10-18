// Component input, not a wire protocol. The chat adapter owns validated, correlated
// operation observations and explicit public-message boundaries.
export type AgentWorkStatus = "running" | "waiting" | "completed" | "failed" | "stopped" | "disconnected";
export type OperationStatus = "running" | "succeeded" | "failed" | "declined" | "partial" | "cancelled" | "unknown";

export interface AgentOperationView {
  id: string;
  label: string;
  target: string | null;
  status: OperationStatus;
  /** An observed duration, never a client-side progress timer. */
  durationMs: number | null;
  /** Allowlisted public result summary, not tool input/output JSON. */
  summary: string | null;
}

export type AgentWorkView =
  | { kind: "unavailable"; status: AgentWorkStatus }
  | {
      kind: "observed";
      status: AgentWorkStatus;
      /** A public phase label supplied by the adapter; no private thinking. */
      label: string | null;
      notes: readonly { id: string; text: string }[];
      operations: readonly AgentOperationView[];
      warning?: string | null;
      detailsTruncated?: boolean;
    };

export type WorkDisclosureChoice = "automatic" | "open" | "closed";
// A bounded run can carry 64 observations plus 64 separately identified receipt facts.
export const MAX_WORK_ROWS = 128;
export const MAX_WORK_NOTES = 20;

export function operationStatus(status: OperationStatus, workStatus: AgentWorkStatus): OperationStatus {
  // A terminal reply or a question is not evidence that an unfinished call succeeded.
  return status === "running" && workStatus !== "running" ? "unknown" : status;
}

export function operationStatusWords(status: OperationStatus): string {
  switch (status) {
    case "running": return "Working";
    case "succeeded": return "Completed";
    case "failed": return "Failed";
    case "declined": return "Not accepted";
    case "partial": return "Partly accepted";
    case "cancelled": return "Cancelled";
    case "unknown": return "Outcome not confirmed";
  }
}

export function observedDuration(milliseconds: number | null): string | null {
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return null;
  return milliseconds < 1_000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1_000).toFixed(1)} s`;
}

export function projectWork(view: Extract<AgentWorkView, { kind: "observed" }>) {
  const omitted = Math.max(0, view.operations.length - MAX_WORK_ROWS);
  const operations = view.operations.slice(-MAX_WORK_ROWS).map((operation) => ({
    ...operation,
    label: operation.label.trim().slice(0, 160) || "Keyboard operation",
    target: operation.target?.slice(0, 160) ?? null,
    summary: operation.summary?.slice(0, 600) ?? null,
    status: operationStatus(operation.status, view.status),
  }));
  return {
    routine: operations.filter((operation) => operation.status === "succeeded"),
    attention: operations.filter((operation) => operation.status !== "succeeded"),
    omitted,
    notes: view.notes.slice(-MAX_WORK_NOTES).map((note) => ({ ...note, text: note.text.slice(0, 1_200) })),
    omittedNotes: Math.max(0, view.notes.length - MAX_WORK_NOTES),
    // Missing earlier observations must not become an apparently clean success.
    canFold: view.status === "completed" && !view.detailsTruncated && omitted === 0 && view.notes.length <= MAX_WORK_NOTES
      && view.operations.every((operation) => operation.status === "succeeded"),
  };
}

export function workDetailsOpen(choice: WorkDisclosureChoice, canFold: boolean, focusInside: boolean): boolean {
  return choice === "open" || (choice === "automatic" && (!canFold || focusInside));
}

export function preserveWorkFocus(choice: WorkDisclosureChoice, canFold: boolean, focusInside: boolean): WorkDisclosureChoice {
  return choice === "automatic" && canFold && focusInside ? "open" : choice;
}
