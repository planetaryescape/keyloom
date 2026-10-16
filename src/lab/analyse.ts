// A recording to findings (D-282, D-283): replay it through the layout's settings, say what the hands did and what the firmware did,
// tell it per finger, and try the settings that could have gone better. The emulator is a parameter, so the same code runs on the real
// QMK and ZMK cores and on a stand-in in tests.
import type { BoardDefinition } from "../boards/schema.ts";
import type { EmulationResult, EmulatorEvent } from "../firmware/emulate/types.ts";
import type { TraceEvent } from "../firmware/emulate/trace.ts";
import type { Layout } from "../layout/schema.ts";
import { align } from "./align.ts";
import { type Difference, isMisfire, outcomeDifferences, physicalDifferences } from "./classify.ts";
import { intentSteps } from "./intent.ts";
import type { Passage } from "./passage-types.ts";
import { pressesOf } from "./presses.ts";
import { prepareEvents } from "./replay-input.ts";
import { type Finding, sentencesFor } from "./sentences.ts";
import { type SearchResult, type Suggestion, search } from "./search.ts";
import { type FingerStats, fingerStats } from "./stats.ts";

/** Runs a layout's firmware on a key script and returns what it sent. A real one builds and runs the firmware; tests give a model. */
export type Replay = (layout: Layout, events: readonly EmulatorEvent[]) => Promise<EmulationResult>;

export type Counts = { misfireHold: number; misfireTap: number; typo: number; missed: number; double: number };

export type Fidelity = {
  /** The text the emulator typed, and the text the computer received when the keyboard was recorded, compared. */
  typedByKeyboard: number;
  typedByReplay: number;
  /** Characters that differ (edit distance). */
  differing: number;
};

export type Analysis = {
  schemaVersion: 1;
  presses: number;
  durationMs: number;
  counts: Counts;
  differences: Difference[];
  findings: Finding[];
  stats: FingerStats;
  suggestions: Suggestion[];
  /** Emulator runs the whole analysis took, the baseline included. */
  emulatorRuns: number;
  /** True when the search went coarse to fine or was cut short by its budget. */
  coarseSearch: boolean;
  fidelity?: Fidelity;
  /** Things to say before the findings: characters the lab could not ask for, a pause that was shortened, a replay that disagrees. */
  notes: string[];
};

export const countsOf = (differences: readonly Difference[]): Counts => ({
  misfireHold: differences.filter((d) => d.kind === "misfire-hold").length,
  misfireTap: differences.filter((d) => d.kind === "misfire-tap").length,
  typo: differences.filter((d) => d.kind === "typo").length,
  missed: differences.filter((d) => d.kind === "missed").length,
  double: differences.filter((d) => d.kind === "double").length,
});

/** Edit distance, with a cap on size so a long recording costs a bounded amount. */
function editDistance(a: string, b: string): number {
  const x = [...a].slice(0, 4000);
  const y = [...b].slice(0, 4000);
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row.push(Math.min((previous[j] as number) + 1, (row[j - 1] as number) + 1, (previous[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1)));
    previous = row;
  }
  return previous[y.length] as number;
}

export type AnalyseInput = {
  board: BoardDefinition;
  layout: Layout;
  passage: Passage;
  events: readonly TraceEvent[];
  /** What the computer received while the keyboard was recorded, to check the replay against. */
  typedText?: string;
  replay: Replay;
  /** Most emulator runs for the settings search; the baseline run is extra. */
  maxRuns?: number;
  /** Skip the search (a recording with too few misfires to learn from needs none). */
  suggest?: boolean;
  onProgress?: (line: string) => void;
};

export async function analyse(input: AnalyseInput): Promise<Analysis> {
  const { board, layout, passage } = input;
  const say = input.onProgress ?? (() => {});
  const events = prepareEvents(input.events);
  if (events.length === 0) throw new Error("the recording has no key presses");
  const presses = pressesOf(events);
  const intent = intentSteps(passage, layout, board);
  const aligned = align(presses, intent.steps);
  const notes: string[] = [];
  if (intent.skipped.length > 0) notes.push(`${intent.skipped.length} thing(s) in the passage are not on the first layer, so they were left out of the comparison: ${intent.skipped.map((s) => `"${s}"`).join(", ")}`);

  let runs = 0;
  const run = async (doc: Layout) => {
    runs++;
    return input.replay(doc, events);
  };
  say("replaying the recording through your current settings");
  const baselineResult = await run(layout);
  const baseline = [...physicalDifferences(aligned, presses), ...outcomeDifferences(layout, aligned, presses, baselineResult.reports)];
  const stats = fingerStats({ board, layout, presses, aligned, differences: baseline });
  const findings = sentencesFor({ stats, layout, board, differences: baseline });

  let result: SearchResult = { suggestions: [], runs: 0, coarse: false, notes: [] };
  if (input.suggest !== false && baseline.filter(isMisfire).length >= 2) {
    result = await search({
      layout, board, baseline,
      measure: async (doc) => outcomeDifferences(doc, aligned, presses, (await run(doc)).reports),
      ...(input.maxRuns === undefined ? {} : { maxRuns: input.maxRuns }),
      onProgress: say,
    });
    notes.push(...result.notes);
  }

  let fidelity: Fidelity | undefined;
  if (input.typedText !== undefined) {
    const differing = editDistance(input.typedText, baselineResult.text);
    fidelity = { typedByKeyboard: [...input.typedText].length, typedByReplay: [...baselineResult.text].length, differing };
    if (differing > Math.max(5, 0.1 * fidelity.typedByKeyboard)) {
      notes.push(`the replay types something different from what your keyboard typed here (${differing} characters differ), so treat the suggestions with care`);
    }
  }

  return {
    schemaVersion: 1,
    presses: presses.length,
    durationMs: events.at(-1)?.at ?? 0,
    counts: countsOf(baseline),
    differences: baseline,
    findings,
    stats,
    suggestions: result.suggestions,
    emulatorRuns: runs,
    coarseSearch: result.coarse,
    ...(fidelity ? { fidelity } : {}),
    notes,
  };
}
