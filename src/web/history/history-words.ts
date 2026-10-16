// A History row in people's words (D-312, P4 review), worked out when it is shown, so summaries stored before keys were named by what
// they print (D-279) read the same as new ones. The summary is stored text; this reads its known shapes and leaves anything else alone.
import { bindingLegend } from "../../layout/legend.ts";
import { layerDisplayName } from "../../layout/cap-words.ts";
import type { Layout } from "../../layout/schema.ts";

export interface HistoryWords {
  /** How the row was made when it isn't a plain change: "Undone", "Went back", "Redone". */
  how: string | null;
  /** The changed key as its cap prints it, for a small cap at the row's start. */
  cap: string | null;
  /** The layer the change is on, for the meta line. */
  layer: string | null;
  /** The change itself, one sentence without a colon chain. */
  text: string;
}

const PREFIX: Record<string, string> = { "Undo: ": "Undone", "Back to: ": "Went back", "Redo: ": "Redone" };

// Firmware's names for modifiers as the caps print them in words (D-270): "Right Ctrl + Right Alt" is "control + option".
const MOD_WORDS: readonly [RegExp, string][] = [
  [/\b(?:Left |Right )?(?:Ctrl|Control)\b/g, "control"],
  [/\b(?:Left |Right )?(?:Alt|Option)\b/g, "option"],
  [/\b(?:Left |Right )?(?:GUI|Cmd|Command|Gui)\b/g, "command"],
  [/\b(?:Left |Right )?Shift\b/g, "shift"],
];

function peopleWords(text: string): string {
  let out = text;
  for (const [pattern, word] of MOD_WORDS) out = out.replace(pattern, word);
  // "Tap A, hold control" reads as the card does: "A, hold for control".
  return out.replace(/^Tap (.+?), hold (?!for )/, "$1, hold for ");
}

export function historyWords(summary: string, layout: Pick<Layout, "layers" | "macros" | "tapDances">): HistoryWords {
  let rest = summary.trim();
  let how: string | null = null;
  // Prefixes can stack in old summaries ("Back to: Redo: X"); the first says how, the rest go.
  for (let match = /^(Undo|Back to|Redo): /.exec(rest); match !== null; match = /^(Undo|Back to|Redo): /.exec(rest)) {
    how ??= PREFIX[match[0]] ?? null;
    rest = rest.slice(match[0].length);
  }
  const layerNamed = (name: string) => layout.layers.find((layer) => layer.name === name);
  const capAt = (layerName: string, position: number): string | null => {
    const layer = layerNamed(layerName);
    const binding = layer?.bindings[position];
    if (binding === undefined) return null;
    return bindingLegend(binding, { layers: layout.layers, macros: layout.macros, tapDances: layout.tapDances }).tap || null;
  };

  // "Renamed layer-3 to Numbers": the id was never a name a person saw.
  const renamed = /^Renamed (.+) to (.+)$/.exec(rest);
  if (renamed !== null) {
    const was = /^layer-\d+$/.test(renamed[1] as string) || layout.layers.some((layer) => layer.id === renamed[1] && layer.name !== renamed[1]) ? "a layer" : layerDisplayName(renamed[1] as string);
    return { how, cap: null, layer: null, text: `Renamed ${was} to ${renamed[2]}` };
  }
  // Old: "Layer 0, key 25: X". The cap is the key's legend now, which is how the board names it.
  const numbered = /^(.+?), key (\d+): (.+)$/.exec(rest);
  if (numbered !== null) {
    const layer = numbered[1] as string;
    return { how, cap: capAt(layer, Number(numbered[2]) - 1), layer: layerDisplayName(layer), text: sentence(peopleWords(numbered[3] as string)) };
  }
  // New: "The A key on Base: F17".
  const named = /^(?:The|the) (.+?) key on (.+?): (.+)$/.exec(rest);
  if (named !== null) {
    return { how, cap: named[1] === "blank" ? null : (named[1] as string), layer: layerDisplayName(named[2] as string), text: sentence(peopleWords(named[3] as string)) };
  }
  // Any other summary: its key numbers read away, its words as people say them.
  return { how, cap: null, layer: null, text: sentence(peopleWords(rest.replace(/,? keys? \d+(?: of)?/g, "").replace(/: /g, ", "))) };
}

const sentence = (text: string): string => (text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1));
