// Prompt assembly (03#what-the-agent-sees). The stable parts come first so prompt caching holds
// across a conversation: system prompt, then the board, then what the firmware can express. The
// layout itself is fetched through tools so it never goes stale mid-conversation.
import type { Board } from "../boards/load.ts";
import { bindingLabel } from "../layout/render-grid.ts";
import type { Layout } from "../layout/schema.ts";
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
    "QMK: the tap half of a hold-tap must be a basic keycode with no modifiers. One right-hand modifier makes a whole mod-tap right-handed, so mixed left and right modifiers on one hold-tap are an error.",
    "QMK: at most 32 layers, 8 when LAYER_STATE_8BIT is set. Tap dance is not modelled; it is imported as a native binding that keyloom keeps but cannot edit.",
  ];
  const zmk = ["ZMK: hold-tap behaviours have flavors and per-key timing set through hold-tap profiles."];
  return ["# What this firmware can express", ...common, ...(firmware === "qmk" ? qmk : zmk)].join("\n");
}

export function assembleSystemPrompt(board: Board, firmware: Layout["firmware"]): string {
  return [system.trim(), boardContext(board), firmwareCapabilities(firmware)].join("\n\n");
}

/** "Selected: layer-0 positions 29, 30, 31 (A, S/⌥, D)": each user message carries the selection made when it was sent (D-012). */
export function userMessageText(text: string, selection: Selection | undefined, document: Layout): string {
  if (!selection) return text;
  const layer = document.layers.find((l) => l.id === selection.layerId);
  const ctx = { layers: document.layers, macros: document.macros };
  const names = layer ? selection.positions.map((p) => (layer.bindings[p] ? bindingLabel(layer.bindings[p], ctx) : "?")).join(", ") : "";
  return `Selected: ${selection.layerId} positions ${selection.positions.join(", ")}${names ? ` (${names})` : ""}\n\n${text}`;
}
