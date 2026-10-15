// How alternatives from one propose_changes call are compared at a glance (09#proposals). Pure, so the
// numbers and sentences are tested without a browser.
import type { ProposalCard } from "../../api/http.ts";
import type { Layout } from "../../layout/schema.ts";
import { functionName } from "../editor/function-label.ts";

/**
 * Consecutive proposals that share a `proposalGroup`; one without a group is its own. The agent may
 * propose twice in a reply (a repair), and each call's alternatives are compared only with each other.
 */
export function groupProposals(proposals: readonly ProposalCard[]): ProposalCard[][] {
  const groups: ProposalCard[][] = [];
  for (const proposal of proposals) {
    const last = groups.at(-1);
    if (last !== undefined && proposal.proposalGroup !== null && last[0]?.proposalGroup === proposal.proposalGroup) last.push(proposal);
    else groups.push([proposal]);
  }
  return groups;
}

export type CompareRow = {
  changeSetId: string;
  number: number;
  title: string;
  status: ProposalCard["status"];
  /** Functions that change position (07's relearnCount). */
  relearn: number;
  dropped: number;
  warnings: number;
  /** What moves and what is lost, in words: "Moves Tab", "Drops F16", or that nothing does. */
  summary: string;
  /** Moves a key BK asked to keep where it is; the one warning worth a line of its own. */
  movesPinned: boolean;
};

const NAMES_SHOWN = 2;

function listed(names: string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).join(", ");
  return names.length > NAMES_SHOWN ? `${shown} and ${names.length - NAMES_SHOWN} more` : shown;
}

export function summaryOf(proposal: ProposalCard, layout: Layout): string {
  const { displaced, dropped } = proposal.validation.diff;
  const moved = [...new Set(displaced.filter((d) => d.to !== null).map((d) => functionName(d.function, layout)))];
  const drops = [...new Set(dropped.map((d) => functionName(d.function, layout)))];
  const parts = [moved.length ? `Moves ${listed(moved)}` : "", drops.length ? `Drops ${listed(drops)}` : ""].filter(Boolean);
  return parts.length ? parts.join(". ") : "Nothing else moves";
}

export function compareRows(group: readonly ProposalCard[], layout: Layout): CompareRow[] {
  return group.map((proposal, index) => ({
    changeSetId: proposal.changeSetId,
    number: index + 1,
    title: proposal.title,
    status: proposal.status,
    relearn: proposal.validation.diff.relearnCount,
    dropped: proposal.validation.diff.dropped.length,
    warnings: proposal.validation.warnings.length,
    summary: summaryOf(proposal, layout),
    movesPinned: proposal.validation.warnings.some((w) => w.code === "moved_pinned"),
  }));
}

export type Move = { key: string; function: string; from: ProposalCard["validation"]["diff"]["displaced"][number]["from"]; to: NonNullable<ProposalCard["validation"]["diff"]["displaced"][number]["to"]> };

/** Displaced functions that have a new home, one line each. Those with nowhere to go are in `dropped`, which says why. */
export function movesOf(proposal: ProposalCard): Move[] {
  return proposal.validation.diff.displaced.flatMap((d) =>
    d.to === null ? [] : [{ key: `${d.function}:${d.from.layerId}:${d.from.position}`, function: d.function, from: d.from, to: d.to }],
  );
}
