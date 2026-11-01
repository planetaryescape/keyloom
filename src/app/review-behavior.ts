// Affected behavior checks use real firmware and independent HID expectations, never the model's account of a change.
import { applyOps } from "../layout/apply-ops.ts";
import { deepEqual } from "../layout/equal.ts";
import { keptDefinitions, parseCalls } from "../layout/kept-behaviours.ts";
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
function matches(expected: Stroke[], reports: readonly EmulatorReport[], holdReleaseAt: number): boolean {
  let down: string[] = []; let mods: string[] = []; let used = 0; let previousAt = -Infinity;
  for (const r of reports) {
    if (!Number.isFinite(r.at) || r.at < 0 || r.at < previousAt) return false;
    previousAt = r.at;
    if (r.kind !== "keyboard") { if (r.usages.length) return false; continue; }
    if (new Set(r.keys).size !== r.keys.length || new Set(r.mods).size !== r.mods.length) return false;
    if (r.at < holdReleaseAt && r.keys.some((key) => down.includes(key)) && !deepEqual([...mods].sort(), [...r.mods].sort())) return false;
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
  const definition = (doc: typeof after, b: Binding | undefined) => b?.kind === "macro" ? doc.macros.find((m) => m.id === b.macroId)
    : b?.kind === "tapDance" ? { dance: doc.tapDances.find((d) => d.id === b.tapDanceId), macros: doc.macros }
    : b?.kind === "holdTap" ? { profile: doc.holdTapProfiles.find((p) => p.id === b.profileId), macros: b.tap.macroId ? doc.macros : [] } : undefined;
  for (const collection of ["combos", "macros", "tapDances", "conditionalLayers", "settings", "passthrough"] as const) {
    if (!deepEqual(before[collection], after[collection])) unsupported(collection, "Changed non-key behavior has no independent runtime oracle yet.");
  }
  for (const layer of before.layers) if (!after.layers.some((l) => l.id === layer.id)) unsupported(`{layer:${layer.id}}`, "Removed layer behavior is not replayed.");
  for (const layer of after.layers) for (const [position, binding] of layer.bindings.entries()) {
    const old = before.layers.find((l) => l.id === layer.id)?.bindings[position];
    const profile = binding.kind === "holdTap" ? after.holdTapProfiles.find((p) => p.id === binding.profileId) : undefined;
    if (deepEqual(old, binding) && deepEqual(definition(before, old), definition(after, binding))) continue;
    const name = `{key:${layer.id}:${position}}`;
    if (binding.kind !== "holdTap" && binding.kind !== "native" && binding.kind !== "layer") { unsupported(name, "This changed action has no independent runtime oracle yet."); continue; }
    if (layer.id !== after.layers[0]?.id || cases.length >= 24) { unsupported(name, "Nested layer context or the bounded case limit is not covered."); continue; }
    if (binding.kind === "holdTap" && binding.tap.code && !binding.tap.macroId && "mods" in binding.hold) {
      const other = layer.bindings.findIndex((b, i) => i !== position && b.kind === "key");
      const key = stroke(layer.bindings[other]);
      if (!key) { unsupported(name, "A plain key is needed as an independent chord witness."); continue; }
      const tap = { key: binding.tap.code, mods: binding.tap.mods ?? [] };
      const globals = Object.fromEntries(after.settings.filter((s) => s.firmware === after.firmware).map((s) => [s.key, s.value]));
      const options = { ...globals, ...profile?.options };
      const term = Number(options["tapping-term-ms"] ?? options.TAPPING_TERM ?? 200);
      if (!Number.isFinite(term) || term < 50 || term > 1000) { unsupported(name, "The tapping term is outside the bounded timing suite."); continue; }
      const held = term + 150;
      cases.push(
        { name: `${name}: tap`, events: [e(0, position, "press"), e(30, position, "release")], expected: [tap] },
        { name: `${name}: hold chord`, events: [e(0, position, "press"), e(held, other, "press"), e(held + 30, other, "release"), e(held + 60, position, "release")], expected: [{ key: key.key, mods: [...new Set([...key.mods, ...binding.hold.mods])] }] },
        { name: `${name}: hold release`, events: [e(0, position, "press"), e(held, other, "press"), e(held + 20, other, "release"), e(held + 40, position, "release"), e(held + 100, other, "press"), e(held + 130, other, "release")], expected: [{ key: key.key, mods: [...new Set([...key.mods, ...binding.hold.mods])] }, key] },
      );
      const knownOptions = after.firmware === "zmk" ? ["flavor", "tapping-term-ms"] : ["TAPPING_TERM", "QUICK_TAP_TERM", "PERMISSIVE_HOLD", "HOLD_ON_OTHER_KEY_PRESS"];
      const unknown = Object.keys(options).some((key) => !knownOptions.includes(key));
      const flavor = options.flavor;
      const knownFlavor = after.firmware === "qmk" || ["tap-preferred", "hold-preferred", "balanced"].includes(String(flavor));
      if (unknown || !knownFlavor || (after.firmware === "qmk" && after.passthrough.some((p) => p.firmware === "qmk"))) {
        unsupported(`${name}: rolling tap`, "Effective interrupt/timing settings are outside the independent rolling oracle.");
      } else {
        const hold = after.firmware === "zmk" ? flavor === "hold-preferred" : options.HOLD_ON_OTHER_KEY_PRESS === true;
        cases.splice(cases.length - 1, 0, { name: `${name}: rolling tap`, events: [e(0, position, "press"), e(20, other, "press"), e(30, position, "release"), e(50, other, "release")], expected: hold ? [{ key: key.key, mods: [...new Set([...key.mods, ...binding.hold.mods])] }] : [tap, key] });
      }
    } else {
      const reading = binding.kind === "native" ? readNative(binding, keptDefinitions(after.passthrough)) : undefined;
      const target = binding.kind === "layer" && binding.action === "momentary" ? binding.layerId : reading?.kind === "holdLayer" ? reading.layerId : undefined;
      if (reading?.kind === "holdLayer") unsupported(`${name}: custom tap`, `The tap calls ${reading.tap}; non-HID effects are retained in source but are not measured by HID reports.`);
      if (!target) { unsupported(name, "This compound or custom behavior has no independent runtime oracle yet."); continue; }
      let held = 1200;
      if (binding.kind === "native") {
        const label = parseCalls(binding.source)?.[0]?.name;
        const term = (label ? keptDefinitions(after.passthrough).get(label)?.tappingTermMs : undefined) ?? NaN;
        if (!Number.isFinite(term) || term < 1 || term > 5000) { unsupported(name, "The custom tapping term cannot be established within the bounded timing suite."); continue; }
        held = term + 150;
      }
      const targetLayer = after.layers.find((l) => l.id === target);
      const other = targetLayer?.bindings.findIndex((b, i) => i !== position && b.kind === "key" && layer.bindings[i]?.kind === "key" && !deepEqual(b, layer.bindings[i])) ?? -1;
      const onLayer = stroke(targetLayer?.bindings[other]); const onBase = stroke(layer.bindings[other]);
      if (!onLayer || !onBase) { unsupported(name, "No distinct plain-key witness establishes both the target layer and its release."); continue; }
      cases.push({ name: `${name}: layer hold and release`, events: [e(0, position, "press"), e(held, other, "press"), e(held + 30, other, "release"), e(held + 60, position, "release"), e(held + 200, other, "press"), e(held + 230, other, "release")], expected: [onLayer, onBase] });
    }
  }
  const replay = opts.replay ?? emulateEvents;
  for (const c of cases) {
    if (opts.signal.aborted) { unsupported(c.name, "Testing was cancelled."); continue; }
    try {
      const result = await replay(app, { ...view, document: after }, c.events, { boardRevision: view.board.definition.revisions[0]!.id, signal: opts.signal, cache: false });
      const warnings = result.warnings.filter((w) => !SCOPE_WARNINGS.some((known) => known === w));
      const holdReleaseAt = c.events.find((event) => event.position === c.events[0]?.position && event.action === "release")?.at ?? Infinity;
      const correct = result.firmware === after.firmware && matches(c.expected, result.reports, holdReleaseAt);
      evidence.checks.push({ name: c.name, status: warnings.length ? "unsupported" : correct ? "verified" : "failed",
        reason: warnings.length ? warnings.join(" ") : correct ? null : "HID output or final release did not match the independently expected actions." });
    } catch (error) { unsupported(c.name, error instanceof Error ? error.message : "Firmware replay failed."); }
  }
  evidence.status = evidence.checks.some((c) => c.status === "failed") ? "failed" : evidence.checks.length > 0 && evidence.checks.every((c) => c.status === "verified") ? "verified" : "partial";
  if (!evidence.checks.length) evidence.limitations.push("No supported affected compound behavior was identified; selected workload checks do not cover every changed action.");
  return evidence;
}
