// Applies change ops to a layout document (03#proposals). Pure and shared by the editor, the
// agent, the CLI and the validator, so all of them agree on what an op means.
import type { ChangeOp, OpError, Slot } from "./change.ts";
import type { Binding, Layer, Layout } from "./schema.ts";

export type ApplyOpsResult = { ok: true; layout: Layout } | { ok: false; error: OpError };

class OpFailure extends Error {
  constructor(readonly code: OpError["code"], message: string) {
    super(message);
  }
}

/**
 * Applies `ops` in order to a copy of `layout`; the input is never mutated. An op that names
 * something the document doesn't have stops the run, so a half-applied document is never returned.
 * Ops that leave a dangling reference (removing a layer that bindings point at) are not errors
 * here: the validator reports those on the finished document.
 */
export function applyOps(layout: Layout, ops: readonly ChangeOp[]): ApplyOpsResult {
  const doc = structuredClone(layout);
  for (const [index, op] of ops.entries()) {
    try {
      applyOp(doc, op);
    } catch (err) {
      if (err instanceof OpFailure) return { ok: false, error: { index, code: err.code, message: err.message } };
      throw err;
    }
  }
  return { ok: true, layout: doc };
}

const find = <T extends { id: string }>(items: T[], id: string) => items.findIndex((i) => i.id === id);

function layerOf(doc: Layout, id: string): Layer {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) throw new OpFailure("unknown_ref", `no layer "${id}"`);
  return layer;
}

function checkSlot(doc: Layout, at: Slot): Layer {
  const layer = layerOf(doc, at.layerId);
  if (at.position >= layer.bindings.length) {
    throw new OpFailure("unknown_ref", `layer "${at.layerId}" has no position ${at.position} (it has ${layer.bindings.length})`);
  }
  return layer;
}

const slotsEqual = (a: Slot, b: Slot) => a.layerId === b.layerId && a.position === b.position;

function applyOp(doc: Layout, op: ChangeOp): void {
  switch (op.op) {
    case "setBinding": {
      checkSlot(doc, op.at).bindings[op.at.position] = structuredClone(op.binding);
      return;
    }
    case "moveBinding": {
      const from = checkSlot(doc, op.from);
      const to = checkSlot(doc, op.to);
      if (slotsEqual(op.from, op.to)) return;
      to.bindings[op.to.position] = from.bindings[op.from.position] as Binding;
      // Transparent would fall through to nothing on the base layer, so the vacated key says "none" there.
      from.bindings[op.from.position] = { kind: doc.layers[0] === from ? "none" : "transparent" };
      return;
    }
    case "swapBindings": {
      const a = checkSlot(doc, op.a);
      const b = checkSlot(doc, op.b);
      const held = a.bindings[op.a.position] as Binding;
      a.bindings[op.a.position] = b.bindings[op.b.position] as Binding;
      b.bindings[op.b.position] = held;
      return;
    }
    case "addLayer": {
      if (doc.layers.some((l) => l.id === op.layer.id)) throw new OpFailure("schema", `layer "${op.layer.id}" already exists`);
      const after = find(doc.layers, op.afterLayerId);
      if (after < 0) throw new OpFailure("unknown_ref", `no layer "${op.afterLayerId}" to add after`);
      const size = doc.layers[0]?.bindings.length ?? 0;
      const bindings: Binding[] = Array.from({ length: size }, () => ({ kind: "transparent" }));
      doc.layers.splice(after + 1, 0, { id: op.layer.id, name: op.layer.name, bindings });
      return;
    }
    case "removeLayer": {
      const at = find(doc.layers, op.layerId);
      if (at < 0) throw new OpFailure("unknown_ref", `no layer "${op.layerId}"`);
      doc.layers.splice(at, 1);
      return;
    }
    case "renameLayer": {
      layerOf(doc, op.layerId).name = op.name;
      return;
    }
    case "duplicateLayer": {
      const source = layerOf(doc, op.layerId);
      if (doc.layers.some((l) => l.id === op.layer.id)) throw new OpFailure("schema", `layer "${op.layer.id}" already exists`);
      // The copy has its own name and look; only what the keys do is copied. It goes last: a layer inserted
      // earlier would move every layer after it, and custom code that numbers layers would point at the wrong ones.
      doc.layers.push({ id: op.layer.id, name: op.layer.name, bindings: structuredClone(source.bindings) });
      return;
    }
    case "moveLayer": {
      const moving = layerOf(doc, op.layerId);
      layerOf(doc, op.afterLayerId);
      if (moving === doc.layers[0]) throw new OpFailure("schema", `layer "${op.layerId}" is the base layer and stays first`);
      if (op.layerId === op.afterLayerId) return;
      doc.layers.splice(find(doc.layers, op.layerId), 1);
      doc.layers.splice(find(doc.layers, op.afterLayerId) + 1, 0, moving);
      return;
    }
    case "setLayerStyle": {
      const layer = layerOf(doc, op.layerId);
      if (op.shortLabel === null) delete layer.shortLabel;
      else layer.shortLabel = op.shortLabel;
      if (op.color === null) delete layer.color;
      else layer.color = op.color;
      return;
    }
    case "upsertMacro": return upsert(doc.macros, op.macro);
    case "removeMacro": return remove(doc.macros, op.macroId, "macro");
    case "upsertTapDance": return upsert(doc.tapDances, op.tapDance);
    case "removeTapDance": return remove(doc.tapDances, op.tapDanceId, "tap dance");
    case "upsertCombo": return upsert(doc.combos, op.combo);
    case "removeCombo": return remove(doc.combos, op.comboId, "combo");
    case "upsertHoldTapProfile": return upsert(doc.holdTapProfiles, op.profile);
    case "setFirmwareSetting": {
      const at = doc.settings.findIndex((s) => s.firmware === op.setting.firmware && s.key === op.setting.key);
      if (at < 0) doc.settings.push(structuredClone(op.setting));
      else doc.settings[at] = structuredClone(op.setting);
      return;
    }
    // Only licenses a loss when the validator checks reachability (07); the document is unchanged.
    case "dropFunction": return;
  }
}

function upsert<T extends { id: string }>(items: T[], item: T): void {
  const at = find(items, item.id);
  if (at < 0) items.push(structuredClone(item));
  else items[at] = structuredClone(item);
}

function remove<T extends { id: string }>(items: T[], id: string, what: string): void {
  const at = find(items, id);
  if (at < 0) throw new OpFailure("unknown_ref", `no ${what} "${id}"`);
  items.splice(at, 1);
}
