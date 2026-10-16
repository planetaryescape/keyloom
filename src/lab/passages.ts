// The built-in passages (24-typing-lab.md): ordinary words so the rolls are the ones real typing makes, a drill built from the layout's
// own home-row pairs and mod-tap keys so every pair is rolled and every hold is asked for, and a finger drill so each finger is measured.
import type { BoardDefinition } from "../boards/schema.ts";
import type { Layout } from "../layout/schema.ts";
import { codeOfChar, holdModsOf, tapCodeOf } from "./intent.ts";
import type { Passage, PassageStep } from "./passage-types.ts";

const PROSE = [
  "the quick brown fox jumps over the lazy dog while seven wizards quietly fix the old jukebox",
  "she sells sea shells by the sea shore and the shells she sells are surely sea shells",
  "a good plan today is better than a perfect plan tomorrow so start with what is in front of you",
  "pack my box with five dozen liquor jugs and send them off before the late afternoon train",
];

const text = (t: string): PassageStep => ({ kind: "text", text: t });

/** The letter a base-layer position types when tapped, if it is a letter. */
function letterAt(layout: Layout, position: number): string | undefined {
  const code = tapCodeOf(layout.layers[0]?.bindings[position]);
  return code !== undefined && /^[A-Z]$/.test(code) ? code.toLowerCase() : undefined;
}

/** Neighbours on the board's home row that are both letters on one hand: the pairs a roll goes between. */
function homePairs(layout: Layout, board: BoardDefinition): Array<[string, string]> {
  const home = board.rows.home ?? [];
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < home.length; i++) {
    const a = home[i] as number;
    const b = home[i + 1] as number;
    const sameHand = board.hands.left.includes(a) === board.hands.left.includes(b);
    const x = letterAt(layout, a);
    const y = letterAt(layout, b);
    if (sameHand && x !== undefined && y !== undefined && b === a + 1) pairs.push([x, y]);
  }
  return pairs;
}

function rolls(layout: Layout, board: BoardDefinition): Passage | undefined {
  const pairs = homePairs(layout, board);
  if (pairs.length === 0) return undefined;
  return {
    id: "home-row-rolls", title: "Home row rolls",
    why: "Each neighbouring pair on the home row, rolled both ways, so any pair where a tap-hold key turns into a hold shows up.",
    steps: [text(pairs.map(([a, b]) => `${a}${b}${a}${b}${a}${b} ${b}${a}${b}${a}${b}${a}`).join(" "))],
  };
}

function holds(layout: Layout, board: BoardDefinition): Passage | undefined {
  const bindings = layout.layers[0]?.bindings ?? [];
  const steps: PassageStep[] = [];
  for (const side of ["left", "right"] as const) {
    const mine = new Set(board.hands[side]);
    const other = new Set(board.hands[side === "left" ? "right" : "left"]);
    const homeLetters = (set: Set<number>) =>
      (board.rows.home ?? []).filter((p) => set.has(p) && bindings[p]?.kind === "key" && letterAt(layout, p) !== undefined).map((p) => letterAt(layout, p) as string);
    const targets = homeLetters(other);
    const near = homeLetters(mine);
    for (const p of board.rows.home ?? []) {
      if (!mine.has(p) || holdModsOf(bindings[p]) === undefined) continue;
      const key = letterAt(layout, p);
      if (key === undefined) continue;
      // Two keys on the other hand, and one on this hand: a hold with a same-hand key is what chordal hold would turn into a tap.
      for (const then of new Set([targets[0], targets[targets.length - 1], near[0]])) {
        if (then !== undefined) steps.push({ kind: "hold", key, then });
      }
    }
  }
  return steps.length === 0 ? undefined : { id: "home-row-holds", title: "Home row holds", why: "Each home row modifier held while another key is pressed, which is the other half of getting them right.", steps };
}

function fingers(layout: Layout, board: BoardDefinition): Passage | undefined {
  const byFinger = new Map<string, string[]>();
  for (const [position, finger] of Object.entries(board.fingers)) {
    const letter = letterAt(layout, Number(position));
    if (letter !== undefined && !finger.endsWith("thumb")) byFinger.set(finger, [...(byFinger.get(finger) ?? []), letter]);
  }
  const lines = [...byFinger.values()].filter((l) => l.length >= 2).map((l) => `${l.join("")} ${[...l].reverse().join("")} ${l.join("")}`);
  return lines.length === 0 ? undefined : { id: "finger-drill", title: "Finger drill", why: "Each finger's own keys, in order and back, so every finger has a speed and an error rate.", steps: [text(lines.join(" "))] };
}

export function builtinPassages(layout: Layout, board: BoardDefinition): Passage[] {
  const prose: Passage = { id: "prose", title: "A few sentences", why: "Everyday words, for the rolls real typing makes.", steps: [text(PROSE.join(" "))] };
  const parts = [holds(layout, board), rolls(layout, board), fingers(layout, board)].filter((p): p is Passage => p !== undefined);
  const starter: Passage = {
    id: "starter", title: "Starter",
    why: "A few holds, the home row rolled, then a few sentences: about three minutes.",
    steps: [...(parts.find((p) => p.id === "home-row-holds")?.steps ?? []), ...(parts.find((p) => p.id === "home-row-rolls")?.steps ?? []), text(" "), ...prose.steps.slice(0, 1), text(` ${PROSE[1]}`)],
  };
  return [starter, ...parts, prose];
}

/** The person's own text. Lower case, one space between words, and only what the lab can ask for. */
export function customPassage(raw: string): Passage {
  const clean = [...raw.toLowerCase().replace(/\s+/g, " ").trim()].filter((c) => codeOfChar(c) !== undefined).join("");
  return { id: "custom", title: "Your own text", why: "Text you chose.", steps: [text(clean)] };
}

/** The passage as a person reads it: text as it is, a hold as "[hold s, press j]". */
export function passageLines(passage: Passage): string {
  return passage.steps.map((s) => (s.kind === "text" ? s.text : ` [hold ${s.key}, press ${s.then}] `)).join("").replace(/ {2,}/g, " ").trim();
}
