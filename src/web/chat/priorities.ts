// What a remembered priority says, in words, for its chip. Pure, so the wording is tested without a browser.
import type { PriorityCard } from "../../api/http.ts";
import type { Layout } from "../../layout/schema.ts";
import { functionName } from "../editor/function-label.ts";
import { slotName } from "./proposal-facts.ts";

/** "Backspace" or "Layer 0, key 29": what the priority is about. */
export function priorityAbout(card: PriorityCard, layout: Layout): string {
  const functions = (card.subject.functions ?? []).map((fn) => functionName(fn, layout));
  const slots = (card.subject.slots ?? []).map((slot) => slotName(layout, slot));
  return [...functions, ...slots].join(", ");
}

export function priorityChipText(card: PriorityCard, layout: Layout): string {
  const about = priorityAbout(card, layout);
  switch (card.priorityKind) {
    case "pinned": return `${about} stays where it is`;
    case "rarely_used": return `${about}: rarely used`;
    case "frequent": return `${about}: used often`;
    case "willing_to_relearn": return `Happy to relearn ${about}`;
  }
}
