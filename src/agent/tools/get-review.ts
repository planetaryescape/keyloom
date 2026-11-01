import { z } from "zod";
import type { AgentPorts, ReviewFinding, ReviewFindings } from "../ports.ts";
import { defineTool } from "./define.ts";

const WHEN = { connect: "when the keyboard connected", apply: "after your last change", import: "when it was imported", manual: "when BK asked" } as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One finding in words, then the positions ops take and the ops a still-open suggestion already carries. */
function findingText(f: ReviewFinding): string[] {
  const out = [`- [${f.severity}] ${f.title}`, `  ${f.body}`];
  if (f.keys.length > 0) out.push(`  Positions: ${f.keys.map((k) => `${k.layerId}/${k.position}`).join(", ")}`);
  if (f.layers.length > 0) out.push(`  Layers: ${f.layers.join(", ")}`);
  if (f.fixes.length > 0) out.push(`  Fixes: ${f.fixes.join(", ")}`);
  if (f.proposal === null) return out;
  const p = f.proposal;
  if (p.status === null) {
    out.push(`  Already a checked proposal: ${p.id}${p.title === null ? "" : ` "${p.title}"`}. Reuse these ops inside the one change rather than working them out again:`);
    for (const op of p.ops) out.push(`    ${JSON.stringify(op)}`);
  } else {
    out.push(`  Its proposal ${p.id} no longer applies (${p.status}); work from the finding itself.`);
  }
  return out;
}

/** The review as the agent reads it (D-461): plain words, the positions ops use, and what a suggestion already has validated. */
export function reviewFindingsText(f: ReviewFindings): string {
  const review = f.review;
  if (review === null) {
    return "This config has no board review yet, so there are no findings to work from. keyloom looks a config over when its keyboard connects and after each change, and BK can ask for one from the review panel.";
  }
  const tally = (["problem", "hint", "suggestion"] as const).flatMap((kind) => {
    const n = review.items.filter((i) => i.kind === kind).length;
    return n === 0 ? [] : [plural(n, kind)];
  });
  const lines = [`The newest board review of this config (${WHEN[review.trigger]}): ${tally.length === 0 ? "nothing to note" : tally.join(", ")}.`];
  if (!review.current && review.revisionId !== f.headRevisionId) {
    lines.push(
      `It is the review of an earlier version: the config changed after it was made (review ${review.revisionId}, head ${f.headRevisionId}). Use its findings as a pointer and let the validator decide against the current head; do not refuse.`,
    );
  } else if (!review.current) {
    lines.push(`This review is no longer current even though the saved revision is unchanged: ${review.freshnessReason ?? "review inputs changed"} Old recommendations are withheld. Treat only the source checks as historical pointers, not current firmware evidence.`);
  }
  if (review.ai.status === "pending" || review.ai.status === "running") {
    lines.push("keyloom's own look has not finished, so these are the checks' findings only.");
  } else if (review.ai.status === "unavailable" || review.ai.status === "failed") {
    lines.push(`keyloom's own look did not finish${review.ai.reason === null ? "" : `: ${review.ai.reason}`}.`);
  }
  for (const [title, kind] of [["Problems", "problem"], ["Suggestions", "suggestion"], ["Hints", "hint"]] as const) {
    const items = review.items.filter((i) => i.kind === kind);
    if (items.length > 0) lines.push("", `${title}:`, ...items.flatMap(findingText));
  }
  if (review.items.length === 0) lines.push("", "There is nothing to fix: no problems, hints or suggestions that BK has not hidden.");
  if (review.hidden > 0) lines.push("", `${plural(review.hidden, "finding")} BK hid ${review.hidden === 1 ? "is" : "are"} left out on purpose; do not act on ${review.hidden === 1 ? "it" : "them"}.`);
  return lines.join("\n");
}

export const getReviewTool = (ports: AgentPorts) =>
  defineTool({
    name: "get_review",
    description:
      "The newest board review of this config: the problems, hints and suggestions keyloom found, in plain words with each finding's keys by position, and for a suggestion still on the board its checked ops, ready to reuse. Findings BK hid are left out, and it says whether the review is of the current layout. Call it first when he asks to fix what the review found, then build one validated change that covers the findings. Read-only.",
    inputSchema: z.object({}),
    run: () => reviewFindingsText(ports.reviewFindings()),
  });
