// "Do the same on the other hand" worked out deterministically (D-060): for each selected key, the
// key at its mirror position gives the behaviour, and the layout's own rules decide the hand of the
// modifiers and whether a ZMK hold-tap profile needs a mirrored twin. The model still writes the
// proposal; this is the part it would otherwise get wrong by counting positions or guessing hands.
import { handOfPosition, mirrorPartners } from "../boards/mirror.ts";
import type { BoardDefinition } from "../boards/schema.ts";
import type { ChangeOp } from "../layout/change.ts";
import { mirrorBinding, mirrorProfile } from "../layout/mirror.ts";
import type { Binding, Layout } from "../layout/schema.ts";

export type MirrorStep = {
  position: number;
  /** Null when the key has no mirror position on this board. */
  partner: number | null;
  outcome: { binding: Binding } | { unchanged: true } | { skip: string };
};

export type MirrorPlan = { layerId: string; steps: MirrorStep[]; ops: ChangeOp[] };

export function planMirror(doc: Layout, board: BoardDefinition, layerId: string, positions: readonly number[]): MirrorPlan {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (layer === undefined) throw new Error(`no layer "${layerId}"`);
  const partners = mirrorPartners(board);
  const profileOps = new Map<string, ChangeOp>();
  const setOps: ChangeOp[] = [];

  const steps = [...new Set(positions)].sort((a, b) => a - b).map((position): MirrorStep => {
    const partner = partners.get(position) ?? null;
    const hand = handOfPosition(board, position);
    const target = layer.bindings[position];
    const source = partner === null ? undefined : layer.bindings[partner];
    if (partner === null || hand === null || target === undefined || source === undefined) {
      return { position, partner, outcome: { skip: "this key has no mirror position on this board" } };
    }
    const outcome = mirrorBinding(source, target, hand);
    if (!("binding" in outcome)) return { position, partner, outcome };

    let binding = outcome.binding;
    if (binding.kind === "holdTap") {
      const profile = mirrorProfile(doc, binding.profileId, partners);
      if ("skip" in profile) return { position, partner, outcome: { skip: profile.skip } };
      binding = { ...binding, profileId: profile.profileId };
      if (profile.upsert) profileOps.set(profile.upsert.id, { op: "upsertHoldTapProfile", profile: profile.upsert });
    }
    setOps.push({ op: "setBinding", at: { layerId, position }, binding });
    return { position, partner, outcome: { binding } };
  });

  // Profiles first, so every setBinding that refers to one finds it.
  return { layerId, steps, ops: [...profileOps.values(), ...setOps] };
}
