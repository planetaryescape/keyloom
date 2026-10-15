// Which layer of one layout does the same job as which layer of another (20#layers). Three signals,
// each scored 0 to 1: the layers' names, their role (the base layer is the base layer on any board),
// and how much of what the layers do is the same (Jaccard overlap of their functions). The best
// signal sets a layer's score, and layers pair one-to-one, best first, so two layers never claim the
// same partner. Pure.
import { bindingFunctions } from "./functions.ts";
import type { Layer, Layout } from "./schema.ts";

export type LayerMatchMethod = "role" | "name" | "similar-name" | "function-overlap";

export type LayerMatch = {
  sourceLayerId: string;
  /** Null when no layer of the target is close enough to count as the same one. */
  targetLayerId: string | null;
  score: number;
  method: LayerMatchMethod | null;
  signals: { name: number; role: number; overlap: number };
};

/** Below this the layers share too little to be called the same job. */
export const LAYER_MATCH_MIN = 0.3;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "Navigation" and "navigate" share a stem; "Layer 4" and "Layer 5" must not, so a name with a number only matches exactly. */
function nameScore(a: string, b: string): { score: number; method: "name" | "similar-name" | null } {
  const x = norm(a);
  const y = norm(b);
  if (x === "" || y === "") return { score: 0, method: null };
  if (x === y) return { score: 1, method: "name" };
  if (/\d/.test(x) || /\d/.test(y)) return { score: 0, method: null };
  const stem = (s: string) => s.replace(/(ation|ate|ing|ion|s)$/, "");
  const p = stem(x);
  const q = stem(y);
  if (p.length >= 4 && q.length >= 4 && (p.startsWith(q) || q.startsWith(p) || p.slice(0, 5) === q.slice(0, 5))) return { score: 0.7, method: "similar-name" };
  return { score: 0, method: null };
}

/** What a layer does, as a set; layer-switching keys are left out because layer ids differ between layouts. */
function functionSet(layout: Layout, layer: Layer): Set<string> {
  const out = new Set<string>();
  for (const b of layer.bindings) {
    for (const f of bindingFunctions(b, layout.tapDances)) if (!f.startsWith("layer:") && !f.startsWith("native:") && !f.startsWith("macro:")) out.add(f);
  }
  return out;
}

export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

export function matchLayers(source: Layout, target: Layout): LayerMatch[] {
  const sets = {
    source: source.layers.map((l) => functionSet(source, l)),
    target: target.layers.map((l) => functionSet(target, l)),
  };
  type Candidate = { s: number; t: number; score: number; method: LayerMatchMethod; signals: LayerMatch["signals"] };
  const candidates: Candidate[] = [];
  source.layers.forEach((sl, s) => {
    target.layers.forEach((tl, t) => {
      const name = nameScore(sl.name, tl.name);
      const role = s === 0 && t === 0 ? 1 : 0;
      const overlap = jaccard(sets.source[s] as Set<string>, sets.target[t] as Set<string>);
      // The base layer is the base layer by definition; otherwise the strongest signal decides.
      const best: [number, LayerMatchMethod][] = [[role, "role"], [name.score, name.method ?? "name"], [overlap, "function-overlap"]];
      const [score, method] = best.reduce((a, b) => (b[0] > a[0] ? b : a));
      if (score >= LAYER_MATCH_MIN) candidates.push({ s, t, score, method, signals: { name: name.score, role, overlap } });
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.s - b.s || a.t - b.t);

  const usedS = new Set<number>();
  const usedT = new Set<number>();
  const picked = new Map<number, Candidate>();
  for (const c of candidates) {
    if (usedS.has(c.s) || usedT.has(c.t)) continue;
    usedS.add(c.s);
    usedT.add(c.t);
    picked.set(c.s, c);
  }
  return source.layers.map((sl, s): LayerMatch => {
    const c = picked.get(s);
    if (c !== undefined) return { sourceLayerId: sl.id, targetLayerId: (target.layers[c.t] as Layer).id, score: round2(c.score), method: c.method, signals: roundSignals(c.signals) };
    // Even an unmatched layer reports its signals against the best candidate, so "why not" can be answered.
    const overlap = Math.max(0, ...sets.target.map((t) => jaccard(sets.source[s] as Set<string>, t)));
    return { sourceLayerId: sl.id, targetLayerId: null, score: 0, method: null, signals: { name: 0, role: 0, overlap: round2(overlap) } };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundSignals = (s: LayerMatch["signals"]) => ({ name: round2(s.name), role: s.role, overlap: round2(s.overlap) });
