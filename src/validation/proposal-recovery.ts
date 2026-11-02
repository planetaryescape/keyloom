import type { Layout } from "../layout/schema.ts";
import type { Issue } from "./result.ts";
import { keyIn } from "./words.ts";

export type RecoveryContext = { title: string; goal: string; goalBasis: "request" | "saved goal" | "explanation"; reasons: string[] };
export type RecoverySource = { kind: "proposal"; proposalId: string; conversationId?: string } | { kind: "refusal"; conversationId: string; userMessageId: string };
export type ProposalRecoveryDraft = { id: string; headRevisionId: string; source: RecoverySource; context: RecoveryContext; request: string; sent: boolean };

const CATEGORIES = new Map([
  ["unknown_ref", "The change refers to something missing from the layout."],
  ["stale_base", "The layout changed at a target this proposal needs."],
  ["layer_unreachable", "A layer would have no usable way in."],
  ["layer_trap", "A layer would have no usable way out."],
  ["function_lost", "An existing function would be lost without an accepted reason."],
  ["pinned", "The change conflicts with a pinned requirement."],
]);

export function refusalReasons(codes: readonly string[]): string[] {
  return [...new Set(codes.map((code) => CATEGORIES.get(code) ?? "A recorded validation rule refused the change."))]
    .concat("Only validation categories were recorded; the exact affected target was not recorded.");
}

export function validationReasons(issues: readonly Issue[], layout: Layout): string[] {
  return issues.map((issue) => [issue.plain ?? issue.message, ...(issue.slots ?? []).map((slot) => keyIn(layout, slot)), ...(issue.layerId ? [layout.layers.find((layer) => layer.id === issue.layerId)?.name ?? "A missing layer"] : [])].join(" · "));
}

/** Recorded validator facts only: a partial result or generic tool failure is not an unsaved refusal. */
export function declinedProposalCodes(presentation: { status: string; detailsTruncated: boolean; operations: readonly { tool: string; status: string; accepted: number; declined: number; validationCodes: readonly string[]; references: readonly { kind: string }[] }[] } | undefined): string[] {
  if (!presentation || presentation.status === "running" || presentation.detailsTruncated) return [];
  if (presentation.operations.some((op) => op.accepted > 0 && op.tool === "propose_changes" || op.references.some((ref) => ref.kind === "proposal"))) return [];
  return presentation.operations.filter((op) => op.tool === "propose_changes" && op.status === "declined" && op.accepted === 0 && op.declined > 0).flatMap((op) => op.validationCodes);
}

export function formatProposalRecoveryRequest(context: RecoveryContext): string {
  return [
    `Please plan a revised proposal for: ${context.title}`,
    `${context.goalBasis === "request" ? "Original request" : `${context.goalBasis === "saved goal" ? "Saved goal" : "Saved explanation"} (not a verbatim user request)`}:\n${context.goal}`,
    `Recorded reason:\n${context.reasons.join("\n")}`,
    "Read the current layout first. Retain the original goal, preserve unrelated behavior, and explain any uncertainty. Propose a validated replacement for preview. Do not apply it.",
  ].join("\n\n");
}
