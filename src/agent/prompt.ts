// Prompt assembly (03#what-the-agent-sees). The stable parts come first so prompt caching holds
// across a conversation: system prompt, then the board, then what the firmware can express. The
// layout itself is fetched through tools so it never goes stale mid-conversation.
import { capabilityLine } from "../boards/capabilities.ts";
import { keyName } from "../boards/key-names.ts";
import type { Board } from "../boards/load.ts";
import { bindingLabel } from "../layout/render-grid.ts";
import type { Binding, Layout } from "../layout/schema.ts";
import type { ChoiceFact, PriorityFact } from "./ports.ts";
import type { Selection } from "./selection.ts";
import system from "./prompts/system.md" with { type: "text" };

/** Positions grouped by finger, because "which finger is S on" is how BK talks about it. */
function fingerSummary(board: Board["definition"]): string {
  const byFinger = new Map<string, number[]>();
  for (const [position, finger] of Object.entries(board.fingers)) {
    byFinger.set(finger, [...(byFinger.get(finger) ?? []), Number(position)]);
  }
  return [...byFinger.entries()].map(([finger, positions]) => `${finger}: ${positions.sort((a, b) => a - b).join(",")}`).join("\n");
}

export function boardContext(board: Board): string {
  const d = board.definition;
  const rows = Object.entries(d.rows).map(([name, positions]) => `${name} (${positions.length}): ${positions.join(",")}`);
  const parts = [
    `# Board: ${d.vendor} ${d.name} (${d.id}), ${d.firmware.toUpperCase()}`,
    `${d.keyCount} keys. Left hand positions: ${d.hands.left.join(",")}. Right hand positions: ${d.hands.right.join(",")}.`,
    `Rows by position:\n${rows.join("\n")}`,
    `Finger per position:\n${fingerSummary(d)}`,
    `Mirror pairs, left position and the right position at the same place on the other half: ${Object.entries(d.mirror).map(([l, r]) => `${l}<->${r}`).join(", ")}.`,
  ];
  parts.push(capabilityLine(d));
  if (board.skill) parts.push(`## Board notes\n${board.skill.trim()}`);
  return parts.join("\n\n");
}

/** What this firmware can and cannot express, short and generated from the rules the validator enforces (05, 06, 07). */
export function firmwareCapabilities(firmware: Layout["firmware"]): string {
  const common = [
    "Bindings: key (with optional modifiers), modifier, holdTap (tap half plus a modifier or layer hold, with a hold-tap profile), layer (momentary, toggle, to, oneShot), macro, tapDance (a key with up to four slots), transparent, none.",
    "Macros are steps: tap, press, release (a key code and/or modifiers), waitMs, and text (typed as written; US-layout letters, digits and punctuation, with Shift added where a character needs it). Tap dances are entries in the layout with a tap slot and optionally hold, doubleTap and tapThenHold slots (each a key, modifier, layer or macro action) and an optional termMs; a key uses one with a tapDance binding. Combos fire an output binding when several positions are pressed together.",
  ];
  const qmk = [
    "QMK hold-tap feel: profiles can differ in TAPPING_TERM and QUICK_TAP_TERM (milliseconds) and in PERMISSIVE_HOLD and HOLD_ON_OTHER_KEY_PRESS (true or false), because QMK sets those per key. CHORDAL_HOLD, FLOW_TAP_TERM and RETRO_TAPPING are layout-wide: change them with setFirmwareSetting, not in a profile. Two keys with the same tap and hold must share their values.",
    "QMK: the tap half of a hold-tap must be a basic keycode with no modifiers. One right-hand modifier makes a whole mod-tap right-handed, so mixed left and right modifiers on one hold-tap are an error.",
    "QMK: at most 32 layers, 8 when LAYER_STATE_8BIT is set. A tap dance becomes an Oryx-style state machine; one that keyloom could not read stays a native binding, and then keyloom cannot add tap dances beside it.",
  ];
  const zmk = [
    "ZMK: a tap dance becomes a `zmk,behavior-tap-dance` node, and a hold or tap-then-hold slot a generated tap-preferred hold-tap in that position. ZMK acts on other keys pressed between the taps before the dance resolves, which QMK does not, so tell him the double-tap feel can differ. A tap dance has no global fallback term on ZMK, so leave termMs out only if 200 ms is right.",
    "ZMK: hold-tap behaviours have flavors and per-key timing set through hold-tap profiles. A profile's options are the behaviour's properties: flavor (hold-preferred, balanced, tap-preferred, tap-unless-interrupted), tapping-term-ms, quick-tap-ms, require-prior-idle-ms (milliseconds), hold-trigger-key-positions (a list of key positions) and a true or false flag such as hold-trigger-on-release. The built-in profiles mt and lt can be tuned like any other.",
  ];
  const kanata = [
    "kanata (the MacBook's built-in keyboard): this is a software remapper, not firmware. Apply writes a config file and reloads it in under a second, with no build or flash. Hold-tap profiles take a variant (tap-hold, tap-hold-press, tap-hold-release, tap-hold-press-timeout, tap-hold-tap-keys, tap-hold-opposite-hand, tap-hold-opposite-hand-release), hold-ms, tap-repress-ms and optionally require-prior-idle-ms. The opposite-hand variants make a home-row modifier hold only when the other hand's key follows, which stops same-hand rolls becoming modifiers.",
    "kanata: a tap dance counts taps, so a hold or tap-then-hold slot can't be written. A macro can hold only modifiers across its steps. The fn/globe key stays as it is. Keep Escape and a Control key reachable: the validator refuses a layout without them, because this is the one keyboard that can't be swapped for another.",
  ];
  return ["# What this firmware can express", ...common, ...(firmware === "qmk" ? qmk : firmware === "zmk" ? zmk : kanata)].join("\n");
}

const PRIORITY_LABEL: Record<PriorityFact["priorityKind"], string> = {
  pinned: "pinned: must not move",
  rarely_used: "rarely used: can give up its place",
  frequent: "used often: keep it easy to reach",
  willing_to_relearn: "willing to relearn: can move",
};

/** What BK has told keyloom matters (08). Keys are named by legend and place ("⌫ (left pinky, home row, Layer 0)"), so the agent repeats them that way (D-279). */
export function prioritiesContext(priorities: readonly PriorityFact[], document: Layout, board: Board): string {
  const header = "# What BK has told you matters";
  if (priorities.length === 0) return `${header}\nNothing recorded yet. Ask before you guess what must stay put or what he barely uses.`;
  const lines = priorities.map((p) => {
    const about = [
      ...(p.subject.functions ?? []),
      ...(p.subject.slots ?? []).map((s) => keyName(board.definition, document, s, { geometry: board.geometry })),
    ].join(", ");
    return `- [${PRIORITY_LABEL[p.priorityKind]}] ${about}. He said: "${p.statement}"${p.reason === "stated by BK" ? "" : ` (${p.reason})`}`;
  });
  return [header, "These are recorded already; do not record them again.", ...lines].join("\n");
}

const STATUS_LABEL: Record<ChoiceFact["status"], string> = {
  hypothesis: "hypothesis: not tested yet, open to revision",
  tried_helpful: "tried and helped: needs a reason from BK before you undo it",
  tried_unhelpful: "tried, did not help: free to replace",
};

const MAX_KEYS_LISTED = 8;

/** "⌃← (left red thumb key, Layer 0)", by legend and place (D-279), and at most a handful so one big rearrangement does not flood the prompt. */
function keysText(slots: readonly { layerId: string; position: number }[], document: Layout, board: Board): string {
  const named = slots.slice(0, MAX_KEYS_LISTED).map((s) => keyName(board.definition, document, s, { geometry: board.geometry }));
  return slots.length > MAX_KEYS_LISTED ? `${named.join(", ")} and ${slots.length - MAX_KEYS_LISTED} more` : named.join(", ");
}

/**
 * What keyloom changed earlier and why (08). Each carries its status, because "tried and liked" outweighs
 * "we thought this would be comfortable" (D-018), and its id, so the agent can record how it turned out.
 */
export function choicesContext(choices: readonly ChoiceFact[], document: Layout, board: Board): string {
  const header = "# What was decided earlier, and why";
  if (choices.length === 0) return `${header}\nNothing yet: no change made through keyloom has been remembered.`;
  const lines = choices.map((c) => {
    const where = keysText(c.subject.slots ?? [], document, board);
    const parts = [
      `- ${c.id} [${STATUS_LABEL[c.status]}]${where ? ` ${where}.` : ""}`,
      `  Goal: "${c.goal}". Chosen: ${c.choice}. Why: ${c.reason}.`,
    ];
    const scope = [...c.scope.apps.map((a) => `app ${a}`), ...c.scope.habits];
    if (scope.length > 0) parts.push(`  Applies to: ${scope.join("; ")}.`);
    if (c.outcomeNote) parts.push(`  BK said: "${c.outcomeNote}".`);
    return parts.join("\n");
  });
  return [header, "Check these before you propose moving or replacing any of those keys. When a change touches one, quote its reason to BK and ask whether it still holds before you propose.", ...lines].join("\n");
}

/** The layouts besides this conversation's, by name and board, so the agent knows there is something to look at before it asks BK. */
export function otherLayoutsContext(others: readonly { layoutName: string; layoutId: string; board: Board; document: Layout }[]): string {
  const header = "# BK's other layouts (read-only)";
  if (others.length === 0) return `${header}\nNone: this is the only layout keyloom holds, so there is nothing to copy from.`;
  const lines = others.map((o) => `- "${o.layoutName}" (${o.layoutId}): ${o.board.definition.vendor} ${o.board.definition.name}, ${o.document.firmware.toUpperCase()}, ${o.document.layers.length} layers`);
  return [header, "Look at these with list_layouts and get_layout before asking BK about them.", ...lines].join("\n");
}

export function assembleSystemPrompt(
  board: Board, document: Layout, priorities: readonly PriorityFact[] = [], choices: readonly ChoiceFact[] = [], others: Parameters<typeof otherLayoutsContext>[0] = [],
): string {
  return [
    system.trim(), boardContext(board), firmwareCapabilities(document.firmware), otherLayoutsContext(others), prioritiesContext(priorities, document, board), choicesContext(choices, document, board),
  ].join("\n\n");
}

/**
 * "Selected on Layer 0 (layer id layer-0): S hold ⌥ (left ring, home row) at position 30; D (left middle, home row) at position 31":
 * each user message carries the selection made when it was sent (D-012). The name is how the agent speaks of the key; the position is
 * only for ops (D-279). The header ends at the first blank line.
 */
export function userMessageText(text: string, selection: Selection | undefined, document: Layout, board: Board, drafts: readonly Draft[] = []): string {
  const lines: string[] = [];
  if (selection) {
    const layer = document.layers.find((l) => l.id === selection.layerId);
    const keys = selection.positions.map((p) => `${keyName(board.definition, document, { layerId: selection.layerId, position: p }, { geometry: board.geometry, withLayer: false })} at position ${p}`);
    lines.push(`Selected on ${layer?.name ?? selection.layerId} (layer id ${selection.layerId}): ${keys.join("; ")}`);
  }
  // Changes BK made on a key's card and hasn't applied (D-317): dashed on his board, not in the layout. Proposals are against the
  // layout as it is; the agent can build on a draft or say when a proposal would undo one.
  for (const d of drafts) {
    const layer = document.layers.find((l) => l.id === d.layerId);
    const key = keyName(board.definition, document, { layerId: d.layerId, position: d.position }, { geometry: board.geometry, withLayer: false });
    const ctx = { layers: document.layers, macros: document.macros, tapDances: document.tapDances };
    lines.push(`Unapplied draft on ${layer?.name ?? d.layerId} (layer id ${d.layerId}), ${key} at position ${d.position}: would become ${bindingLabel(d.binding, ctx)} ${JSON.stringify(d.binding)}`);
  }
  return lines.length === 0 ? text : `${lines.join("\n")}\n\n${text}`;
}

/** A key change BK has drafted but not applied (D-317). */
export type Draft = { layerId: string; position: number; binding: Binding };

/** What BK typed, without the selection and draft header `userMessageText` put in front of it. */
export function typedText(stored: string): string {
  if (!stored.startsWith("Selected") && !stored.startsWith("Unapplied draft on ")) return stored;
  const end = stored.indexOf("\n\n");
  return end < 0 ? stored : stored.slice(end + 2);
}
