// Deterministic checks shared by live scenarios and offline adversarial tests. No model calls here.
import type { BoardDefinition } from "../src/boards/schema.ts";
import type { ChangeOp } from "../src/layout/change.ts";
import { deepEqual } from "../src/layout/equal.ts";
import type { Binding, Layout } from "../src/layout/schema.ts";
import { homerowSameHandMods } from "../src/validation/hold-tap-rules.ts";
import { reachableLayers } from "../src/validation/reachability.ts";
import type { ValidationResult } from "../src/validation/result.ts";
import { evaluate } from "../src/validation/validate.ts";
import { DIGITS, F_POSITION, HOME_POSITIONS, J_POSITION, TOP_POSITIONS } from "./vocabulary-fixture.ts";

export type VocabularyProposal = { ops: readonly ChangeOp[]; validation: ValidationResult };

export function numberLayerPasses(board: BoardDefinition, before: Layout, proposal: VocabularyProposal): boolean {
  if (!proposal.validation.ok) return false;
  const { after, result } = evaluate(board, before, proposal.ops);
  if (!result.ok || !after) return false;
  const base = after.layers[0];
  const was = before.layers[0];
  if (!base || !was || base.id !== was.id || ![...HOME_POSITIONS, ...TOP_POSITIONS].every((p) => deepEqual(base.bindings[p], was.bindings[p]))) return false;
  const reachable = reachableLayers(after);
  return after.layers.some((layer, index) => index > 0 && reachable.has(layer.id) && DIGITS.every((code, i) => {
    const digit = layer.bindings[HOME_POSITIONS[i]!];
    const symbol = layer.bindings[TOP_POSITIONS[i]!];
    return digit?.kind === "key" && digit.code === code && !digit.mods?.length &&
      symbol?.kind === "key" && symbol.code === code && symbol.mods?.length === 1 && symbol.mods[0] === "LSFT";
  }));
}

export function homeRowModsPasses(board: BoardDefinition, before: Layout, proposal: VocabularyProposal): boolean {
  if (!proposal.validation.ok) return false;
  const { after, result } = evaluate(board, before, proposal.ops);
  if (!result.ok || !after) return false;
  const base = after.layers[0];
  if (!base || base.id !== before.layers[0]?.id) return false;
  const hazards = homerowSameHandMods(board, after);
  const keys: { position: number; code: string }[] = [{ position: F_POSITION, code: "F" }, { position: J_POSITION, code: "J" }];
  return keys.every(({ position, code }) => {
    return commandOn(base.bindings[position], code) &&
      (!hazards.some((w) => w.slots?.some((s) => s.layerId === base.id && s.position === position)) ||
        proposal.validation.warnings.some((w) => w.code === "homerow_same_hand_mods" &&
          w.slots?.some((s) => s.layerId === base.id && s.position === position)));
  });
}

function commandOn(binding: Binding | undefined, code: string): boolean {
  return binding?.kind === "holdTap" && binding.tap.code === code && !binding.tap.mods?.length && !binding.tap.macroId &&
    "mods" in binding.hold && binding.hold.mods.length === 1 && binding.hold.mods[0] === "LGUI";
}
