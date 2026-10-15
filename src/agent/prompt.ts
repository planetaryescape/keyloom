// Prompt assembly (03#what-the-agent-sees). The stable parts come first so prompt caching holds
// across a conversation: system prompt, then the board, then what the firmware can express. The
// layout itself is fetched through tools so it never goes stale mid-conversation.
import type { Board } from "../boards/load.ts";
import { bindingLabel } from "../layout/render-grid.ts";
import type { Layout } from "../layout/schema.ts";
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
  if (board.skill) parts.push(`## Board notes\n${board.skill.trim()}`);
  return parts.join("\n\n");
}

/** What this firmware can and cannot express, short and generated from the rules the validator enforces (05, 06, 07). */
export function firmwareCapabilities(firmware: Layout["firmware"]): string {
  const common = [
    "Bindings: key (with optional modifiers), modifier, holdTap (tap half plus a modifier or layer hold, with a hold-tap profile), layer (momentary, toggle, to, oneShot), macro, transparent, none.",
    "Macros are steps: tap, press, release (a key code and/or modifiers) and waitMs. Combos fire an output binding when several positions are pressed together.",
  ];
  const qmk = [
    "QMK hold-tap feel: profiles can differ in TAPPING_TERM and QUICK_TAP_TERM (milliseconds) and in PERMISSIVE_HOLD and HOLD_ON_OTHER_KEY_PRESS (true or false), because QMK sets those per key. CHORDAL_HOLD, FLOW_TAP_TERM and RETRO_TAPPING are layout-wide: change them with setFirmwareSetting, not in a profile. Two keys with the same tap and hold must share their values.",
    "QMK: the tap half of a hold-tap must be a basic keycode with no modifiers. One right-hand modifier makes a whole mod-tap right-handed, so mixed left and right modifiers on one hold-tap are an error.",
    "QMK: at most 32 layers, 8 when LAYER_STATE_8BIT is set. Tap dance is not modelled; it is imported as a native binding that keyloom keeps but cannot edit.",
  ];
  const zmk = [
    "ZMK: hold-tap behaviours have flavors and per-key timing set through hold-tap profiles. A profile's options are the behaviour's properties: flavor (hold-preferred, balanced, tap-preferred, tap-unless-interrupted), tapping-term-ms, quick-tap-ms, require-prior-idle-ms (milliseconds), hold-trigger-key-positions (a list of key positions) and a true or false flag such as hold-trigger-on-release. The built-in profiles mt and lt can be tuned like any other.",
  ];
  return ["# What this firmware can express", ...common, ...(firmware === "qmk" ? qmk : zmk)].join("\n");
}

const PRIORITY_LABEL: Record<PriorityFact["priorityKind"], string> = {
  pinned: "pinned: must not move",
  rarely_used: "rarely used: can give up its place",
  frequent: "used often: keep it easy to reach",
  willing_to_relearn: "willing to relearn: can move",
};

/** What BK has told keyloom matters (08). Keys are named as the editor names them ("key 29 on Layer 0"), so the agent repeats them right. */
export function prioritiesContext(priorities: readonly PriorityFact[], document: Layout): string {
  const header = "# What BK has told you matters";
  if (priorities.length === 0) return `${header}\nNothing recorded yet. Ask before you guess what must stay put or what he barely uses.`;
  const lines = priorities.map((p) => {
    const about = [
      ...(p.subject.functions ?? []),
      ...(p.subject.slots ?? []).map((s) => `key ${s.position + 1} on ${document.layers.find((l) => l.id === s.layerId)?.name ?? s.layerId}`),
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

/** "key 60 on Layer 0", the way the editor names it, and at most a handful of them so one big rearrangement does not flood the prompt. */
function keysText(slots: readonly { layerId: string; position: number }[], document: Layout): string {
  const named = slots.slice(0, MAX_KEYS_LISTED).map((s) => `key ${s.position + 1} on ${document.layers.find((l) => l.id === s.layerId)?.name ?? s.layerId}`);
  return slots.length > MAX_KEYS_LISTED ? `${named.join(", ")} and ${slots.length - MAX_KEYS_LISTED} more` : named.join(", ");
}

/**
 * What keyloom changed earlier and why (08). Each carries its status, because "tried and liked" outweighs
 * "we thought this would be comfortable" (D-018), and its id, so the agent can record how it turned out.
 */
export function choicesContext(choices: readonly ChoiceFact[], document: Layout): string {
  const header = "# What was decided earlier, and why";
  if (choices.length === 0) return `${header}\nNothing yet: no change made through keyloom has been remembered.`;
  const lines = choices.map((c) => {
    const where = keysText(c.subject.slots ?? [], document);
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

export function assembleSystemPrompt(
  board: Board, document: Layout, priorities: readonly PriorityFact[] = [], choices: readonly ChoiceFact[] = [],
): string {
  return [
    system.trim(), boardContext(board), firmwareCapabilities(document.firmware), prioritiesContext(priorities, document), choicesContext(choices, document),
  ].join("\n\n");
}

/**
 * "Selected on Layer 0 (layer id layer-0): key 30 (position 29) S/⌥; key 31 (position 30) D": each user
 * message carries the selection made when it was sent (D-012). Both numbers are given because BK
 * talks in key numbers and ops take positions; the header ends at the first blank line.
 */
export function userMessageText(text: string, selection: Selection | undefined, document: Layout): string {
  if (!selection) return text;
  const layer = document.layers.find((l) => l.id === selection.layerId);
  const ctx = { layers: document.layers, macros: document.macros, tapDances: document.tapDances };
  const keys = selection.positions.map((p) => {
    const binding = layer?.bindings[p];
    return `key ${p + 1} (position ${p}) ${binding ? bindingLabel(binding, ctx) : "?"}`;
  });
  return `Selected on ${layer?.name ?? selection.layerId} (layer id ${selection.layerId}): ${keys.join("; ")}\n\n${text}`;
}

/** What BK typed, without the selection header `userMessageText` put in front of it. */
export function typedText(stored: string): string {
  if (!stored.startsWith("Selected")) return stored;
  const end = stored.indexOf("\n\n");
  return end < 0 ? stored : stored.slice(end + 2);
}
