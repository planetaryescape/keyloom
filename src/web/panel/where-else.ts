// "Where else": the other keys that do what this key does, so replacing it is never a surprise
// about what the keyboard loses (16, D-092). Pure, so it is tested without a browser.
import type { Slot } from "../../layout/change.ts";
import { modsWords } from "../../layout/describe.ts";
import { bindingFunctions } from "../../layout/functions.ts";
import type { Binding, Layout, Mod } from "../../layout/schema.ts";
import { functionName } from "../editor/function-label.ts";
import { keyName } from "../editor/lost-functions.ts";

export type WhereElse = {
  function: string;
  /** The function in words ("Backspace", "Hold Navigate"). */
  name: string;
  others: Slot[];
};

const same = (a: Slot, b: Slot) => a.layerId === b.layerId && a.position === b.position;

/** Each function `binding` produces at `slot`, with the other keys (and layers) that produce it too. */
export function whereElse(layout: Layout, slot: Slot, binding: Binding): WhereElse[] {
  return bindingFunctions(binding, layout.tapDances).map((fn) => {
    const others: Slot[] = [];
    for (const layer of layout.layers) {
      layer.bindings.forEach((candidate, position) => {
        const at = { layerId: layer.id, position };
        if (!same(at, slot) && bindingFunctions(candidate, layout.tapDances).includes(fn)) others.push(at);
      });
    }
    return { function: fn, name: nameOf(fn, layout), others };
  });
}

// A hold in words ("Hold Right GUI"), where the board's legend would say "Hold r⌘".
function nameOf(fn: string, layout: Layout): string {
  return fn.startsWith("mod:") ? `Hold ${modsWords(fn.slice(4).split("+") as Mod[])}` : functionName(fn, layout);
}

const SHOWN = 3;

/** "also on Nav, key 12 and Sym, key 4", "also on 5 other keys", or "only on this key". */
export function whereElseSentence(entry: WhereElse, layout: Layout): string {
  if (entry.others.length === 0) return `${entry.name} is only on this key`;
  const named = entry.others.slice(0, SHOWN).map((slot) => keyName(layout, slot));
  const rest = entry.others.length - named.length;
  const list = rest > 0 ? `${named.join(", ")} and ${rest} more` : named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}` : (named[0] ?? "");
  return `${entry.name} is also on ${list}`;
}
