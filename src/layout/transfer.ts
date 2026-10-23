// Carrying a key's behaviour, or a layer's LED colours, from a layout on one board to a layout on
// another (20#copying). The correspondence (which key maps to which) is decided elsewhere; this
// decides what the copied key becomes in the target: modifiers take the hand of the key they land
// on, layer keys point at the matching layer, macros and tap dances come along, and a hold-tap gets
// a profile that fits the target (a ZMK profile lists the other hand's positions, a QMK one is
// reused). What cannot be carried is returned as a reason, never approximated. Pure.
import type { ChangeOp } from "./change.ts";
import { deepEqual } from "./equal.ts";
import { translateHoldTapProfile } from "./kanata/profiles.ts";
import { type Hand, modsForHand } from "./mirror.ts";
import { GenerateError } from "./kanata/generate-error.ts";
import { macroAction } from "./kanata/macro.ts";
import { type KeptMap, readNative } from "./native-read.ts";
import { keptDefinitions } from "./kept-behaviours.ts";
import { writeSteps, type TargetFacts } from "./native-write.ts";
import { NO_TAP, ownTap } from "./rewrap.ts";
import type { Binding, Hsv, HoldTapProfile, LayerLighting, Layout, Macro, SlotAction, TapDance } from "./schema.ts";

export type TransferEnv = {
  source: Layout;
  target: Layout;
  /** Source layer id to target layer id, from the layer match. */
  layers: ReadonlyMap<string, string>;
  /** The target board's facts: which hand and finger a position is under, and what a hold on a hand should wait for. */
  handAt(position: number): Hand | null;
  fingerAt(position: number): string | null;
  /** Positions on the target board a hold-tap on `hand` should wait for: the other hand's keys and the thumbs. */
  triggerPositions(hand: Hand): number[];
  /**
   * Whether a ZMK `hold-trigger-key-positions` list on the source board is "the other hand's keys and the thumbs" for a key on `hand`,
   * which is the one list kanata's opposite-hand variants express. Only a copy onto a kanata board needs it.
   */
  sourceTriggerIsOppositeHand?(positions: number[], hand: Hand): boolean;
  /**
   * Put a whole layout on a new board (22): a hold-tap on a target with the source's firmware keeps its source profile, with its
   * settings, instead of getting a profile built for the hand. Absent for a copy of some keys onto a layout that has its own profiles.
   */
  keepProfiles?: boolean;
  /**
   * What the target board can do, for natives whose meaning it may or may not write (lighting keys, Bluetooth). Absent, the target
   * has no lighting keyloom writes and Bluetooth only when it runs ZMK.
   */
  targetFacts?: TargetFacts;
};

export type Transferred = { binding: Binding } | { skip: string };

const uniqueId = (taken: ReadonlySet<string>, base: string) => {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
};

const DEFAULT_ZMK_HOLD_TAP = { bindings: "&kp &kp", flavor: "balanced", "tapping-term-ms": 280, "quick-tap-ms": 175, "require-prior-idle-ms": 150 } as const;

export class BindingTransfer {
  private readonly ops = new Map<string, ChangeOp>();
  private readonly macros: Macro[];
  private readonly tapDances: TapDance[];
  private readonly profiles: HoldTapProfile[];
  /** Profiles made in this copy, by hand: the second home-row key on a hand shares the first's profile instead of getting its own. */
  private readonly made = new Map<string, string>();
  private readonly kept: KeptMap;
  private readonly facts: TargetFacts;

  constructor(private readonly env: TransferEnv) {
    this.macros = [...env.target.macros];
    this.tapDances = [...env.target.tapDances];
    this.profiles = [...env.target.holdTapProfiles];
    this.kept = keptDefinitions(env.source.passthrough);
    this.facts = env.targetFacts ?? { board: env.target.boardId, lighting: { supported: false }, bluetooth: env.target.firmware === "zmk" };
  }

  /**
   * Binding a key may add a macro, tap dance or profile it needs. If the caller then decides not to use the
   * binding, `rollback` removes what that call added, so no op is left behind for a key that was not copied.
   */
  checkpoint(): { macros: number; tapDances: number; profiles: number; ops: string[] } {
    return { macros: this.macros.length, tapDances: this.tapDances.length, profiles: this.profiles.length, ops: [...this.ops.keys()] };
  }

  rollback(cp: ReturnType<BindingTransfer["checkpoint"]>): void {
    this.macros.length = cp.macros;
    this.tapDances.length = cp.tapDances;
    this.profiles.length = cp.profiles;
    for (const key of [...this.ops.keys()]) if (!cp.ops.includes(key)) this.ops.delete(key);
    for (const [hand, id] of [...this.made]) if (!this.profiles.some((p) => p.id === id)) this.made.delete(hand);
  }

  /** The upserts the carried bindings depend on, to run before the `setBinding` ops. */
  prerequisiteOps(): ChangeOp[] {
    return [...this.ops.values()];
  }

  bind(source: Binding, target: Binding, position: number): Transferred {
    const hand = this.env.handAt(position);
    switch (source.kind) {
      case "key":
      case "transparent":
      case "none":
        return { binding: source };
      case "modifier":
        return { binding: hand === null ? source : { kind: "modifier", mods: modsForHand(source.mods, hand) } };
      case "layer": {
        const layerId = this.env.layers.get(source.layerId);
        return layerId === undefined ? { skip: this.noLayer(source.layerId) } : { binding: { ...source, layerId } };
      }
      case "holdTap": {
        const tap = ownTap(target);
        if (tap === null) return { skip: NO_TAP };
        let hold = source.hold;
        if ("mods" in hold) {
          if (hand === null) return { skip: "the key it lands on belongs to neither hand, so a modifier has no hand to take" };
          hold = { mods: modsForHand(hold.mods, hand) };
        } else {
          const layerId = this.env.layers.get(hold.layerId);
          if (layerId === undefined) return { skip: this.noLayer(hold.layerId) };
          hold = { layerId };
        }
        const profileId = this.profileFor(source, target, position, hand);
        return { binding: { kind: "holdTap", tap, hold, profileId } };
      }
      case "macro": {
        const macro = this.env.source.macros.find((m) => m.id === source.macroId);
        if (macro === undefined) return { skip: `it runs macro "${source.macroId}", which the source layout does not have` };
        const unwritable = this.kanataRefusal(() => macroAction(macro));
        if (unwritable !== null) return { skip: `its macro "${macro.name}" can't be written for kanata: ${unwritable}` };
        return { binding: { kind: "macro", macroId: this.macroFor(macro) } };
      }
      case "tapDance": {
        const dance = this.env.source.tapDances.find((t) => t.id === source.tapDanceId);
        if (dance === undefined) return { skip: `it uses tap dance "${source.tapDanceId}", which the source layout does not have` };
        const slots: Partial<Record<"tap" | "hold" | "doubleTap" | "tapThenHold", SlotAction>> = {};
        for (const name of ["tap", "hold", "doubleTap", "tapThenHold"] as const) {
          const slot = dance[name];
          if (slot === undefined) continue;
          const moved = this.slot(slot, hand);
          if ("skip" in moved) return moved;
          slots[name] = moved.action;
        }
        const copy: TapDance = {
          id: dance.id,
          name: dance.name,
          tap: slots.tap as SlotAction,
          ...(slots.hold ? { hold: slots.hold } : {}),
          ...(slots.doubleTap ? { doubleTap: slots.doubleTap } : {}),
          ...(slots.tapThenHold ? { tapThenHold: slots.tapThenHold } : {}),
          ...(dance.termMs === undefined ? {} : { termMs: dance.termMs }),
        };
        return { binding: { kind: "tapDance", tapDanceId: this.tapDanceFor(copy) } };
      }
      case "native":
        return this.native(source);
    }
  }

  /**
   * A native whose meaning is known (native-read.ts) becomes what the target writes for it, or is skipped with the target's own reason.
   * A `&magic`-style hold of a layer becomes the layer's momentary binding; its tap is not carried, and the copy says so.
   */
  private native(source: Extract<Binding, { kind: "native" }>): Transferred {
    const reading = readNative(source, this.kept);
    if (reading.kind === "unknown") return { skip: `it is ${source.label}, ${source.firmware.toUpperCase()} code that only works on its own keyboard` };
    if (reading.kind === "holdLayer") {
      const layerId = this.env.layers.get(reading.layerId);
      if (layerId === undefined) return { skip: this.noLayer(reading.layerId) };
      this.notes.push(`${source.label} holds its layer while it is held; its tap (&${reading.tap}) is not carried`);
      return { binding: { kind: "layer", action: "momentary", layerId } };
    }
    const target = this.env.target.firmware;
    const written = writeSteps(reading.steps, target, this.facts);
    if ("why" in written) return { skip: written.why };
    return { binding: { kind: "native", firmware: target, source: written.source, label: written.label } };
  }

  /** Why kanata's output can't say what the generator was asked to, or null when it can, or when the target isn't kanata. Skipping here keeps a put a set of warnings, not a validation failure. */
  private kanataRefusal(write: () => unknown): string | null {
    if (this.env.target.firmware !== "kanata") return null;
    try {
      write();
      return null;
    } catch (err) {
      if (err instanceof GenerateError) return err.message;
      throw err;
    }
  }

  private noLayer(id: string): string {
    const name = this.env.source.layers.find((l) => l.id === id)?.name ?? id;
    return `it switches to the ${name} layer, and the target has no layer that does the same job`;
  }

  private slot(a: SlotAction, hand: Hand | null): { action: SlotAction } | { skip: string } {
    switch (a.kind) {
      case "key": return { action: a };
      case "modifier": return { action: hand === null ? a : { kind: "modifier", mods: modsForHand(a.mods, hand) } };
      case "layer": {
        const layerId = this.env.layers.get(a.layerId);
        return layerId === undefined ? { skip: this.noLayer(a.layerId) } : { action: { ...a, layerId } };
      }
      case "macro": {
        const macro = this.env.source.macros.find((m) => m.id === a.macroId);
        if (macro === undefined) return { skip: `a tap dance slot runs macro "${a.macroId}", which the source layout does not have` };
        const unwritable = this.kanataRefusal(() => macroAction(macro));
        if (unwritable !== null) return { skip: `a tap dance slot runs macro "${macro.name}", which can't be written for kanata: ${unwritable}` };
        return { action: { kind: "macro", macroId: this.macroFor(macro) } };
      }
    }
  }

  private macroFor(macro: Macro): string {
    const same = this.macros.find((m) => deepEqual(m.steps, macro.steps));
    if (same !== undefined) return same.id;
    const id = uniqueId(new Set(this.macros.map((m) => m.id)), macro.id);
    const copy = { ...macro, id };
    this.macros.push(copy);
    this.ops.set(`macro:${id}`, { op: "upsertMacro", macro: copy });
    return id;
  }

  private tapDanceFor(dance: TapDance): string {
    const same = this.tapDances.find((t) => deepEqual({ ...t, id: "", name: "" }, { ...dance, id: "", name: "" }));
    if (same !== undefined) return same.id;
    const id = uniqueId(new Set(this.tapDances.map((t) => t.id)), dance.id);
    const copy = { ...dance, id };
    this.tapDances.push(copy);
    this.ops.set(`dance:${id}`, { op: "upsertTapDance", tapDance: copy });
    return id;
  }

  /**
   * The profile a copied hold-tap uses in the target. A key that already is a hold-tap keeps its
   * profile (its feel is tuned to that key); else the profile used by the target's hold-taps under
   * the same finger, then the same hand; else a new one built for this hand. On ZMK the new one waits
   * for the other hand, which is what makes a home-row modifier safe to roll past.
   */
  private profileFor(source: Extract<Binding, { kind: "holdTap" }>, target: Binding, position: number, hand: Hand | null): string {
    if (target.kind === "holdTap" && this.profiles.some((p) => p.id === target.profileId)) return target.profileId;
    const firmware = this.env.target.firmware;
    if (this.env.keepProfiles === true && firmware === this.env.source.firmware) {
      const kept = this.keptProfile(source, hand);
      if (kept !== undefined) return kept;
    }
    const users: Array<{ position: number; profileId: string }> = [];
    for (const layer of this.env.target.layers) layer.bindings.forEach((b, p) => b.kind === "holdTap" && users.push({ position: p, profileId: b.profileId }));
    if (firmware === "kanata") return this.kanataProfile(source, hand);
    const known = users.filter((u) => this.profiles.find((p) => p.id === u.profileId)?.firmware === firmware);
    const finger = this.env.fingerAt(position);
    const mostUsed = (list: typeof users) => {
      const counts = new Map<string, number>();
      for (const u of list) counts.set(u.profileId, (counts.get(u.profileId) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
    };
    const sameFinger = known.filter((u) => hand !== null && this.env.handAt(u.position) === hand && this.env.fingerAt(u.position) === finger);
    const sameHand = known.filter((u) => hand !== null && this.env.handAt(u.position) === hand);
    const reuse = mostUsed(sameFinger) ?? mostUsed(sameHand);
    if (reuse !== undefined) return reuse;
    // QMK has no per-hand profile; any profile already on the layout is as good as another.
    if (firmware === "qmk") {
      const any = mostUsed(known);
      if (any !== undefined) return any;
    }
    const key = `${firmware}:${hand ?? "none"}`;
    const already = this.made.get(key);
    if (already !== undefined) return already;
    const id = this.newProfile(source, hand, firmware);
    this.made.set(key, id);
    return id;
  }

  /**
   * A kanata profile for a hold-tap that came from QMK or ZMK: the source profile translated by the table in
   * src/layout/kanata/profiles.ts. The same source profile always becomes the same kanata one, so a hand's home-row keys share it.
   * What the translation had to leave out is in the profile's name's notes (the agent reads them in the tool's text).
   */
  private kanataProfile(source: Extract<Binding, { kind: "holdTap" }>, hand: Hand | null): string {
    const key = `kanata:${source.profileId}`;
    const already = this.made.get(key);
    if (already !== undefined) return already;
    const from = this.env.source.holdTapProfiles.find((p) => p.id === source.profileId);
    const base = from ?? { id: source.profileId, name: "Hold-tap", firmware: this.env.source.firmware, options: {} };
    const { profile: translated, notes } = translateHoldTapProfile(base, this.env.source.settings, (positions) =>
      hand !== null && this.env.sourceTriggerIsOppositeHand?.(positions, hand) === true ? "opposite" : "other");
    // With no source profile (a layer held from a key that had no hold-tap) the timing is the default, and it isn't a home-row-mods profile.
    const id = uniqueId(new Set(this.profiles.map((p) => p.id)), from === undefined ? "layer-hold" : "home-row-mods");
    const profile: HoldTapProfile = { ...translated, id, name: from?.name ?? (from === undefined ? "Layer hold" : "Home-row mods") };
    this.notes.push(...notes);
    this.profiles.push(profile);
    this.made.set(key, id);
    this.ops.set(`profile:${id}`, { op: "upsertHoldTapProfile", profile });
    return id;
  }

  /**
   * The source's own profile on a same-firmware target. A ZMK profile that lists trigger positions is meant for one hand, so it is
   * made once per hand, with the list the target board's other hand and thumbs give; the source's list names the source board's keys.
   */
  private keptProfile(source: Extract<Binding, { kind: "holdTap" }>, hand: Hand | null): string | undefined {
    const from = this.env.source.holdTapProfiles.find((p) => p.id === source.profileId);
    if (from === undefined) return undefined;
    const positions = from.options["hold-trigger-key-positions"];
    const perHand = this.env.target.firmware === "zmk" && Array.isArray(positions) && hand !== null;
    const key = `kept:${from.id}:${perHand ? hand : ""}`;
    const already = this.made.get(key);
    if (already !== undefined) return already;
    const id = uniqueId(new Set(this.profiles.map((p) => p.id)), perHand ? `${from.id}-${hand}` : from.id);
    const options = { ...from.options };
    if (perHand) {
      options["hold-trigger-key-positions"] = this.env.triggerPositions(hand);
      if (this.env.sourceTriggerIsOppositeHand?.(positions as number[], hand) !== true) {
        this.notes.push(`${from.name} waits for keys of the source board that have no equivalent here; on ${hand}-hand keys it waits for the other hand and the thumbs instead`);
      }
    }
    const profile: HoldTapProfile = { ...from, id, name: perHand ? `${from.name} (${hand} hand)` : from.name, options };
    this.profiles.push(profile);
    this.made.set(key, id);
    this.ops.set(`profile:${id}`, { op: "upsertHoldTapProfile", profile });
    return id;
  }

  /** What translating hold-tap profiles for the target had to leave out, for the agent to tell BK (D-024). */
  readonly notes: string[] = [];

  private newProfile(source: Extract<Binding, { kind: "holdTap" }>, hand: Hand | null, firmware: "qmk" | "zmk"): string {
    const from = this.env.source.holdTapProfiles.find((p) => p.id === source.profileId);
    const sourceTerm = typeof from?.options["tapping-term-ms"] === "number" ? from.options["tapping-term-ms"] : this.env.source.settings.find((s) => s.key === "TAPPING_TERM" && typeof s.value === "number")?.value;
    const id = uniqueId(new Set(this.profiles.map((p) => p.id)), hand === null || firmware === "qmk" ? "home-row-mods" : `home-row-mods-${hand}`);
    const profile: HoldTapProfile =
      firmware === "zmk"
        ? {
            id,
            name: hand === null ? "Home-row mods" : `Home-row mods (${hand} hand)`,
            firmware,
            options: {
              ...DEFAULT_ZMK_HOLD_TAP,
              ...(typeof sourceTerm === "number" ? { "tapping-term-ms": sourceTerm } : {}),
              ...(hand === null ? {} : { "hold-trigger-key-positions": this.env.triggerPositions(hand) }),
            },
          }
        : { id, name: "Home-row mods", firmware, options: {} };
    this.profiles.push(profile);
    this.ops.set(`profile:${id}`, { op: "upsertHoldTapProfile", profile });
    return id;
  }
}

export type LightingTransfer = {
  lighting: LayerLighting;
  /** Source positions whose own colour went to at least one target key. */
  carried: number[];
  /** Source positions that had a colour of their own and no key to put it on. */
  lost: number[];
};

const same = (a: Hsv | undefined, b: Hsv | undefined) => a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * The target layer's lighting: the source layer's colour for every key, and for each source key
 * with a colour of its own, that colour on the keys it maps to. A target key no source key maps to
 * keeps the layer colour, which is the nearest honest answer for "no counterpart".
 */
export function transferLighting(source: LayerLighting, targets: ReadonlyMap<number, readonly number[]>): LightingTransfer {
  const keys: Record<string, Hsv> = {};
  const carried: number[] = [];
  const lost: number[] = [];
  for (const [key, colour] of Object.entries(source.keys ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const to = targets.get(Number(key)) ?? [];
    if (to.length === 0) {
      lost.push(Number(key));
      continue;
    }
    carried.push(Number(key));
    for (const t of to) if (!same(colour, source.layer)) keys[String(t)] = colour;
    // A key whose colour equals the layer colour needs no entry of its own.
  }
  return { lighting: { ...(source.layer ? { layer: source.layer } : {}), ...(Object.keys(keys).length ? { keys } : {}) }, carried, lost };
}
