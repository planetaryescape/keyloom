// Affected behavior checks use real firmware and independent HID expectations, never the model's account of a change.
import { applyOps } from "../layout/apply-ops.ts";
import { deepEqual } from "../layout/equal.ts";
import { keptDefinitions } from "../layout/kept-behaviours.ts";
import { readNative } from "../layout/native-read.ts";
import type { ChangeOp } from "../layout/change.ts";
import type { Binding } from "../layout/schema.ts";
import type { BehaviorEvidence } from "../layout/review-evidence.ts";
import type { EmulatorEvent, EmulatorReport } from "../firmware/emulate/types.ts";
import { SCOPE_WARNINGS } from "../lab/workload/evaluate.ts";
import type { App } from "./context.ts";
import type { LayoutView } from "./layouts.ts";
import { emulateEvents } from "./emulate.ts";
import type { WorkloadDeps } from "./workload.ts";

type Stroke = { key: string; mods: string[] };
type Case = { name: string; events: EmulatorEvent[]; expected: Stroke[] };
const e = (at: number, position: number, action: "press" | "release"): EmulatorEvent => ({ at, position, action });
const stroke = (binding: Binding | undefined): Stroke | undefined => binding?.kind === "key" ? { key: binding.code, mods: binding.mods ?? [] } : undefined;

/** Allows overlapping physical rolls but checks every output keydown, its exact modifiers and the final release. */
function matches(expected: Stroke[], reports: readonly EmulatorReport[]): boolean {
  let down: string[] = []; let mods: string[] = []; let used = 0; let previousAt = -Infinity;
  for (const r of reports) {
    if (!Number.isFinite(r.at) || r.at < 0 || r.at < previousAt) return false;
    previousAt = r.at;
    if (r.kind !== "keyboard") { if (r.usages.length) return false; continue; }
    if (new Set(r.keys).size !== r.keys.length || new Set(r.mods).size !== r.mods.length) return false;
    const newlyDown = r.keys.filter((key) => !down.includes(key));
    if (newlyDown.length > 1) return false;
    for (const key of newlyDown) {
      const goal = expected[used++];
      if (!goal || goal.key !== key || !deepEqual([...goal.mods].sort(), [...r.mods].sort())) return false;
    }
    if (r.mods.some((mod) => !expected.some((goal) => goal.mods.includes(mod)))) return false;
    down = r.keys; mods = r.mods;
  }
  return used === expected.length && down.length === 0 && mods.length === 0;
}

export async function assessAffectedBehavior(app: App, view: LayoutView, ops: readonly ChangeOp[], opts: WorkloadDeps & { enabled: boolean; signal: AbortSignal }): Promise<BehaviorEvidence> {
  const evidence: BehaviorEvidence = { status: "not-tested", checks: [], limitations: ["These are bounded firmware HID checks, not evidence of typing speed, comfort or all possible timing sequences. Lighting, wireless, physical switches and USB are not verified."] };
  if (!opts.enabled) { evidence.limitations.push("Affected behavior replay is off or unavailable. Select activities and make sure firmware tests can run; source checks only."); return evidence; }
  const applied = applyOps(view.document, ops);
  if (!applied.ok) { evidence.status = "failed"; return evidence; }
  const before = view.document; const after = applied.layout;
  const cases: Case[] = [];
  const unsupported = (name: string, reason: string) => evidence.checks.push({ name, status: "unsupported", reason });
  for (const layer of after.layers) for (const [position, binding] of layer.bindings.entries()) {
    const old = before.layers.find((l) => l.id === layer.id)?.bindings[position];
    const oldProfile = old?.kind === "holdTap" ? before.holdTapProfiles.find((p) => p.id === old.profileId) : undefined;
    const profile = binding.kind === "holdTap" ? after.holdTapProfiles.find((p) => p.id === binding.profileId) : undefined;
    if (deepEqual(old, binding) && deepEqual(oldProfile, profile)) continue;
    if (binding.kind !== "holdTap" && binding.kind !== "native" && binding.kind !== "layer") continue;
    const name = `${layer.id}/${position}`;
    if (layer.id !== after.layers[0]?.id || cases.length >= 24) { unsupported(name, "Nested layer context or the bounded case limit is not covered."); continue; }
    if (binding.kind === "holdTap" && binding.tap.code && !binding.tap.macroId && "mods" in binding.hold) {
      const other = layer.bindings.findIndex((b, i) => i !== position && b.kind === "key");
      const key = stroke(layer.bindings[other]);
      if (!key) { unsupported(name, "A plain key is needed as an independent chord witness."); continue; }
      const tap = { key: binding.tap.code, mods: binding.tap.mods ?? [] };
      const term = Number(profile?.options["tapping-term-ms"] ?? profile?.options.TAPPING_TERM ?? 200);
      if (!Number.isFinite(term) || term < 50 || term > 1000) { unsupported(name, "The tapping term is outside the bounded timing suite."); continue; }
      const held = term + 150;
      cases.push(
        { name: `${name}: tap`, events: [e(0, position, "press"), e(30, position, "release")], expected: [tap] },
        { name: `${name}: hold chord`, events: [e(0, position, "press"), e(held, other, "press"), e(held + 30, other, "release"), e(held + 60, position, "release")], expected: [{ key: key.key, mods: [...new Set([...key.mods, ...binding.hold.mods])] }] },
        { name: `${name}: rolling tap`, events: [e(0, position, "press"), e(20, other, "press"), e(30, position, "release"), e(50, other, "release")], expected: [tap, key] },
        { name: `${name}: hold release`, events: [e(0, position, "press"), e(held, other, "press"), e(held + 20, other, "release"), e(held + 40, position, "release"), e(held + 100, other, "press"), e(held + 130, other, "release")], expected: [{ key: key.key, mods: [...new Set([...key.mods, ...binding.hold.mods])] }, key] },
      );
    } else {
      const reading = binding.kind === "native" ? readNative(binding, keptDefinitions(after.passthrough)) : undefined;
      const target = binding.kind === "layer" && binding.action === "momentary" ? binding.layerId : reading?.kind === "holdLayer" ? reading.layerId : undefined;
      if (reading?.kind === "holdLayer") unsupported(`${name}: custom tap`, `The tap calls ${reading.tap}; non-HID effects are retained in source but are not measured by HID reports.`);
      if (!target) { unsupported(name, "This compound or custom behavior has no independent runtime oracle yet."); continue; }
      const targetLayer = after.layers.find((l) => l.id === target);
      const other = targetLayer?.bindings.findIndex((b, i) => i !== position && b.kind === "key" && layer.bindings[i]?.kind === "key" && !deepEqual(b, layer.bindings[i])) ?? -1;
      const onLayer = stroke(targetLayer?.bindings[other]); const onBase = stroke(layer.bindings[other]);
      if (!onLayer || !onBase) { unsupported(name, "No distinct plain-key witness establishes both the target layer and its release."); continue; }
      cases.push({ name: `${name}: layer hold and release`, events: [e(0, position, "press"), e(1200, other, "press"), e(1230, other, "release"), e(1260, position, "release"), e(1400, other, "press"), e(1430, other, "release")], expected: [onLayer, onBase] });
    }
  }
  const replay = opts.replay ?? emulateEvents;
  for (const c of cases) {
    if (opts.signal.aborted) { unsupported(c.name, "Testing was cancelled."); continue; }
    try {
      const result = await replay(app, { ...view, document: after }, c.events, { boardRevision: view.board.definition.revisions[0]!.id, signal: opts.signal, cache: false });
      const warnings = result.warnings.filter((w) => !SCOPE_WARNINGS.some((known) => known === w));
      const correct = result.firmware === after.firmware && matches(c.expected, result.reports);
      evidence.checks.push({ name: c.name, status: warnings.length ? "unsupported" : correct ? "verified" : "failed",
        reason: warnings.length ? warnings.join(" ") : correct ? null : "HID output or final release did not match the independently expected actions." });
    } catch (error) { unsupported(c.name, error instanceof Error ? error.message : "Firmware replay failed."); }
  }
  evidence.status = evidence.checks.some((c) => c.status === "failed") ? "failed" : evidence.checks.length > 0 && evidence.checks.every((c) => c.status === "verified") ? "verified" : "partial";
  if (!evidence.checks.length) evidence.limitations.push("No supported affected compound behavior was identified; selected workload checks do not cover every changed action.");
  return evidence;
}
