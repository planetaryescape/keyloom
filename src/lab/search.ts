// The counterfactual search (D-282): the same recording replayed through candidate settings, each scored by the misfires it removes minus
// the ones it introduces. An emulator run builds firmware, so runs are the cost. Two things keep them few:
//  - candidates for different hold-tap profiles are independent (a key's decision depends on its own profile and the keys around it), so
//    one run tries one candidate for every profile at once and credits each profile with what happened on its own keys;
//  - the search is coarse to fine: big steps first, then the neighbours of the best step, then the best of each kind together.
// A budget bounds the runs; when it runs out, the candidates not yet tried are named in `notes`.
import type { BoardDefinition } from "../boards/schema.ts";
import type { ChangeOp } from "../layout/change.ts";
import { applyOps } from "../layout/apply-ops.ts";
import type { Layout } from "../layout/schema.ts";
import { type Candidate, type Bias, layoutCandidates, opsOf, profileCandidates, refine } from "./candidates.ts";
import { type Issue } from "../validation/result.ts";
import { validate } from "../validation/validate.ts";
import { type Difference, type MisfireFacts, isMisfire } from "./classify.ts";

/** What one replay says about the firmware's decisions: only the misfires matter to the search. */
export type Measure = (layout: Layout) => Promise<Difference[]>;

export type Example = {
  kind: "misfire-hold" | "misfire-tap";
  /** The key that misfired, then the key after it, by position. */
  position: number;
  nextPosition?: number;
  facts: MisfireFacts;
};

export type Evidence = {
  scope: "profile" | "layout";
  profileId?: string;
  /** Misfires on the keys this suggestion changes, before and after. */
  before: number;
  after: number;
  removed: number;
  introduced: number;
  /** Misfires it removes, for the proposal card. */
  examples: Example[];
  /** Misfires it would introduce, so the cost is as visible as the gain. */
  newProblems: Example[];
};

export type Suggestion = { candidate: Candidate; evidence: Evidence; ops: ChangeOp[] };

/** A suggestion is clear when it removes at least this many misfires, at least as many as twice those it introduces. */
export const MIN_NET_GAIN = 2;
export const MAX_RUNS = 12;

export type SearchResult = {
  suggestions: Suggestion[];
  /** Emulator runs spent, not counting the baseline the caller already made. */
  runs: number;
  /** True when the search went coarse to fine or was cut by the budget. */
  coarse: boolean;
  notes: string[];
};

type Scored = { candidate: Candidate; evidence: Evidence; net: number };

const exampleOf = (d: Difference & { kind: "misfire-hold" | "misfire-tap" }): Example => ({
  kind: d.kind, position: d.position as number, ...(d.facts?.nextPosition === undefined ? {} : { nextPosition: d.facts.nextPosition }), facts: d.facts as MisfireFacts,
});

/** The profile a position uses in the layout being tuned. A candidate may rebind keys to a new profile, so a replay's own bindings cannot say. */
type ProfileAt = (position: number | undefined) => string | undefined;

function score(baseline: readonly Difference[], after: readonly Difference[], candidate: Candidate, profileAt: ProfileAt, firstLayerId?: string): Scored {
  const misfires = (list: readonly Difference[]) => list.filter(isMisfire);
  // Keys the candidate rebinds from another profile are in its scope too, so what it does to them is counted.
  const movedHere = (d: Difference) => (candidate.moved ?? []).some((m) => m.at.layerId === firstLayerId && m.at.position === d.position);
  const inScope = (d: Difference) => candidate.scope.kind === "layout" || profileAt(d.position) === candidate.scope.profileId || movedHere(d);
  const before = misfires(baseline).filter(inScope);
  const now = misfires(after).filter(inScope);
  const had = new Set(before.map((d) => d.pressIndex));
  const has = new Set(now.map((d) => d.pressIndex));
  const removed = before.filter((d) => !has.has(d.pressIndex));
  const introduced = now.filter((d) => !had.has(d.pressIndex));
  return {
    candidate,
    net: removed.length - introduced.length,
    evidence: {
      scope: candidate.scope.kind, ...(candidate.scope.kind === "profile" ? { profileId: candidate.scope.profileId } : {}),
      before: before.length, after: now.length, removed: removed.length, introduced: introduced.length,
      examples: removed.slice(0, 3).map(exampleOf), newProblems: introduced.slice(0, 3).map(exampleOf),
    },
  };
}

export const isClear = (e: Pick<Evidence, "removed" | "introduced">): boolean => e.removed - e.introduced >= MIN_NET_GAIN && e.introduced * 2 <= e.removed;

const better = (a: Scored, b: Scored): boolean =>
  a.net > b.net || (a.net === b.net && a.evidence.introduced < b.evidence.introduced) || (a.net === b.net && a.evidence.introduced === b.evidence.introduced && a.candidate.ops.length < b.candidate.ops.length);

function bias(baseline: readonly Difference[], profileAt: ProfileAt, profileId?: string): Bias {
  const list = baseline.filter(isMisfire).filter((d) => profileId === undefined || profileAt(d.position) === profileId);
  return { hold: list.filter((d) => d.kind === "misfire-hold").length, tap: list.filter((d) => d.kind === "misfire-tap").length };
}

/** Applies candidates to one document, one per profile, or none when a pair of them would clash. */
function combine(layout: Layout, candidates: readonly Candidate[]): Layout | undefined {
  const applied = applyOps(layout, opsOf(layout, candidates));
  return applied.ok ? applied.layout : undefined;
}

export async function search(input: { layout: Layout; board: BoardDefinition; baseline: readonly Difference[]; measure: Measure; maxRuns?: number; validateOps?: (ops: readonly ChangeOp[]) => Issue[]; onProgress?: (line: string) => void }): Promise<SearchResult> {
  const { layout, board, baseline, measure } = input;
  const budget = input.maxRuns ?? MAX_RUNS;
  const say = input.onProgress ?? (() => {});
  // The check Apply makes, so nothing is offered that the layout would then refuse.
  const validateOps = input.validateOps ?? ((ops: readonly ChangeOp[]) => validate(board, layout, ops).errors);
  const firstLayerId = layout.layers[0]?.id;
  const notes: string[] = [];
  let runs = 0;
  let cut = false;

  const run = async (doc: Layout, what: string): Promise<Difference[] | undefined> => {
    if (runs >= budget) {
      cut = true;
      return undefined;
    }
    runs++;
    say(`trying ${what} (${runs} of at most ${budget})`);
    return measure(doc);
  };

  const profileAt: ProfileAt = (position) => {
    const b = position === undefined ? undefined : layout.layers[0]?.bindings[position];
    return b?.kind === "holdTap" ? b.profileId : undefined;
  };
  const withMisfires = [...new Set(baseline.filter(isMisfire).map((d) => profileAt(d.position)).filter((p): p is string => p !== undefined))];
  const tried: Scored[] = [];

  // Round r tries the r-th candidate of every profile in one run.
  const lists = new Map(withMisfires.map((id) => [id, profileCandidates(layout, board, id, bias(baseline, profileAt, id)).slice(0, 5)]));
  const rounds = Math.max(0, ...[...lists.values()].map((l) => l.length));

  async function roundOf(round: Array<Candidate | undefined>, what: string): Promise<void> {
    const all = round.filter((c): c is Candidate => c !== undefined);
    const alone = async (c: Candidate) => {
      const doc = combine(layout, [c]);
      const result = doc ? await run(doc, c.title) : undefined;
      if (result) tried.push(score(baseline, result, c, profileAt, firstLayerId));
    };
    // A candidate that rebinds keys of another profile changes that profile's keys, so it cannot share a run with that profile's own candidate.
    for (const c of all.filter((x) => x.moved)) await alone(c);
    const chosen = all.filter((x) => !x.moved);
    if (chosen.length === 0) return;
    const doc = combine(layout, chosen);
    if (!doc) {
      // Two candidates clashed (they changed the same thing); try them one at a time, as far as the budget goes.
      for (const c of chosen) await alone(c);
      return;
    }
    const result = await run(doc, what);
    if (result) for (const c of chosen) tried.push(score(baseline, result, c, profileAt, firstLayerId));
  }

  for (let r = 0; r < rounds; r++) {
    await roundOf([...lists.values()].map((l) => l[r]), `${[...lists.values()].filter((l) => l[r]).length} setting(s) together`);
  }

  // Layout-wide settings change every profile, so each is run alone and scored on all keys.
  for (const c of layoutCandidates(layout, board, bias(baseline, profileAt)).slice(0, 2)) {
    const doc = combine(layout, [c]);
    const result = doc ? await run(doc, c.title) : undefined;
    if (result) tried.push(score(baseline, result, c, profileAt, firstLayerId));
  }

  // Fine: the neighbours of each profile's best tapping term.
  const bestOf = (id: string): Scored | undefined => tried.filter((t) => t.candidate.scope.kind === "profile" && t.candidate.scope.profileId === id).reduce<Scored | undefined>((a, b) => (a === undefined || better(b, a) ? b : a), undefined);
  const fineLists = withMisfires.map((id) => {
    const best = bestOf(id);
    return best && best.net > 0 ? refine(layout, board, best.candidate) : [];
  });
  const fineRounds = Math.max(0, ...fineLists.map((l) => l.length));
  for (let r = 0; r < fineRounds; r++) await roundOf(fineLists.map((l) => l[r]), "neighbouring tapping terms together");

  // Together: the best of each family on a profile at once, since a term and a flag often help in different places.
  const together = withMisfires.map((id) => {
    const families = new Map<string, Scored>();
    // A split into one profile per hand rebinds the keys, so a setting added to the old profile would land on keys that no longer use it.
    for (const t of tried.filter((x) => x.candidate.scope.kind === "profile" && x.candidate.scope.profileId === id && isClear(x.evidence) && !x.candidate.family.endsWith(":chordal"))) {
      const current = families.get(t.candidate.family);
      if (!current || better(t, current)) families.set(t.candidate.family, t);
    }
    return [...families.values()];
  });
  // Final answer per profile: the best single candidate, then possibly the best pair if it beats it.
  const results: Scored[] = [];
  for (const [i, id] of withMisfires.entries()) {
    const pool = together[i] as Scored[];
    let best = bestOf(id);
    if (pool.length >= 2) {
      const pair = [...pool].sort((a, b) => b.net - a.net).slice(0, 2).map((s) => s.candidate);
      const doc = combine(layout, pair);
      const result = doc ? await run(doc, `${pair.length} settings of one profile together`) : undefined;
      if (result) {
        const merged: Candidate = {
          id: pair.map((c) => c.id).join("+"), scope: pair[0]?.scope as Candidate["scope"], family: pair.map((c) => c.family).join("+"),
          title: pair.map((c) => c.title).join(", and "), ops: opsOf(layout, pair), moved: pair.flatMap((c) => c.moved ?? []),
          // The pair is one edit of the profile, so it can be merged no further and its ops are already combined.
        };
        const scored = score(baseline, result, merged, profileAt, firstLayerId);
        if (best === undefined || better(scored, best)) best = scored;
      }
    }
    if (best && isClear(best.evidence)) results.push(best);
    // A fix that helps in one place and hurts in another is worth a line, so the person sees why it was not offered.
    else if (best && best.evidence.removed >= MIN_NET_GAIN) {
      const e = best.evidence;
      notes.push(`${best.candidate.title} would remove ${e.removed} misfire(s) and add ${e.introduced}, so it is not offered`);
    }
  }
  for (const t of tried.filter((x) => x.candidate.scope.kind === "layout" && isClear(x.evidence))) results.push(t);

  if (cut) notes.push(`the search stopped at ${budget} emulator runs; settings not yet tried were left out`);
  const offered = results.filter((r) => {
    const errors = validateOps(r.candidate.ops);
    if (errors.length > 0) notes.push(`${r.candidate.title} was dropped: the layout checks reject it (${errors.map((e) => e.message).join("; ")})`);
    return errors.length === 0;
  });
  const suggestions = offered
    .sort((a, b) => b.net - a.net)
    .map((r) => ({ candidate: r.candidate, evidence: r.evidence, ops: r.candidate.ops }));
  return { suggestions, runs, coarse: cut || rounds > 1 || fineRounds > 0, notes };
}
