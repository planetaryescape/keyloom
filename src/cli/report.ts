// The text form of an import report (05: "Print the import report").
import type { ImportOutcome } from "../app/index.ts";

export function importTable(o: ImportOutcome): string {
  const r = o.report;
  const kinds = Object.entries(r.bindings).map(([k, n]) => `${k} ${n}`).join(", ");
  const lines = [
    o.layoutId,
    `imported "${o.name}" for ${r.boardId}: ${r.layers} layers x ${r.keysPerLayer} keys (revision ${o.revisionId})`,
    `bindings: ${kinds}`,
    `macros: ${r.macros.join(", ") || "none"}; tap dances: ${r.tapDances.join(", ") || "none"}; combos: ${r.combos}; settings: ${r.settings}; profiles: ${r.profiles.join(", ") || "none"}`,
  ];

  const groups = new Map<string, { label: string; reason: string; at: string[] }>();
  for (const n of r.native) {
    const g = groups.get(n.source) ?? { label: n.label, reason: n.reason, at: [] };
    g.at.push(`${n.layerId}:${n.position}`);
    groups.set(n.source, g);
  }
  lines.push("", `native bindings kept as source (${r.native.length}):`);
  for (const [source, g] of groups) lines.push(`  ${source} x${g.at.length}  ${g.reason}`, `    at ${g.at.join(" ")}`);

  lines.push("", `passthrough kept verbatim (${r.passthrough.length}):`);
  for (const p of r.passthrough) lines.push(`  ${p.file} ${p.anchor}${p.refersToLayerIndices ? "  (refers to layer numbers)" : ""}`);

  if (r.warnings.length > 0) lines.push("", "warnings:", ...r.warnings.map((w) => `  ${w}`));
  if (r.instructions) lines.push("", "to do yourself:", ...r.instructions.split("\n").map((l) => `  ${l}`));
  return lines.join("\n");
}
