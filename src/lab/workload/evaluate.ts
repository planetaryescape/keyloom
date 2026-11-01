import type { BoardDefinition } from "../../boards/schema.ts";
import type { EmulationResult, EmulatorEvent, EmulatorReport } from "../../firmware/emulate/types.ts";
import type { Layout } from "../../layout/schema.ts";
import { taskGoals, verifyOutput, type OutputVerification } from "./host.ts";
import { planTask, type Control, type WorkloadPlan } from "./planner.ts";
import { outputCount, type WorkloadPolicy, type WorkloadSuite } from "./schema.ts";

// Exact known fidelity disclosures, not a pattern matching escape hatch for omitted behavior.
export const SCOPE_WARNINGS = [
  "Matrix scanning, debounce and USB are not modelled: QMK sees each key event on a 1 ms scan.",
  "Oryx's RGB, layer LED and raw HID code is replaced by no-ops. It never changes what keys send.",
] as const;
// Reproduction identities: bump these when matching, candidate grammar or cost definitions change.
export const EVALUATOR_ID = "keyloom-workload-v1.0.1";
export const HOST_ID = "us-ansi-sequential-hid-v1";
export const PLANNER_ID = "direct-tap-side-modifiers-single-momentary-v1.0.1";

export type WorkloadCosts = {
  physicalKeydowns: number; physicalReleases: number; maxSimultaneousKeys: number;
  layerEntries: number | null; modifierEntries: number | null;
  byHand: Record<string, number>; byFinger: Record<string, number>;
  unknownHand: number; unknownFinger: number; sameFingerDifferentKeyTransitions: number; sameKeyRepeats: number;
};
export function traceCosts(board: BoardDefinition, events: readonly EmulatorEvent[], entries: Control[] | null): WorkloadCosts {
  const down = new Set<number>();
  const hands = new Map<string, number>(); const fingers = new Map<string, number>();
  let presses = 0; let releases = 0; let peak = 0; let unknownHand = 0; let unknownFinger = 0; let sameFinger = 0; let repeats = 0;
  let previous: { position: number; finger: string | undefined } | undefined;
  for (const event of events) {
    if (event.action === "release") { down.delete(event.position); releases++; continue; }
    down.add(event.position); presses++; peak = Math.max(peak, down.size);
    const left = board.hands.left.includes(event.position); const right = board.hands.right.includes(event.position);
    const hand = left !== right ? left ? "left" : "right" : undefined;
    // A bare finger label is only unambiguous when its hand is known. Never use inherited object properties.
    const label = Object.hasOwn(board.fingers, String(event.position)) ? board.fingers[String(event.position)] : undefined;
    const conflictingHand = label?.startsWith("left-") ? hand !== "left" : label?.startsWith("right-") ? hand !== "right" : false;
    const finger = hand && label && !conflictingHand ? `${hand}:${label.replace(/^(left|right)-/, "")}` : undefined;
    if (hand) hands.set(hand, (hands.get(hand) ?? 0) + 1); else unknownHand++;
    if (finger) fingers.set(finger, (fingers.get(finger) ?? 0) + 1); else unknownFinger++;
    if (previous?.position === event.position) repeats++;
    else if (previous?.finger && previous.finger === finger) sameFinger++;
    previous = { position: event.position, finger };
  }
  return {
    physicalKeydowns: presses, physicalReleases: releases, maxSimultaneousKeys: peak,
    layerEntries: entries === null ? null : entries.filter((e) => e.kind === "layer").length,
    modifierEntries: entries === null ? null : entries.filter((e) => e.kind === "modifier").length,
    byHand: Object.fromEntries([...hands].sort()), byFinger: Object.fromEntries([...fingers].sort()), unknownHand, unknownFinger,
    sameFingerDifferentKeyTransitions: sameFinger, sameKeyRepeats: repeats,
  };
}
export type WorkloadTaskResult = {
  id: string; requestedOutputs: number;
  status: Exclude<WorkloadPlan["status"], "planned"> | "verified" | "output-mismatch" | "warning-tainted" | "execution-error";
  reason: string | null; trace: EmulatorEvent[]; reports: EmulatorReport[];
  controlEntries: Control[] | null;
  verification: OutputVerification | null; warnings: string[]; scopeWarnings: string[];
  costs: WorkloadCosts | null; costsVerified: boolean; search: WorkloadPlan["search"];
};
export type WorkloadEvidence = {
  tasks: WorkloadTaskResult[];
  coverage: { totalTasks: number; verifiedTasks: number; requestedOutputs: number; verifiedOutputs: number };
};
export type WorkloadReplay = (events: readonly EmulatorEvent[]) => Promise<EmulationResult>;

export async function evaluateWorkload(
  board: BoardDefinition, layout: Layout, suite: WorkloadSuite, policy: WorkloadPolicy, replay: WorkloadReplay,
  onReplayError?: (error: unknown) => void,
): Promise<WorkloadEvidence> {
  const tasks: WorkloadTaskResult[] = [];
  for (const task of suite.tasks) {
    const plan = planTask(layout, task, policy);
    const row: WorkloadTaskResult = {
      id: task.id, requestedOutputs: outputCount(task), status: plan.status === "planned" ? "execution-error" : plan.status,
      reason: plan.reason, trace: plan.events, controlEntries: plan.entries, reports: [], verification: null, warnings: [], scopeWarnings: [],
      costs: plan.events.length ? traceCosts(board, plan.events, plan.entries) : null, costsVerified: false, search: plan.search,
    };
    if (layout.firmware === "kanata") { row.status = "unsupported"; row.reason = "Kanata has no production workload replay adapter"; row.trace = []; row.controlEntries = null; row.costs = null; }
    else if (plan.status === "planned") {
      try {
        const result = await replay(plan.events);
        row.reports = result.reports;
        row.warnings = result.warnings;
        row.scopeWarnings = result.warnings.filter((w) => SCOPE_WARNINGS.some((known) => known === w));
        row.verification = verifyOutput(taskGoals(task) ?? [], result.reports);
        if (result.firmware !== layout.firmware) { row.status = "execution-error"; row.reason = "replay firmware does not match the snapshot"; }
        else if (!row.verification.ok) { row.status = "output-mismatch"; row.reason = row.verification.reason; }
        else if (result.warnings.some((w) => !SCOPE_WARNINGS.some((known) => known === w))) { row.status = "warning-tainted"; row.reason = "emulator warnings prevent a correctness claim"; }
        else { row.status = "verified"; row.reason = null; row.costsVerified = true; }
      } catch (error) {
        onReplayError?.(error);
        row.status = "execution-error"; row.reason = "firmware build or replay failed; see diagnostics";
      }
    }
    tasks.push(row);
  }
  return { tasks, coverage: {
    totalTasks: tasks.length, verifiedTasks: tasks.filter((t) => t.status === "verified").length,
    requestedOutputs: tasks.reduce((n, t) => n + t.requestedOutputs, 0),
    verifiedOutputs: tasks.filter((t) => t.status === "verified").reduce((n, t) => n + t.requestedOutputs, 0),
  } };
}

/** Pareto comparison of the selected witnesses, not a universal keyboard score. Every task is protected. */
export function compareWorkloadEvidence(baseline: WorkloadEvidence, candidate: WorkloadEvidence) {
  const deltas = baseline.tasks.map((before, i) => {
    const after = candidate.tasks[i];
    let physicalKeydowns: number | null = null;
    let maxSimultaneousKeys: number | null = null;
    let physicalReleases: number | null = null;
    let layerEntries: number | null = null;
    let modifierEntries: number | null = null;
    if (before.status === "verified" && after?.status === "verified" && before.costs !== null && after.costs !== null && before.id === after.id && before.requestedOutputs === after.requestedOutputs) {
      physicalKeydowns = after.costs.physicalKeydowns - before.costs.physicalKeydowns;
      maxSimultaneousKeys = after.costs.maxSimultaneousKeys - before.costs.maxSimultaneousKeys;
      physicalReleases = after.costs.physicalReleases - before.costs.physicalReleases;
      if (before.costs.layerEntries !== null && after.costs.layerEntries !== null) layerEntries = after.costs.layerEntries - before.costs.layerEntries;
      if (before.costs.modifierEntries !== null && after.costs.modifierEntries !== null) modifierEntries = after.costs.modifierEntries - before.costs.modifierEntries;
    }
    return { id: before.id, baselineStatus: before.status, candidateStatus: after?.status ?? "unsupported",
      physicalKeydowns, maxSimultaneousKeys, physicalReleases, layerEntries, modifierEntries,
    };
  });
  const complete = baseline.tasks.length > 0 && baseline.tasks.length === candidate.tasks.length && deltas.every((d) => d.physicalKeydowns !== null && d.maxSimultaneousKeys !== null);
  const better = deltas.some((d) => (d.physicalKeydowns ?? 0) < 0 || (d.maxSimultaneousKeys ?? 0) < 0);
  const worse = deltas.some((d) => (d.physicalKeydowns ?? 0) > 0 || (d.maxSimultaneousKeys ?? 0) > 0);
  // Protection is the gate's policy: missing evidence blocks improvement; it does not remove a task's protection.
  return { objectives: ["physicalKeydowns", "maxSimultaneousKeys"], allTasksProtected: true, allTasksAssessed: complete,
    verdict: !complete ? "inconclusive" : better && !worse ? "verified-improvement" : worse && better ? "tradeoff" : worse ? "regression" : "equivalent",
    deltas };
}
