// `keyloom keyboard put <layout> --on <board>` (22#putting-bks-config-on-it): BK's chosen layout, mapped onto a board that has no config
// yet. It makes a new config on that board and proposes the mapping as change sets on it; the proposals wait for BK, and nothing is
// built or flashed (D-014: the validator decides, and a person applies).
import { type PutPlan, planLayoutPut } from "../agent/put-plan.ts";
import type { LayoutSnapshot } from "../agent/ports.ts";
import { upgradeStoredOryx } from "../firmware/qmk/upgrade.ts";
import { getBoardConfig } from "../persistence/configs.ts";
import { newId } from "../persistence/ids.ts";
import { transact } from "../persistence/transaction.ts";
import type { ChangeSetSource } from "../persistence/change-sets.ts";
import { type ChangeSetView, proposeChange } from "./changes.ts";
import { type ConfigView, blankDocument, newConfig } from "./configs.ts";
import { evaluate } from "../validation/validate.ts";
import type { ChangeOp } from "../layout/change.ts";
import type { Layout } from "../layout/schema.ts";
import type { App } from "./context.ts";
import { UsageError } from "./errors.ts";
import { getLayout } from "./layouts.ts";
import { showBoard } from "./boards.ts";
import type { LayerReport, NotCarried, PlacementCandidate, PlacementProposal } from "../agent/put-plan.ts";

export type PutInput = {
  /** The layout (config) to copy, by ID or name. */
  from: string;
  /** The board to put it on, such as `local/corne`. */
  board: string;
  /** The new config's name; defaults to "<layout> on <board>". */
  name?: string;
  /** For a layer key with no counterpart, by its source position: the target key chosen among the candidates (D-336). */
  placements?: Record<string, number>;
  /** Source layers to carry, by id or name. Omitted: every layer except factory and test layers, which only mean something on the board they shipped on. */
  layers?: string[];
  /** Who is asking: the editor and the CLI, or the agent (D-372). The proposals are the same either way. */
  source?: ChangeSetSource;
};

/** What a put would make, without making it (D-336): the plan, the layout the placed proposal would give the board, and anything the validator refuses, so the page can say it before a config is made. */
export type PutPreview = Omit<PutOutcome, "config" | "proposals"> & { name: string; after: Layout; summary: string; problems: string[] };

export type PutProposal = { changeSetId: string; title: string; summary: string; warnings: number; changedKeys: number };

export type PutOutcome = {
  config: ConfigView;
  /** The mapping on its own first; then, when a layer key had no counterpart, the same with those keys placed. Applying one retires the other. */
  proposals: PutProposal[];
  placements: PlacementProposal[];
  layers: LayerReport[];
  notCarried: NotCarried[];
  combos: { copied: string[]; skipped: Array<{ id: string; why: string }> };
  notes: string[];
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function choicesOf(input: PutInput): Map<number, number> {
  return new Map(Object.entries(input.placements ?? {}).map(([source, target]) => [Number(source), target]));
}

export function previewPut(app: App, input: PutInput): PutPreview {
  const { view, target, plan } = planPut(app, input);
  const blank = blankDocument(target.definition.id);
  const ops = plan.opsWithPlacements.length > 0 ? plan.opsWithPlacements : plan.ops;
  const evaluation = evaluate(target.definition, blank, ops);
  return {
    name: input.name ?? `${view.layout.name} on ${target.definition.name}`, after: evaluation.after ?? blank, summary: summaryOf(view.layout.name, plan),
    placements: plan.placements, layers: plan.layers, notCarried: plan.notCarried, combos: plan.combos, notes: plan.notes,
    // What the validator would refuse, so the page says it before "Make" makes a config that cannot hold it (D-014).
    problems: evaluation.result.errors.map((e) => e.message),
  };
}

function summaryOf(from: string, plan: PutPlan): string {
  const carried = plan.layers.reduce((n, l) => n + l.carried, 0);
  const guessed = plan.layers.reduce((n, l) => n + l.guessed, 0);
  return `${plural(carried, "key")} across ${plural(plan.layers.length, "layer")} from ${from}${guessed > 0 ? `, ${guessed} of them nearest-place guesses` : ""}${plan.combos.copied.length > 0 ? `, ${plural(plan.combos.copied.length, "combo")}` : ""}`;
}

const FACTORY_LAYER = /(^|[^a-z])(factory|test)([^a-z]|$)/i;

/** The layers a put carries and the ones it leaves out, with the reason for each. The base layer is always carried: it is the new config's first. */
function chooseLayers(doc: Layout, wanted: readonly string[] | undefined): { kept: Layout; notes: string[] } {
  const named = (l: Layout["layers"][number]) => wanted?.some((w) => w === l.id || w === l.name) === true;
  const out: string[] = [];
  const layers = doc.layers.filter((l, i) => {
    const keep = i === 0 || (wanted === undefined ? !FACTORY_LAYER.test(`${l.id} ${l.name}`) : named(l));
    if (!keep) out.push(l.name);
    return keep;
  });
  const unknown = (wanted ?? []).filter((w) => !doc.layers.some((l) => l.id === w || l.name === w));
  if (unknown.length > 0) throw new UsageError(`no layer called ${unknown.map((u) => `"${u}"`).join(", ")}; the layers are ${doc.layers.map((l) => l.name).join(", ")}`);
  const why = wanted === undefined ? "a factory or test layer, which only means something on the keyboard it shipped on" : "not chosen";
  return { kept: { ...doc, layers }, notes: out.length > 0 ? [`Left out ${out.join(", ")}: ${why}`] : [] };
}

export function planPut(app: App, input: PutInput) {
  const view = getLayout(app, input.from);
  const target = showBoard(input.board);
  if (target.definition.id === view.layout.boardId) throw new UsageError(`${view.layout.name} is already a ${target.definition.name} config; to copy it, use \`keyloom config new\``);
  // A stored Oryx layout still holds its colours and tap dances as code; read it the way a fresh import would, in memory (D-193, D-222).
  const upgraded = upgradeStoredOryx(view.document, view.board.definition);
  const source: LayoutSnapshot = {
    layoutId: view.layout.id, layoutName: view.layout.name, revisionId: view.revision.id, document: upgraded === null ? view.document : upgraded.layout, board: view.board,
    onKeyboard: getBoardConfig(app.db, view.layout.boardId) === view.layout.id, archived: view.layout.archivedAt !== null,
  };
  const { kept, notes } = chooseLayers(source.document, input.layers);
  const start = blankDocument(target.definition.id);
  const planned = planLayoutPut({ ...source, document: kept }, target, choicesOf(input), start);
  // A software remapper's new config starts as the identity map, so the put replaces keys that type something and the validator asks for
  // each lost function to be kept or dropped (D-014). A put is a replacement by intent: drop them, and say which, so nothing goes silently (D-024).
  const dropped = new Set<string>();
  const dropLost = (ops: ChangeOp[]): ChangeOp[] => {
    if (ops.length === 0 || target.definition.firmware !== "kanata") return ops;
    const lost = evaluate(target.definition, start, ops).result.errors.filter((e) => e.code === "function_lost" && e.function !== undefined).map((e) => e.function as string);
    for (const f of lost) dropped.add(f);
    return [...ops, ...lost.map((f): ChangeOp => ({ op: "dropFunction", function: f, reason: `${view.layout.name}'s setup has no key for it on the ${target.definition.name}` }))];
  };
  const plan = { ...planned, ops: dropLost(planned.ops), opsWithPlacements: dropLost(planned.opsWithPlacements) };
  const droppedNote = dropped.size > 0 ? [`${plural(dropped.size, "function")} the ${target.definition.name} typed before no longer has a plain key of its own: ${[...dropped].slice(0, 12).map((f) => f.replace(/^key:/, "")).join(", ")}${dropped.size > 12 ? ", and more" : ""}. The old config is untouched and restoring it is one step`] : [];
  return { view, target, plan: { ...plan, notes: [...notes, ...plan.notes, ...droppedNote] } };
}

export function putConfig(app: App, input: PutInput): PutOutcome {
  // One write transaction: when the validator refuses the mapping, the config it was going on is not left behind half made (D-336).
  return transact(app.db, () => putConfigNow(app, input));
}

function putConfigNow(app: App, input: PutInput): PutOutcome {
  const { view, target, plan } = planPut(app, input);

  const name = input.name ?? `${view.layout.name} on ${target.definition.name}`;
  const config = newConfig(app, { name, from: "blank", board: target.definition.id });
  const group = newId("pg");
  const summary = summaryOf(view.layout.name, plan);
  const explanation = [
    `${view.layout.name} on the ${target.definition.name}: ${summary}.`,
    plan.notCarried.length > 0 ? `${plural(plan.notCarried.length, "key")} had no counterpart or too weak a one, and ${plan.notCarried.length === 1 ? "is" : "are"} not carried.` : "",
    ...plan.notes,
  ].filter(Boolean).join(" ");

  const asProposal = (cs: ChangeSetView, title: string, text: string): PutProposal => ({
    changeSetId: cs.id, title, summary: text, warnings: cs.validation.warnings.length, changedKeys: cs.validation.diff.changed.length,
  });
  const proposals: PutProposal[] = [];
  const main = proposeChange(app, config.id, {
    ops: plan.ops, explanation, source: input.source ?? "editor", title: `Put ${view.layout.name} on the ${target.definition.name}`,
    tradeoffs: { gains: [summary], costs: plan.notCarried.length > 0 ? [`${plural(plan.notCarried.length, "key")} stay off: ${plan.notCarried.slice(0, 6).map((n) => n.sourceName).join(", ")}${plan.notCarried.length > 6 ? ", and more" : ""}`] : [] },
    proposalGroup: group,
  });
  proposals.push(asProposal(main, main.title ?? "", summary));
  if (plan.opsWithPlacements.length > 0) {
    const placed = plan.placements.filter((p) => p.candidates.length > 0 && p.blocked === undefined);
    // Where each key went: the person's pick among the candidates where they made one (D-336), keyloom's first choice otherwise.
    const choices = choicesOf(input);
    const where = (p: PlacementProposal) => {
      const chosen = choices.get(p.source);
      const first = (chosen === undefined ? undefined : p.candidates.find((c) => c.target === chosen)) ?? (p.candidates[0] as PlacementCandidate);
      return `${p.sourceName} on the ${first.name} key${first.replaces ? `, instead of ${first.replaces}` : ""}`;
    };
    const text = `the same, with ${plural(placed.length, "layer key")} that had no key of its own placed: ${placed.map(where).join("; ")}`;
    const alt = proposeChange(app, config.id, {
      ops: plan.opsWithPlacements, explanation: `${explanation} ${text}.`, source: input.source ?? "editor", title: `Put ${view.layout.name} on the ${target.definition.name}, with its layer keys placed`,
      tradeoffs: { gains: [text], costs: ["the placed keys are keyloom's first choice of the keys on offer; the other candidates are listed so you can pick differently"] }, proposalGroup: group,
    });
    proposals.push(asProposal(alt, alt.title ?? "", text));
  }
  return { config, proposals, placements: plan.placements, layers: plan.layers, notCarried: plan.notCarried, combos: plan.combos, notes: plan.notes };
}
