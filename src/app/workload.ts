// Read-only composition: snapshot -> bounded candidate trace -> real firmware -> independent HID assertions.
import { createHash } from "node:crypto";
import packageJson from "../../package.json" with { type: "json" };
import { ChangeOpSchema, type ChangeOp } from "../layout/change.ts";
import { deepEqual } from "../layout/equal.ts";
import { EVALUATOR_ID, HOST_ID, PLANNER_ID, compareWorkloadEvidence, evaluateWorkload, type WorkloadEvidence } from "../lab/workload/evaluate.ts";
import { checkWitness } from "../lab/workload/planner.ts";
import { DEFAULT_WORKLOAD_POLICY, WORKLOAD_LIMITS, WorkloadPolicySchema, WorkloadSuiteSchema, builtinWorkloadSuites, type WorkloadPolicy, type WorkloadSuite } from "../lab/workload/schema.ts";
import type { EmulationResult, EmulatorEvent } from "../firmware/emulate/types.ts";
import { functionHomes, reachableLayers } from "../validation/reachability.ts";
import { evaluate, standingIssues } from "../validation/validate.ts";
import type { App } from "./context.ts";
import { pinnedFor, decisionFactsFor } from "./decisions.ts";
import { emulateEvents, type EmulateEventsOptions } from "./emulate.ts";
import { EmulateFailedError } from "./firmware-errors.ts";
import { UsageError, ValidationFailedError } from "./errors.ts";
import { sourceFor } from "./firmware.ts";
import { getLayout, type LayoutView } from "./layouts.ts";

export { WorkloadSuiteSchema, WorkloadPolicySchema, WORKLOAD_LIMITS, DEFAULT_WORKLOAD_POLICY, builtinWorkloadSuites };
export type { WorkloadSuite, WorkloadPolicy, WorkloadEvidence };
export type WorkloadOptions = {
  suite?: unknown; builtin?: string; policy?: unknown; revisionId?: string; boardRevision?: string;
  onProgress?: (line: string) => void; onDiagnostic?: (message: string) => void; signal?: AbortSignal;
};
export type WorkloadDeps = { replay?: (app: App, view: LayoutView, events: readonly EmulatorEvent[], options: EmulateEventsOptions) => Promise<EmulationResult> };

export function resolveWorkloadSuite(input?: unknown, builtin?: string): WorkloadSuite {
  if (input !== undefined && builtin !== undefined) throw new UsageError("pass --suite or --builtin, not both");
  const raw = input === undefined ? builtinWorkloadSuites().find((s) => s.id === (builtin ?? "prose")) : input;
  if (raw === undefined) throw new UsageError(`unknown workload suite ${builtin}; use workload list`);
  const result = WorkloadSuiteSchema.safeParse(raw);
  if (!result.success) throw new UsageError(`invalid workload suite: ${result.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return result.data;
}
export async function readWorkloadSuite(path: string): Promise<WorkloadSuite> {
  const file = Bun.file(path);
  if (!await file.exists()) throw new UsageError(`can't read workload suite ${path}`);
  if (file.size > WORKLOAD_LIMITS.fileBytes) throw new UsageError(`workload suite exceeds ${WORKLOAD_LIMITS.fileBytes} bytes`);
  let input: unknown;
  try { input = JSON.parse(await file.text()); } catch { throw new UsageError("workload suite must be valid JSON"); }
  return resolveWorkloadSuite(input);
}

/** Stable serialization includes all own keys, including harmless prototype-looking IDs; no insertion-order dependency. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const workloadHash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

function prepare(view: LayoutView, opts: WorkloadOptions) {
  const suite = resolveWorkloadSuite(opts.suite, opts.builtin);
  const parsed = WorkloadPolicySchema.safeParse(opts.policy ?? DEFAULT_WORKLOAD_POLICY);
  if (!parsed.success) throw new UsageError(`invalid workload policy: ${parsed.error.message}`);
  const boardRevision = opts.boardRevision ?? view.board.definition.revisions[0]?.id;
  if (!boardRevision || !view.board.definition.revisions.some((r) => r.id === boardRevision)) throw new UsageError(`unknown board revision ${boardRevision}`);
  for (const task of suite.tasks) if (task.witness) {
    const problem = checkWitness(task.witness, view.board.definition.keyCount);
    if (problem) throw new UsageError(`task ${task.id}: ${problem}`);
  }
  return { suite, policy: parsed.data, boardRevision };
}

export type WorkloadReport = WorkloadEvidence & {
  schemaVersion: 1;
  identity: { layoutId: string; revisionId: string; layoutHash: string; boardHash: string; boardRevision: string; suiteHash: string; policyHash: string; sourceHash: string | null; evaluator: string; planner: string; host: string; generator: string; firmwarePin: string; buildRecipeHash: string };
  suite: WorkloadSuite; policy: WorkloadPolicy; structuralWarnings: string[]; assumptions: string[];
};
function requireNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EmulateFailedError("The workload evaluation was cancelled.");
}
function workloadIdentity(view: LayoutView, prepared: ReturnType<typeof prepare>): WorkloadReport["identity"] {
  const { suite, policy, boardRevision } = prepared;
  const revision = view.board.definition.revisions.find((r) => r.id === boardRevision);
  if (!revision) throw new UsageError(`unknown board revision ${boardRevision}`);
  const source = view.document.firmware === "kanata" ? null : sourceFor(view, boardRevision);
  return {
    layoutId: view.layout.id, revisionId: view.revision.id, layoutHash: workloadHash(view.document), boardHash: workloadHash(view.board), boardRevision,
    suiteHash: workloadHash(suite), policyHash: workloadHash(policy), sourceHash: source === null ? null : workloadHash(source),
    evaluator: EVALUATOR_ID, planner: PLANNER_ID, host: HOST_ID, generator: `keyloom-${packageJson.version}`, firmwarePin: revision.source.sha, buildRecipeHash: workloadHash(revision.build),
  };
}
async function evaluateView(app: App, view: LayoutView, prepared: ReturnType<typeof prepare>, opts: WorkloadOptions, deps: WorkloadDeps): Promise<WorkloadReport> {
  requireNotAborted(opts.signal);
  const { suite, policy, boardRevision } = prepared;
  const issues = standingIssues(view.board.definition, view.document);
  const fatal = issues.filter((i) => ["schema", "binding_count", "unknown_ref", "layer_limit"].includes(i.code));
  if (fatal.length) throw new ValidationFailedError("layout cannot be evaluated safely", { errors: fatal });
  const identity = workloadIdentity(view, prepared);
  const evidence = await evaluateWorkload(view.board.definition, view.document, suite, policy,
    async (events) => {
      requireNotAborted(opts.signal);
      const result = await (deps.replay ?? emulateEvents)(app, view, events, {
        boardRevision, cache: false, leadMs: 1000,
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}), ...(opts.signal ? { signal: opts.signal } : {}),
      });
      requireNotAborted(opts.signal);
      return result;
    }, (error) => {
      // Cancellation must leave the task loop, not become recoverable execution-error evidence.
      requireNotAborted(opts.signal);
      (opts.onDiagnostic ?? opts.onProgress)?.(error instanceof Error ? error.message : "firmware replay failed");
      requireNotAborted(opts.signal);
    });
  requireNotAborted(opts.signal);
  return { schemaVersion: 1, identity, suite, policy, ...evidence, structuralWarnings: issues.map((i) => `${i.code}: ${i.message}`), assumptions: [
    "Selected best-found witness in a restricted grammar; not exhaustive firmware reachability or a human strategy.",
    "Fresh firmware process and host state per task, US-ANSI with Caps Lock off, no repeat, compose, editor assistance or application outcomes.",
    "Only released physical keys and empty final HID are checked; hidden firmware state and hardware fidelity are not established.",
    "Counts describe one witness; finger assignments are board metadata, not measured motion or health/speed scores.",
    "Replay result caching is disabled; existing emulator build artifacts and diagnostic logs remain local.",
    "Firmware pin and build recipe identify configured inputs, not a measured running container/toolchain digest.",
  ] };
}
export async function evaluateStoredWorkload(app: App, ref: string, opts: WorkloadOptions = {}, deps: WorkloadDeps = {}): Promise<WorkloadReport> {
  const view = getLayout(app, ref, opts.revisionId);
  return evaluateView(app, view, prepare(view, opts), opts, deps);
}

export async function compareStoredWorkload(app: App, ref: string, ops: readonly ChangeOp[], opts: WorkloadOptions = {}, deps: WorkloadDeps = {}) {
  return compareCandidate(app, ref, ops, opts, deps);
}

/** A review reuses its own in-memory baseline; identity must still match every configured input. Never a saved approval. */
export async function compareWorkloadToBaseline(app: App, ref: string, ops: readonly ChangeOp[], baseline: WorkloadReport, opts: WorkloadOptions = {}, deps: WorkloadDeps = {}) {
  return compareCandidate(app, ref, ops, opts, deps, baseline);
}

async function compareCandidate(app: App, ref: string, ops: readonly ChangeOp[], opts: WorkloadOptions, deps: WorkloadDeps, measured?: WorkloadReport) {
  requireNotAborted(opts.signal);
  requireWorkloadOps(ops);
  const view = getLayout(app, ref, opts.revisionId);
  const prepared = prepare(view, opts);
  if (measured && !deepEqual(measured.identity, workloadIdentity(view, prepared))) throw new UsageError("workload baseline no longer matches the snapshot, suite or evaluator");
  const checked = checkCandidate(app, view, ops);
  const baseline = measured ?? await evaluateView(app, view, prepared, opts, deps);
  const candidate = await evaluateView(app, { ...view, document: checked.after }, prepared, opts, deps);
  return { schemaVersion: 1, patchHash: workloadHash(ops), validation: checked.result, baseline, candidate, comparison: compareWorkloadEvidence(baseline, candidate), saved: false, applied: false };
}

/** Review proposals must respect pins even when firmware measurement is unavailable. */
export function validateWorkloadPatch(app: App, ref: string, ops: readonly ChangeOp[], revisionId?: string): void {
  requireWorkloadOps(ops);
  checkCandidate(app, getLayout(app, ref, revisionId), ops);
}

function requireWorkloadOps(ops: readonly ChangeOp[]): void {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 256) throw new UsageError("workload comparison needs 1 to 256 change ops");
  for (const op of ops) if (!ChangeOpSchema.safeParse(op).success) throw new UsageError("invalid workload comparison change op");
}

function checkCandidate(app: App, view: LayoutView, ops: readonly ChangeOp[]) {
  const pins = pinnedFor(app, view.layout.id);
  const checked = evaluate(view.board.definition, view.document, ops, { pinned: pins, decisions: decisionFactsFor(app, view.layout.id) });
  if (!checked.result.ok || !checked.after) throw new ValidationFailedError("invalid workload comparison patch", checked.result);
  const after = checked.after;
  const beforeHomes = functionHomes(view.document, reachableLayers(view.document));
  const afterHomes = functionHomes(after, reachableLayers(after));
  for (const pin of pins) {
    const changedSlot = pin.slots.some((s) => !deepEqual(view.document.layers.find((l) => l.id === s.layerId)?.bindings[s.position], after.layers.find((l) => l.id === s.layerId)?.bindings[s.position]) || checked.result.diff.retuned.some((t) => t.layerId === s.layerId && t.position === s.position));
    const movedFunction = pin.functions.some((fn) => (beforeHomes.get(fn) ?? []).some((s) => !(afterHomes.get(fn) ?? []).some((t) => s.layerId === t.layerId && s.position === t.position)));
    if (changedSlot || movedFunction) throw new ValidationFailedError("workload comparison refuses a pinned binding or function move", { decisionId: pin.decisionId });
  }
  return { result: checked.result, after };
}
