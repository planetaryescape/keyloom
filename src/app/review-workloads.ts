// Workload-backed automatic review. Profiles are explicit; no profile means no Docker work.
import { builtinWorkloadSuites, WorkloadSuiteSchema } from "../lab/workload/schema.ts";
import type { WorkloadTaskResult } from "../lab/workload/evaluate.ts";
import { ReviewActivitiesSchema, ReviewWorkloadComparisonSchema, workloadVerdictWords, type ReviewActivity, type ReviewWorkload, type ReviewWorkloadComparison } from "../layout/review-workload.ts";
import { dockerStatus } from "../firmware/toolchain/docker.ts";
import { requirePlatformSupport } from "../firmware/toolchain/platform-support.ts";
import { findChangeSet, markRejected } from "../persistence/change-sets.ts";
import { findReview, latestReview, REVIEW_AI_STALE_MS, type BoardReviewRow } from "../persistence/reviews.ts";
import { clearReviewWorkload, reviewActivities, reviewWorkload, saveReviewWorkload, setReviewActivities } from "../persistence/review-workloads.ts";
import { transact } from "../persistence/transaction.ts";
import type { ReviewItem } from "../validation/review-item.ts";
import type { App } from "./context.ts";
import { UsageError } from "./errors.ts";
import { getLayout } from "./layouts.ts";
import { compareWorkloadToBaseline, evaluateStoredWorkload, validateWorkloadPatch, workloadHash, type WorkloadDeps, type WorkloadReport } from "./workload.ts";

export const REVIEW_WORKLOAD_MAX_PROPOSALS = 2;
export const REVIEW_WORKLOAD_TIMEOUT_MS = 8 * 60_000;

export function saveReviewActivities(app: App, ref: string, input: unknown): ReviewActivity[] {
  const parsed = ReviewActivitiesSchema.safeParse(input);
  if (!parsed.success) throw new UsageError(`invalid review activities: ${parsed.error.issues[0]?.message}; choose prose, typescript, python, json, shell or shortcuts`);
  const activities = [...parsed.data].sort();
  const view = getLayout(app, ref);
  transact(app.db, () => {
    const previous = latestReview(app.db, view.layout.id);
    if (previous?.ai.status === "running" && (previous.ai.startedAt === null || Date.now() - previous.ai.startedAt < REVIEW_AI_STALE_MS)) throw new UsageError("The review is still running. Wait for it to finish before changing activities.");
    setReviewActivities(app.db, view.layout.id, activities);
  });
  return activities;
}

export function selectedReviewSuite(activities: readonly ReviewActivity[]) {
  const builtins = builtinWorkloadSuites();
  return WorkloadSuiteSchema.parse({
    schemaVersion: 1, id: "board-review", host: "us-ansi",
    tasks: activities.flatMap((id) => {
      const suite = builtins.find((s) => s.id === id);
      if (!suite) throw new UsageError(`unknown activity ${id}`);
      return suite.tasks.map((task) => ({ ...task, id: `${id}-${task.id}` }));
    }),
  });
}

export function pendingReviewWorkload(activities: ReviewActivity[]): ReviewWorkload {
  return { status: "pending", activities, reason: null, identity: null, baseline: [], comparisons: [] };
}
const taskSummary = (task: WorkloadTaskResult) => {
  const counts = new Map<number, number>();
  if (task.costsVerified) for (const event of task.trace) if (event.action === "press") counts.set(event.position, (counts.get(event.position) ?? 0) + 1);
  return {
    id: task.id, status: task.status, requestedOutputs: task.requestedOutputs,
    physicalKeydowns: task.costsVerified ? task.costs?.physicalKeydowns ?? null : null,
    maxSimultaneousKeys: task.costsVerified ? task.costs?.maxSimultaneousKeys ?? null : null,
    layerEntries: task.costsVerified ? task.costs?.layerEntries ?? null : null,
    modifierEntries: task.costsVerified ? task.costs?.modifierEntries ?? null : null,
    busyKeys: [...counts].sort(([p, n], [q, m]) => m - n || p - q).slice(0, 6).map(([position, keydowns]) => ({ position, keydowns })),
  };
};

/** Returns a process-local baseline for this one review, never a persisted replay cache. */
export async function measureReviewBaseline(app: App, row: BoardReviewRow, signal: AbortSignal, deps: WorkloadDeps): Promise<WorkloadReport | undefined> {
  const activities = reviewActivities(app.db, row.layoutId);
  if (activities.length === 0) { clearReviewWorkload(app.db, row.id); return; }
  const evidence = pendingReviewWorkload(activities);
  evidence.status = "running";
  saveReviewWorkload(app.db, row.id, evidence);
  try {
    requirePlatformSupport("keyloom workload evaluate");
    if (getLayout(app, row.layoutId, row.revisionId).document.firmware === "kanata") throw new UsageError("Kanata workload replay is not available yet.");
    if (!deps.replay) {
      const docker = await dockerStatus();
      if (!docker.ok) throw new UsageError(`Workload tests need Docker: ${docker.reason}`);
    }
    const report = await evaluateStoredWorkload(app, row.layoutId, { revisionId: row.revisionId, suite: selectedReviewSuite(activities), signal }, deps);
    evidence.status = "done";
    evidence.identity = report.identity;
    evidence.baseline = report.tasks.map(taskSummary);
    if (report.tasks.some((t) => t.status !== "verified")) evidence.reason = "Some tasks are unverified. This review cannot establish an improvement across all selected tasks.";
    saveReviewWorkload(app.db, row.id, evidence);
    return report;
  } catch (error) {
    evidence.status = signal.aborted ? "failed" : "unavailable";
    evidence.reason = signal.aborted ? "Workload testing stopped or reached its time limit." : error instanceof Error ? error.message : "Workload testing could not start.";
    saveReviewWorkload(app.db, row.id, evidence);
    return;
  }
}

/** Model input contains only task IDs, status and counts: no workload text, events or HID reports. */
export function reviewWorkloadRequest(evidence: ReviewWorkload | undefined): string {
  if (!evidence) return "No activities selected. Do not assume how this keyboard is used or claim measured workload improvements.";
  return [
    `Activities chosen by the user: ${evidence.activities.join(", ")}.`,
    "These are tiny US-ANSI transcription/shortcut checks, not representative activity frequencies or a human speed/comfort score.",
    ...evidence.baseline.map((t) => `${t.id}: ${t.status}; physical keydowns ${t.physicalKeydowns ?? "unknown"}; peak simultaneous keys ${t.maxSimultaneousKeys ?? "unknown"}; layer entries ${t.layerEntries ?? "unknown"}; modifier entries ${t.modifierEntries ?? "unknown"}. Most used physical positions (zero-based, counts only, not a trace): ${t.busyKeys.map((k) => `${k.position}=${k.keydowns}`).join(", ") || "unknown"}.`),
    `Propose at most ${REVIEW_WORKLOAD_MAX_PROPOSALS} small changes, preserving pinned keys and every selected task. Use measured costly routes to guide the suggestions.`,
    "The app will independently test saved proposals after you finish. Never claim a proposed gain is verified, and do not call a no-route result proof that the task is impossible.",
    ...(evidence.status === "done" ? [] : ["Workload measurements are unavailable. Do not invent results; only suggest independently justified correctness fixes."]),
  ].join("\n");
}

function current(app: App, row: BoardReviewRow): boolean {
  return getLayout(app, row.layoutId).revision.id === row.revisionId && findReview(app.db, row.id)?.ai.status === "running";
}

export async function measureReviewSuggestions(app: App, row: BoardReviewRow, items: ReviewItem[], baseline: WorkloadReport | undefined, signal: AbortSignal, deps: WorkloadDeps): Promise<ReviewItem[]> {
  const evidence = reviewWorkload(app.db, row.id);
  if (!evidence) return items;
  evidence.comparisons = [];
  const rejected = new Set<string>();
  for (const item of items) {
    if (item.kind !== "suggestion" || item.proposalId === null) continue;
    const proposal = findChangeSet(app.db, item.proposalId);
    const result: ReviewWorkloadComparison = {
      proposalId: item.proposalId, patchHash: null, verdict: "not-tested", reason: baseline ? "The proposal is no longer available for testing." : "The baseline could not be measured.", tasks: [], deltas: [],
    };
    if (proposal?.status === "proposed") {
      result.patchHash = workloadHash(proposal.ops);
      try { validateWorkloadPatch(app, row.layoutId, proposal.ops, row.revisionId); }
      catch (error) {
        result.reason = error instanceof Error ? error.message : "The proposal did not pass validation.";
        markRejected(app.db, proposal.id, Date.now());
        rejected.add(proposal.id);
        evidence.comparisons.push(result);
        continue;
      }
    }
    if (baseline && proposal?.status === "proposed") {
      if (!current(app, row) || proposal.baseRevisionId !== row.revisionId) throw new UsageError("The layout changed while its suggestions were being tested.");
      try {
        const compared = await compareWorkloadToBaseline(app, row.layoutId, proposal.ops, baseline, { revisionId: row.revisionId, suite: baseline.suite, policy: baseline.policy, signal }, deps);
        result.patchHash = compared.patchHash;
        result.verdict = ReviewWorkloadComparisonSchema.shape.verdict.parse(compared.comparison.verdict);
        result.reason = compared.comparison.allTasksAssessed ? null : "Some baseline or candidate tasks are unverified; missing evidence blocks an improvement claim.";
        result.tasks = compared.candidate.tasks.map(taskSummary);
        result.deltas = compared.comparison.deltas.map(({ id, physicalKeydowns, maxSimultaneousKeys }) => ({ id, physicalKeydowns, maxSimultaneousKeys }));
      } catch (error) {
        result.reason = signal.aborted ? "Workload testing stopped or reached its time limit." : error instanceof Error ? error.message : "Candidate testing failed.";
      }
    }
    evidence.comparisons.push(result);
    // Measurement claims come from the app, not the model's submission. The proposal still has its original rationale for inspection.
    item.title = item.keys.length ? `Try a change on ${item.keys.slice(0, 3).map((k) => `{key:${k.layerId}:${k.position}}`).join(", ")}` : "Try this config change";
    item.body = `${workloadVerdictWords[result.verdict]}.${result.reason ? ` ${result.reason}` : ""} These are firmware-test costs, not a claim about speed or comfort.`;
    if (!current(app, row)) throw new UsageError("The layout changed while its suggestions were being tested.");
  }
  saveReviewWorkload(app.db, row.id, evidence);
  const verdicts = new Map(evidence.comparisons.map((c) => [c.proposalId, c.verdict]));
  return items.filter((item) => item.proposalId === null || !rejected.has(item.proposalId)).sort((a, b) =>
    Number(b.proposalId !== null && verdicts.get(b.proposalId) === "verified-improvement") - Number(a.proposalId !== null && verdicts.get(a.proposalId) === "verified-improvement"));
}
