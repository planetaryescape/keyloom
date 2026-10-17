// `keyloom keyboard put <layout> --on <board>` (22#putting-bks-config-on-it): BK's chosen layout, mapped onto a board that has no config
// yet. It makes a new config on that board and proposes the mapping as change sets on it; the proposals wait for BK, and nothing is
// built or flashed (D-014: the validator decides, and a person applies).
import { planLayoutPut } from "../agent/put-plan.ts";
import type { LayoutSnapshot } from "../agent/ports.ts";
import { upgradeStoredOryx } from "../firmware/qmk/upgrade.ts";
import { getBoardConfig } from "../persistence/configs.ts";
import { newId } from "../persistence/ids.ts";
import type { ChangeSetSource } from "../persistence/change-sets.ts";
import { type ChangeSetView, proposeChange } from "./changes.ts";
import { type ConfigView, blankDocument, newConfig } from "./configs.ts";
import { evaluate } from "../validation/validate.ts";
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
  /** Who is asking: the editor and the CLI, or the agent (D-372). The proposals are the same either way. */
  source?: ChangeSetSource;
};

/** What a put would make, without making it (D-336): the plan, and the layout the placed proposal would give the board, to draw. */
export type PutPreview = Omit<PutOutcome, "config" | "proposals"> & { name: string; after: Layout; summary: string };

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
  const { view, target, plan } = planFor(app, input);
  const blank = blankDocument(target.definition.id);
  const ops = plan.opsWithPlacements.length > 0 ? plan.opsWithPlacements : plan.ops;
  const after = evaluate(target.definition, blank, ops).after ?? blank;
  return {
    name: input.name ?? `${view.layout.name} on ${target.definition.name}`, after, summary: summaryOf(view.layout.name, plan),
    placements: plan.placements, layers: plan.layers, notCarried: plan.notCarried, combos: plan.combos, notes: plan.notes,
  };
}

function summaryOf(from: string, plan: ReturnType<typeof planLayoutPut>): string {
  const carried = plan.layers.reduce((n, l) => n + l.carried, 0);
  const guessed = plan.layers.reduce((n, l) => n + l.guessed, 0);
  return `${plural(carried, "key")} across ${plural(plan.layers.length, "layer")} from ${from}${guessed > 0 ? `, ${guessed} of them nearest-place guesses` : ""}${plan.combos.copied.length > 0 ? `, ${plural(plan.combos.copied.length, "combo")}` : ""}`;
}

function planFor(app: App, input: PutInput) {
  const view = getLayout(app, input.from);
  const target = showBoard(input.board);
  if (target.definition.id === view.layout.boardId) throw new UsageError(`${view.layout.name} is already a ${target.definition.name} config; to copy it, use \`keyloom config new\``);
  if (target.definition.firmware === "kanata") throw new UsageError(`${target.definition.name} is a laptop keyboard; its config comes from \`keyloom remap\`, not from a keyboard put`);
  // A stored Oryx layout still holds its colours and tap dances as code; read it the way a fresh import would, in memory (D-193, D-222).
  const upgraded = upgradeStoredOryx(view.document, view.board.definition);
  const source: LayoutSnapshot = {
    layoutId: view.layout.id, layoutName: view.layout.name, revisionId: view.revision.id, document: upgraded === null ? view.document : upgraded.layout, board: view.board,
    onKeyboard: getBoardConfig(app.db, view.layout.boardId) === view.layout.id, archived: view.layout.archivedAt !== null,
  };
  return { view, target, plan: planLayoutPut(source, target, choicesOf(input)) };
}

export function putConfig(app: App, input: PutInput): PutOutcome {
  const { view, target, plan } = planFor(app, input);

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
