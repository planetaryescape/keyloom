// Text forms of validation results, ops and change sets for the change commands.
import { type ChangeOp, type ChangeSetView, type ValidationResult, describeBinding } from "../app/index.ts";

const slot = (s: { layerId: string; position: number }) => `${s.layerId}:${s.position}`;

/** One line per op, in the vocabulary of the layout grid (`layer-0:6` is layer-0, position 6). */
export function opLine(op: ChangeOp): string {
  switch (op.op) {
    case "setSensorBindings": return `${op.sensorBindings === null ? "reset" : "set"} encoder turns on layer ${op.layerId}`;
    case "setBinding": return `set ${slot(op.at)} to ${describeBinding(op.binding)}`;
    case "moveBinding": return `move ${slot(op.from)} to ${slot(op.to)}`;
    case "swapBindings": return `swap ${slot(op.a)} and ${slot(op.b)}`;
    case "addLayer": return `add layer ${op.layer.id} ("${op.layer.name}") after ${op.afterLayerId}`;
    case "removeLayer": return `remove layer ${op.layerId}`;
    case "renameLayer": return `rename layer ${op.layerId} to "${op.name}"`;
    case "duplicateLayer": return `duplicate layer ${op.layerId} as ${op.layer.id} ("${op.layer.name}")`;
    case "moveLayer": return `move layer ${op.layerId} after ${op.afterLayerId}`;
    case "setLayerStyle": return `set layer ${op.layerId} label ${op.shortLabel ?? "(default)"}, colour ${op.color ?? "(default)"}`;
    case "setLayerLighting": return op.lighting === null ? `clear the lighting of layer ${op.layerId}` : `set the lighting of layer ${op.layerId}`;
    case "upsertMacro": return `set macro ${op.macro.id}`;
    case "removeMacro": return `remove macro ${op.macroId}`;
    case "upsertTapDance": return `set tap dance ${op.tapDance.id}`;
    case "removeTapDance": return `remove tap dance ${op.tapDanceId}`;
    case "upsertCombo": return `set combo ${op.combo.id}`;
    case "removeCombo": return `remove combo ${op.comboId}`;
    case "upsertConditionalLayer": return `set conditional layer ${op.conditionalLayer.id}`;
    case "removeConditionalLayer": return `remove conditional layer ${op.conditionalLayerId}`;
    case "upsertHoldTapProfile": return `set hold-tap profile ${op.profile.id}`;
    case "setFirmwareSetting": return `set ${op.setting.firmware} setting ${op.setting.key} to ${String(op.setting.value)}`;
    case "removeFirmwareSetting": return `reset ${op.firmware} setting ${op.key} to the firmware default`;
    case "dropFunction": return `drop ${op.function}: ${op.reason}`;
  }
}

export function validationTable(v: ValidationResult): string {
  const issue = (i: ValidationResult["errors"][number]) => `  ${i.code}: ${i.message}${i.slots?.length ? `  [${i.slots.map(slot).join(" ")}]` : ""}`;
  const lines = [v.ok ? "ok: the change is valid" : "invalid: the change can't be applied"];
  if (v.errors.length) lines.push(`errors (${v.errors.length}):`, ...v.errors.map(issue));
  if (v.warnings.length) lines.push(`warnings (${v.warnings.length}):`, ...v.warnings.map(issue));
  if (v.diff.reminders.length) lines.push(`reminders (${v.diff.reminders.length}):`, ...v.diff.reminders.map((r) => `  ${r.decisionId} (${r.status}): ${r.goal}: ${r.reason}`));
  if (v.diff.retuned.length) lines.push(`retunes ${v.diff.retuned.length} hold-tap${v.diff.retuned.length === 1 ? "" : "s"}: ${v.diff.retuned.map(slot).join(" ")}`);
  const n = v.diff.changed.length;
  lines.push(`changes ${n} slot${n === 1 ? "" : "s"}${n ? `: ${v.diff.changed.map(slot).join(" ")}` : ""}`);
  return lines.join("\n");
}

export const changeSetJson = (cs: ChangeSetView) => ({
  id: cs.id,
  layout_id: cs.layoutId,
  base_revision_id: cs.baseRevisionId,
  source: cs.source,
  status: cs.status,
  explanation: cs.explanation,
  decision_draft: cs.decisionDraft,
  ops: cs.ops,
  validation: cs.validation,
  created_at: cs.createdAt,
  decided_at: cs.decidedAt,
});

export function changeSetTable(cs: ChangeSetView): string {
  return [
    cs.id,
    `${cs.status} (${cs.source}) on ${cs.layoutId}, based on ${cs.baseRevisionId}`,
    `explanation: ${cs.explanation}`,
    `ops (${cs.ops.length}):`,
    ...cs.ops.map((o) => `  ${opLine(o)}`),
    "",
    validationTable(cs.validation),
  ].join("\n");
}
