// keyloom.kbd and safe.kbd from a layout on a kanata board (21). The file is plain text keyloom owns; it is rewritten whole
// on every Apply and checked with `kanata --check` before anything is loaded. One position is one `defsrc` key and one
// action in every `deflayer`, the same "binding N is key N" shape as the layout.
import type { BoardDefinition } from "../../boards/schema.ts";
import type { Binding, Layout, SlotAction, TapDance } from "../../layout/schema.ts";
import { type PhysicalKey, kanataRevision, physicalKeys } from "./board-config.ts";
import { GenerateError } from "../../layout/kanata/generate-error.ts";
import { macroAction } from "../../layout/kanata/macro.ts";
import { markerName, withHeader } from "./header.ts";
import { chord, keyName, modAction, safeName, textMacroItems } from "../../layout/kanata/names.ts";
import { ONE_SHOT_MS, nativeAction } from "../../layout/kanata/natives.ts";
import { isOppositeHand, readKanataProfile, tapHoldAction } from "../../layout/kanata/profiles.ts";
import { keptDefinitions } from "../../layout/kept-behaviours.ts";

export { GenerateError } from "../../layout/kanata/generate-error.ts";

export const KBD_FILE = "keyloom.kbd";
export const SAFE_FILE = "safe.kbd";
export const SAFE_REVISION = "safe";
/** The revision of the identity keyloom.kbd that setup writes, so the daemon has a config to start with before the first Apply. */
export const SETUP_REVISION = "setup";

const DEFAULT_TAP_DANCE_MS = 200;
const DEFAULT_COMBO_MS = 50;

export type KanataSource = {
  files: Array<{ path: string; content: string }>;
  /** The layer names the running kanata reports once this file is loaded, in order. */
  layerNames: string[];
  marker: string;
};

export type KanataGenerateInput = { layout: Layout; board: BoardDefinition; layoutId: string; revisionId: string; boardRevisionId?: string };

const physName = (k: PhysicalKey): string => (k.kind === "fn" ? "fn" : keyName(k.code));

const DEVICE_COMMENT = ";; The built-in keyboard only: BK's external boards stay with their own firmware.";

function defcfg(deviceName: string, combos: boolean): string {
  return [
    "(defcfg",
    "  ;; Keys keyloom doesn't list still reach the Mac.",
    "  process-unmapped-keys yes",
    "  ;; Transparent keys on a switched layer fall back to the first layer, as QMK's do.",
    "  delegate-to-first-layer yes",
    ...(combos ? ["  ;; Required by defchordsv2.", "  concurrent-tap-hold yes"] : []),
    `  ${DEVICE_COMMENT}`,
    `  macos-dev-names-include (${JSON.stringify(deviceName)})`,
    ")",
  ].join("\n");
}

/** Positions on one line each, so a diff of the file shows which row changed. */
function rowsOf(board: BoardDefinition): number[][] {
  const rowOf = new Map<number, string>();
  for (const [name, positions] of Object.entries(board.rows)) for (const p of positions) rowOf.set(p, name);
  const out: number[][] = [];
  for (let p = 0; p < board.keyCount; p++) {
    if (out.length === 0 || rowOf.get(p) !== rowOf.get(p - 1)) out.push([]);
    (out.at(-1) as number[]).push(p);
  }
  return out;
}

class Emitter {
  readonly aliases = new Map<string, { name: string; text: string; comment: string }>();
  usesAllKeys = false;
  usesSameHand = false;
  usesHands = false;
  private counter = 0;
  /** The layout's kept ZMK behaviours, read once for every native key the generator writes. */
  private readonly kept: ReturnType<typeof keptDefinitions>;

  constructor(
    readonly layout: Layout,
    readonly board: BoardDefinition,
    readonly phys: PhysicalKey[],
  ) {
    this.kept = keptDefinitions(layout.passthrough);
  }

  private alias(text: string, comment: string): string {
    const found = this.aliases.get(text);
    if (found) return `@${found.name}`;
    const name = `ht-${++this.counter}`;
    this.aliases.set(text, { name, text, comment });
    return `@${name}`;
  }

  layerName(id: string, where: string): string {
    if (!this.layout.layers.some((l) => l.id === id)) throw new GenerateError(`${where}: layer "${id}" doesn't exist`);
    return safeName(id);
  }

  macro(id: string, where: string): string {
    const m = this.layout.macros.find((x) => x.id === id);
    if (!m) throw new GenerateError(`${where}: macro "${id}" doesn't exist`);
    return `@m-${safeName(id)}`;
  }

  /** The action for a slot of a tap dance, which is what the same action on a key of its own would be. */
  slot(a: SlotAction, where: string): string {
    switch (a.kind) {
      case "key": return chord(a.code, a.mods);
      case "modifier": return modAction(a.mods);
      case "layer": return this.layerAction(a.action, a.layerId, where);
      case "macro": return this.macro(a.macroId, where);
    }
  }

  layerAction(action: "momentary" | "toggle" | "to" | "oneShot", layerId: string, where: string): string {
    const name = this.layerName(layerId, where);
    switch (action) {
      case "momentary": return `(layer-while-held ${name})`;
      case "toggle":
      case "to": return `(layer-switch ${name})`;
      case "oneShot": return `(one-shot ${ONE_SHOT_MS} (layer-while-held ${name}))`;
    }
  }

  holdTap(b: Extract<Binding, { kind: "holdTap" }>, where: string, position?: number): string {
    const profile = this.layout.holdTapProfiles.find((p) => p.id === b.profileId);
    if (!profile) throw new GenerateError(`${where}: hold-tap profile "${b.profileId}" doesn't exist`);
    if (profile.firmware !== "kanata") throw new GenerateError(`${where}: hold-tap profile "${profile.id}" is for ${profile.firmware}; translate it for kanata first (translateHoldTapProfile)`);
    const read = readKanataProfile(profile);
    if (!read.ok) throw new GenerateError(`${where}: hold-tap profile "${profile.id}": ${read.problems.join("; ")}`);
    const tap = b.tap.macroId !== undefined ? this.macro(b.tap.macroId, where) : chord(b.tap.code, b.tap.mods);
    const hold = "mods" in b.hold ? modAction(b.hold.mods) : this.layerAction("momentary", b.hold.layerId, where);
    let tapKeys = "$all-keys";
    if (read.spec.variant === "tap-hold-tap-keys") {
      if (read.spec.tapKeys === "all") this.usesAllKeys = true;
      else {
        const hand = position === undefined ? undefined : (["left", "right"] as const).find((h) => this.board.hands[h].includes(position));
        if (hand === undefined) throw new GenerateError(`${where}: hold-tap profile "${profile.id}" taps on the same hand's keys, but this key has no hand on ${this.board.id}`);
        this.usesSameHand = true;
        tapKeys = `$${hand}-keys`;
      }
    }
    if (isOppositeHand(read.spec.variant)) this.usesHands = true;
    const text = tapHoldAction(read.spec, tap, hold, tapKeys);
    const tapName = b.tap.macroId !== undefined ? (this.layout.macros.find((m) => m.id === b.tap.macroId)?.name ?? b.tap.macroId) : b.tap.code;
    return this.alias(text, `${tapName} taps, ${"mods" in b.hold ? b.hold.mods.join("+") : `layer ${b.hold.layerId}`} holds (profile ${profile.id})`);
  }

  binding(b: Binding, where: string, wayBack?: string, position?: number): string {
    switch (b.kind) {
      case "key": return chord(b.code, b.mods);
      case "modifier": return modAction(b.mods);
      case "holdTap": return this.holdTap(b, where, position);
      case "layer": return b.action === "toggle" && wayBack !== undefined ? wayBack : this.layerAction(b.action, b.layerId, where);
      case "macro": return this.macro(b.macroId, where);
      case "tapDance": return `@td-${safeName(this.dance(b.tapDanceId, where).id)}`;
      case "transparent": return wayBack ?? "_";
      case "none": return "XX";
      case "native": return nativeAction(b.firmware, b.source, where, this.kept);
    }
  }

  dance(id: string, where: string): TapDance {
    const td = this.layout.tapDances.find((t) => t.id === id);
    if (!td) throw new GenerateError(`${where}: tap dance "${id}" doesn't exist`);
    return td;
  }

  /**
   * kanata's tap-dance counts taps, but its action list takes any action, so a hold is a `tap-hold` placed in it (run through
   * kanata_simulated_input, v1.12.0: tap, hold, double tap and tap-then-hold each fire their own action). Tap plus hold alone needs no
   * dance at all. In a dance the hold only starts once the dance's own wait is over, so it fires a dance term later than a plain hold-tap.
   */
  danceAction(td: TapDance): string {
    const where = `tap dance "${td.name}"`;
    const term = td.termMs ?? DEFAULT_TAP_DANCE_MS;
    const slot = (a: SlotAction | undefined) => (a === undefined ? undefined : this.slot(a, where));
    const [tap, hold, dbl, tapThenHold] = [slot(td.tap) as string, slot(td.hold), slot(td.doubleTap), slot(td.tapThenHold)];
    const withHold = (onTap: string, onHold: string | undefined) => (onHold === undefined ? onTap : `(tap-hold ${term} ${term} ${onTap} ${onHold})`);
    const second = dbl === undefined && tapThenHold === undefined ? undefined : withHold(dbl ?? tap, tapThenHold);
    const first = withHold(tap, hold);
    return second === undefined ? first : `(tap-dance ${term} (${first} ${second}))`;
  }
}

export function generateKanataSource(input: KanataGenerateInput): KanataSource {
  const { layout, board } = input;
  if (board.firmware !== "kanata" || layout.firmware !== "kanata") throw new GenerateError(`${board.id} is not a kanata board`);
  const rev = kanataRevision(board, input.boardRevisionId);
  const phys = physicalKeys(board);
  const names = phys.map(physName);
  if (new Set(names).size !== names.length) throw new GenerateError(`${board.id} lists the same physical key twice`);
  const layerIds = layout.layers.map((l) => l.id);
  if (new Set(layerIds.map(safeName)).size !== layerIds.length) throw new GenerateError("two layer ids would have the same kanata name");
  for (const l of layout.layers) {
    if (l.bindings.length !== board.keyCount) throw new GenerateError(`layer "${l.id}" has ${l.bindings.length} bindings, ${board.id} has ${board.keyCount} keys`);
  }

  const e = new Emitter(layout, board, phys);
  const rows = rowsOf(board);

  // A toggle key's way back: in the layer it turns on, the same position returns to the layer it came from (21).
  const togglesInto = new Map<string, string>(); // `${targetLayer}:${position}` -> source layer
  for (const l of layout.layers) {
    l.bindings.forEach((b, p) => {
      if (b.kind === "layer" && b.action === "toggle" && b.layerId !== l.id) togglesInto.set(`${b.layerId}:${p}`, safeName(l.id));
    });
  }
  const base = safeName(layerIds[0] as string);
  const wayBackAt = (l: { id: string }, p: number, b: Binding): string | undefined => {
    const from = togglesInto.get(`${l.id}:${p}`);
    if (from === undefined) return b.kind === "layer" && b.action === "toggle" && b.layerId === l.id ? `(layer-switch ${base})` : undefined;
    if (b.kind === "transparent" || (b.kind === "layer" && b.action === "toggle" && b.layerId === l.id)) return `(layer-switch ${from})`;
    return undefined;
  };

  const deflayers = layout.layers.map((l) => {
    const lines = rows.map((row) =>
      `  ${row.map((p) => e.binding(l.bindings[p] as Binding, `layer "${l.id}", position ${p}`, wayBackAt(l, p, l.bindings[p] as Binding), p)).join(" ")}`);
    return `(deflayer ${safeName(l.id)}\n${lines.join("\n")}\n)`;
  });

  for (const m of layout.macros) e.aliases.set(`macro:${m.id}`, { name: `m-${safeName(m.id)}`, text: macroAction(m), comment: `macro "${m.name}"` });
  for (const td of layout.tapDances) {
    const used = layout.layers.some((l) => l.bindings.some((b) => b.kind === "tapDance" && b.tapDanceId === td.id)) || layout.combos.some((c) => c.output.kind === "tapDance" && c.output.tapDanceId === td.id);
    if (used) e.aliases.set(`td:${td.id}`, { name: `td-${safeName(td.id)}`, text: e.danceAction(td), comment: `tap dance "${td.name}"` });
  }

  const chords = layout.combos.map((c) => {
    const where = `combo "${c.name}"`;
    if (c.positions.some((p) => p >= board.keyCount)) throw new GenerateError(`${where} uses a position past the board's ${board.keyCount} keys`);
    const keys = c.positions.map((p) => names[p] as string);
    if (new Set(keys).size !== keys.length) throw new GenerateError(`${where} lists the same key twice`);
    const live = c.layerIds === "all" ? layerIds : c.layerIds;
    for (const id of live) if (!layerIds.includes(id)) throw new GenerateError(`${where} is on layer "${id}", which doesn't exist`);
    const disabled = layerIds.filter((id) => !live.includes(id)).map(safeName);
    return `  (${keys.join(" ")}) ${e.binding(c.output, where)} ${c.timeoutMs ?? DEFAULT_COMBO_MS} first-release (${disabled.join(" ")})`;
  });

  const blocks: string[] = [defcfg(rev.deviceName, chords.length > 0)];
  if (e.usesAllKeys) blocks.push(`(defvar\n  ;; Every key, for hold-taps where another key's press makes the held key a tap.\n  all-keys (${names.join(" ")})\n)`);
  if (e.usesSameHand) {
    const side = (hand: "left" | "right") => board.hands[hand].map((p) => names[p]).join(" ");
    blocks.push(`(defvar\n  ;; Each hand's keys, for hold-taps where a key on the same hand makes the held key a tap.\n  left-keys (${side("left")})\n  right-keys (${side("right")})\n)`);
  }
  if (e.usesHands) {
    const side = (hand: "left" | "right") => board.hands[hand].map((p) => names[p]).join(" ");
    blocks.push(`(defhands\n  (left ${side("left")})\n  (right ${side("right")})\n)`);
  }
  blocks.push(`(defsrc\n${rows.map((r) => `  ${r.map((p) => names[p]).join(" ")}`).join("\n")}\n)`);
  // The revision marker: kanata lists virtual keys over TCP, so keyloom can ask which revision a running kanata has loaded.
  const marker = markerName(input.revisionId);
  blocks.push(`(defvirtualkeys\n  ${marker} XX\n)`);
  if (e.aliases.size > 0) {
    blocks.push(`(defalias\n${[...e.aliases.values()].map((a) => `  ;; ${a.comment}\n  ${a.name} ${a.text}`).join("\n")}\n)`);
  }
  // kanata keeps one active layer, so "when two are held" has no form (D-388). Said here as well as by the validator's warning, so
  // a person reading the config doesn't look for it.
  if (layout.conditionalLayers.length > 0) {
    const named = (id: string) => safeName(id);
    blocks.push(`;; keyloom: these conditional layers are not written, because kanata has one active layer at a time:\n${layout.conditionalLayers
      .map((c) => `;;   ${c.ifLayerIds.map(named).join(" + ")} -> ${named(c.thenLayerId)}`).join("\n")}`);
  }
  blocks.push(...deflayers);
  if (chords.length > 0) blocks.push(`(defchordsv2\n${chords.join("\n")}\n)`);

  const body = `${blocks.join("\n\n")}\n`;
  const content = withHeader(body, input.layoutId, input.revisionId);

  const safeBody = `${[
    defcfg(rev.deviceName, false),
    `(defsrc\n${rows.map((r) => `  ${r.map((p) => names[p]).join(" ")}`).join("\n")}\n)`,
    `(defvirtualkeys\n  ${markerName(SAFE_REVISION)} XX\n)`,
    `;; Every key sends itself: remapping is off while this file is loaded.\n(deflayer safe\n${rows.map((r) => `  ${r.map((p) => names[p]).join(" ")}`).join("\n")}\n)`,
  ].join("\n\n")}\n`;

  return {
    files: [
      { path: KBD_FILE, content },
      { path: SAFE_FILE, content: withHeader(safeBody, "none", SAFE_REVISION) },
    ],
    layerNames: layerIds.map(safeName),
    marker,
  };
}

