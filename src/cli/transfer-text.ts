// The copy report in the CLI (D-030, D-467): the same artifact the card shows, in lines. `keyloom chat` prints it after the copy's own reply
// and `keyloom keyboard put` prints it for the plan it just made, so the two cannot drift.
import type { AgentArtifact } from "../api/artifacts.ts";

type Transfer = Extract<AgentArtifact, { kind: "transfer" }>;

/** A terminal is not scrolled: the first few drops, then a count, keep the report one screen long. The card keeps more. */
export const CLI_REPORT_DROPS = 8;

/** `continues`: whether a conversation continues the adaptation (a copy in chat does; `keyboard put` makes a config with no conversation). */
export function transferReportText(report: Transfer, opts: { continues: boolean }): string[] {
  const dropped = report.skippedCount ?? report.skipped.length;
  const guessed = report.guessedCount ?? 0;
  const layers = report.layers ?? [];
  const layerTotal = report.layerCount ?? layers.length;
  const combos = report.combos;
  const combosSkipped = combos === undefined ? 0 : (combos.skippedCount ?? combos.skipped.length);
  const notes = report.notes ?? [];
  const noteTotal = report.noteCount ?? notes.length;
  const placed = report.placementCount ?? 0;
  const blocked = report.placementsBlocked ?? 0;
  const onLayers = layerTotal > 1 ? ` on ${layerTotal} layers` : "";
  const guesses = guessed > 0 ? `, ${guessed} of them nearest-place guesses` : "";
  const carriedKeys = report.mappedCount === 1 ? "1 key" : `${report.mappedCount} keys`;
  const lines = [
    `${report.sourceBoard} -> ${report.destinationBoard}`,
    report.mappedCount === 0 ? "no keys came across" : `${dropped === 0 ? "All " : ""}${carriedKeys} came across${onLayers}${guesses}`,
  ];
  if (layerTotal > 1) {
    lines.push(...layers.map((layer) => `  ${layer.source}: ${layer.carried} carried${layer.guessed > 0 ? `, ${layer.guessed} guessed` : ""}${layer.notCarried > 0 ? `, ${layer.notCarried} left off` : ""}`));
    const moreLayers = layerTotal - layers.length;
    if (moreLayers > 0) lines.push(`  and ${moreLayers} more ${moreLayers === 1 ? "layer" : "layers"}`);
  }
  if (dropped > 0) {
    lines.push(`${dropped} ${dropped === 1 ? "key" : "keys"} did not come across:`);
    lines.push(...report.skipped.slice(0, CLI_REPORT_DROPS).map((item) => `  ${item.key}: ${item.reason}`));
    const remaining = dropped - Math.min(report.skipped.length, CLI_REPORT_DROPS);
    if (remaining > 0) lines.push(`  and ${remaining} more`);
  }
  if (combos !== undefined && (combos.copied > 0 || combosSkipped > 0)) {
    lines.push(`${combos.copied} ${combos.copied === 1 ? "combo" : "combos"} copied${combosSkipped === 0 ? "" : `; ${combosSkipped} did not: ${combos.skipped.map((combo) => `${combo.id} (${combo.why})`).join("; ")}${combosSkipped > combos.skipped.length ? `, and ${combosSkipped - combos.skipped.length} more` : ""}`}`);
  }
  // What was never about keys: the lines the plan wrote as notes.
  if (notes.length > 0) {
    lines.push("left out:");
    lines.push(...notes.map((note) => `  ${note}`));
    if (noteTotal > notes.length) lines.push(`  and ${noteTotal - notes.length} more`);
  }
  if (placed > 0) lines.push(placed === 1
    ? "1 layer key had nowhere of its own and was placed on a free key"
    : `${placed} layer keys had nowhere of their own and were placed on free keys`);
  if (blocked > 0) lines.push(`${blocked} ${blocked === 1 ? "layer key" : "layer keys"} could not be placed: the layer has no way back on this board`);
  if (opts.continues) lines.push("adapting it continues in the new config's own conversation");
  return lines;
}
