// Candidate route generator, never a firmware interpreter or verification authority (D-075).
import type { EmulatorEvent } from "../../firmware/emulate/types.ts";
import type { Binding, Layout } from "../../layout/schema.ts";
import { sameMods, taskGoals, type Goal } from "./host.ts";
import { WORKLOAD_LIMITS, type WorkloadPolicy, type WorkloadTask } from "./schema.ts";

export type Control = { position: number; kind: "layer" | "modifier" };
type Route = { controls: Control[]; position: number };
type State = { controls: Control[]; events: EmulatorEvent[]; entries: Control[]; presses: number; peak: number };
export type WorkloadPlan = {
  status: "planned" | "unsupported" | "no-route-within-supported-subset" | "search-limit";
  reason: string | null; events: EmulatorEvent[]; entries: Control[] | null;
  search: { expansions: number; truncated: boolean; strategy: "supplied-witness" | "bounded-routes" };
};
const MOD_KEYS = new Map([["LEFT_CTRL", "LCTL"], ["LEFT_SHIFT", "LSFT"], ["LEFT_ALT", "LALT"], ["LEFT_GUI", "LGUI"], ["RIGHT_CTRL", "RCTL"], ["RIGHT_SHIFT", "RSFT"], ["RIGHT_ALT", "RALT"], ["RIGHT_GUI", "RGUI"]]);
function modifiers(b: Binding | undefined): string[] | undefined {
  if (b?.kind === "modifier") return b.mods;
  if (b?.kind !== "key" || b.mods?.length) return undefined;
  const mod = MOD_KEYS.get(b.code);
  return mod === undefined ? undefined : [mod];
}
const controlKey = (cs: readonly Control[]) => cs.map((c) => `${c.kind}:${c.position}`).join(",");
const compare = (a: State, b: State) => a.presses - b.presses || a.peak - b.peak || (JSON.stringify(a.events) < JSON.stringify(b.events) ? -1 : JSON.stringify(a.events) > JSON.stringify(b.events) ? 1 : 0);

export function checkWitness(events: readonly EmulatorEvent[], keyCount: number): string | null {
  const down = new Set<number>();
  let at = -1;
  for (const event of events) {
    if (event.position >= keyCount) return "witness position is outside this board";
    if (event.at < at) return "witness times must be ordered";
    at = event.at;
    if (event.action === "press") {
      if (down.has(event.position)) return "witness presses an already held position";
      down.add(event.position);
    } else if (!down.delete(event.position)) return "witness releases a position that is not held";
  }
  return down.size ? "witness must release every physical key" : null;
}

export function planTask(layout: Layout, task: WorkloadTask, policy: WorkloadPolicy): WorkloadPlan {
  let expansions = 0;
  let truncated = false;
  const search = () => ({ expansions, truncated, strategy: task.witness ? "supplied-witness" as const : "bounded-routes" as const });
  const stop = (status: WorkloadPlan["status"], reason: string): WorkloadPlan => ({ status, reason, events: [], entries: null, search: search() });
  const goals = taskGoals(task);
  if (!goals) return stop("unsupported", "text is outside the literal US-ANSI host mapping; no normalization is performed");
  if (task.witness) return { status: "planned", reason: null, events: task.witness.map((e) => ({ ...e })), entries: null, search: search() };
  const base = layout.layers[0];
  if (!base) return stop("unsupported", "no base layer");
  const contexts: { bindings: readonly Binding[]; controls: Control[] }[] = [{ bindings: base.bindings, controls: [] }];
  for (const [position, b] of base.bindings.entries()) {
    if (b.kind !== "layer" || b.action !== "momentary" || b.layerId === base.id) continue;
    const layer = layout.layers.find((l) => l.id === b.layerId);
    if (layer) contexts.push({ bindings: layer.bindings.map((binding, p) => binding.kind === "transparent" ? base.bindings[p] ?? { kind: "none" } : binding), controls: [{ position, kind: "layer" }] });
  }
  const spend = () => { if (expansions >= policy.maxExpansions) { truncated = true; return false; } expansions++; return true; };
  const routesFor = (goal: Goal): Route[] => {
    const routes: Route[] = [];
    for (const context of contexts) {
      const modKeys = context.bindings.flatMap((b, position) => {
        const mods = modifiers(b);
        return mods && !context.controls.some((c) => c.position === position) ? [{ position, mods }] : [];
      });
      for (const [position, b] of context.bindings.entries()) {
        // An ordinary short tap is only a candidate for a modelled hold-tap's key side. Firmware replay must establish what it did.
        const tap = b.kind === "key" ? b : b.kind === "holdTap" && !b.tap.macroId ? b.tap : undefined;
        if (!tap || tap.code !== goal.key || context.controls.some((c) => c.position === position)) continue;
        for (const wanted of goal.modChoices) {
          const implicit = tap.mods ?? [];
          if (implicit.some((m) => !wanted.includes(m))) continue;
          const cover = (index: number, mods: string[], controls: Control[]) => {
            if (!spend()) return;
            if (sameMods(mods, wanted)) {
              if (routes.length >= policy.maxRoutes) { truncated = true; return; }
              routes.push({ position, controls: [...context.controls, ...controls] }); return;
            }
            for (let i = index; i < modKeys.length; i++) {
              const key = modKeys[i];
              if (!key || key.position === position || key.mods.some((m) => !wanted.includes(m)) || key.mods.every((m) => mods.includes(m))) continue;
              cover(i + 1, [...new Set([...mods, ...key.mods])], [...controls, { position: key.position, kind: "modifier" }]);
              if (truncated && expansions >= policy.maxExpansions) return;
            }
          };
          cover(0, [...new Set(implicit)], []);
        }
      }
    }
    return routes;
  };
  let states: State[] = [{ controls: [], events: [], entries: [], presses: 0, peak: 0 }];
  const routeCache = new Map<string, Route[]>();
  for (const goal of goals) {
    const key = JSON.stringify(goal);
    let routes = routeCache.get(key);
    if (!routes) { routes = routesFor(goal); routeCache.set(key, routes); }
    if (!routes.length) return stop(truncated ? "search-limit" : layout.layers.some((l) => l.bindings.some((b) => ["native", "macro", "tapDance", "holdTap"].includes(b.kind))) ? "unsupported" : "no-route-within-supported-subset", "no complete route found in direct keys/short tap-side candidates, explicit modifiers and one base-accessed momentary layer; other semantics are not searched");
    const next = new Map<string, State>();
    for (const state of states) {
      for (const route of routes) {
        if (!spend()) break;
        let common = 0;
        while (state.controls[common] && route.controls[common] && state.controls[common]?.kind === route.controls[common]?.kind && state.controls[common]?.position === route.controls[common]?.position) common++;
        const released = state.controls.slice(common).reverse();
        const pressed = route.controls.slice(common);
        const actions = [
          ...released.map((c) => ({ position: c.position, action: "release" as const })),
          ...pressed.map((c) => ({ position: c.position, action: "press" as const })),
          { position: route.position, action: "press" as const }, { position: route.position, action: "release" as const },
        ];
        const events = [...state.events, ...actions.map((e, i) => ({ ...e, at: (state.events.length + i) * policy.eventMs }))];
        const lastEventAt = (events.length + route.controls.length - 1) * policy.eventMs;
        if (events.length + route.controls.length > WORKLOAD_LIMITS.events || lastEventAt > WORKLOAD_LIMITS.durationMs) { truncated = true; continue; }
        const candidate: State = { controls: route.controls, events, entries: [...state.entries, ...pressed], presses: state.presses + pressed.length + 1, peak: Math.max(state.peak, route.controls.length + 1) };
        const id = controlKey(route.controls);
        const prior = next.get(id);
        if (!prior || compare(candidate, prior) < 0) next.set(id, candidate);
      }
    }
    states = [...next.values()].sort(compare);
    if (states.length > policy.maxStates) { states = states.slice(0, policy.maxStates); truncated = true; }
    if (!states.length) return stop("search-limit", "search/event budget exhausted before a complete task witness");
  }
  const selected = states.sort(compare)[0];
  if (!selected) return stop("search-limit", "no complete task witness");
  const events = [...selected.events, ...[...selected.controls].reverse().map((c, i) => ({ position: c.position, action: "release" as const, at: (selected.events.length + i) * policy.eventMs }))];
  return { status: "planned", reason: null, events, entries: selected.entries, search: search() };
}
