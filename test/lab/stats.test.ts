// Per-finger numbers and the sentences that say them (D-283), on recordings built so each number is known.
import { describe, expect, test } from "bun:test";
import { align } from "../../src/lab/align.ts";
import { type Difference, physicalDifferences } from "../../src/lab/classify.ts";
import { intentSteps } from "../../src/lab/intent.ts";
import type { Passage } from "../../src/lab/passage-types.ts";
import { pressesOf } from "../../src/lab/presses.ts";
import { prepareEvents } from "../../src/lab/replay-input.ts";
import { fingerName, modPhrase, sentencesFor } from "../../src/lab/sentences.ts";
import { fingerStats, spread } from "../../src/lab/stats.ts";
import { type Stroke, bkMoonlander, eventsOf, letterPositions } from "../helpers/typing-lab.ts";

const { board, layout } = await bkMoonlander();
const at = letterPositions(layout);
const TEXT = (t: string): Passage => ({ id: "t", title: "t", why: "", steps: [{ kind: "text", text: t }] });

function stats(passage: Passage, strokes: Stroke[], differences?: (d: Difference[]) => Difference[]) {
  const events = prepareEvents(eventsOf(strokes));
  const presses = pressesOf(events);
  const aligned = align(presses, intentSteps(passage, layout, board).steps);
  const found = differences ? differences(physicalDifferences(aligned, presses)) : physicalDifferences(aligned, presses);
  return { stats: fingerStats({ board, layout, presses, aligned, differences: found }), differences: found, presses, aligned };
}

/** Keys pressed one after another, `gap` ms apart, each down `hold` ms. */
const run = (letters: string, gap: number, hold = 80, start = 0): Stroke[] =>
  [...letters].map((ch, i) => ({ position: at[ch] as number, down: start + i * gap, up: start + i * gap + hold }));

describe("the numbers", () => {
  test("spread is the median and the slowest tenth, and an empty list is all zero", () => {
    expect(spread([])).toEqual({ n: 0, median: 0, p90: 0 });
    expect(spread([5, 1, 3, 9, 7])).toEqual({ n: 5, median: 5, p90: 9 });
    expect(spread([4])).toEqual({ n: 1, median: 4, p90: 4 });
  });

  test("inter-key time is counted on the finger that pressed the second key, and a pause is not a transition", () => {
    const strokes = [...run("fjfjfjfj", 150), ...run("fj", 150, 80, 8000)];
    const { stats: s } = stats(TEXT("fjfjfjfjfj"), strokes);
    const leftIndex = s.fingers.find((f) => f.finger === "left-index");
    const rightIndex = s.fingers.find((f) => f.finger === "right-index");
    expect(leftIndex?.interKey).toMatchObject({ n: 3, median: 150 });
    // The f after the long pause starts a new stretch and is nobody's transition; the j after it is the fifth of the right index.
    expect(rightIndex?.interKey.n).toBe(5);
    expect(s.interKey.n).toBe(8);
  });

  test("error rate is the errors on a finger's keys over what that finger was asked to press, missed keys included", () => {
    const semi = layout.layers[0]?.bindings.findIndex((b) => b.kind === "key" && b.code === "SEMICOLON") as number;
    // Asked for ; four times: the pinky presses it once, then an l (a typo on the ring finger), and never the last two.
    const strokes: Stroke[] = [{ position: semi, down: 0, up: 60 }, { position: at.l as number, down: 200, up: 260 }];
    const { stats: s, differences } = stats(TEXT(";;;;"), strokes);
    expect(differences.map((d) => d.kind).sort()).toEqual(["missed", "missed", "typo"]);
    expect(s.fingers.find((f) => f.finger === "right-ring")).toMatchObject({ attempts: 1, errors: 1, errorRate: 1, typos: 1, misfires: 0 });
    expect(s.fingers.find((f) => f.finger === "right-pinky")).toMatchObject({ attempts: 3, errors: 2, typos: 2, misfires: 0 });
    expect(s.errors).toBe(3);
  });

  test("same-finger pairs and rolls are grouped by key pair with the overlap of the rolls", () => {
    // d then e is the left middle finger twice; s then d is a roll of two fingers, overlapping by 40 ms every time.
    const strokes = Array.from({ length: 5 }, (_, i): Stroke[] => [
      { position: at.s as number, down: i * 400, up: i * 400 + 100 },
      { position: at.d as number, down: i * 400 + 60, up: i * 400 + 120 },
      { position: at.e as number, down: i * 400 + 300, up: i * 400 + 340 },
    ]).flat();
    const { stats: s } = stats(TEXT("sde".repeat(5)), strokes);
    const roll = s.rolls.find((r) => r.from === at.s && r.to === at.d);
    expect(roll).toMatchObject({ n: 5, rolls: 5, fromFinger: "left-ring", toFinger: "left-middle", overlap: { median: 40 } });
    expect(s.sameFinger.find((r) => r.from === at.d && r.to === at.e)).toMatchObject({ finger: "left-middle", interKey: { n: 5, median: 240 } });
  });

  test("mod-tap hold times are kept apart for taps and holds, with how many taps came near the term", () => {
    const taps = [150, 170, 190, 90].map((held, i): Stroke => ({ position: at.s as number, down: i * 600, up: i * 600 + held }));
    const { stats: s } = stats(TEXT("ssss"), taps);
    const row = s.holds.find((h) => h.position === at.s);
    expect(row).toMatchObject({ termMs: 200, nearTerm: 2, taps: { n: 4 } });
    expect(row?.holds.n).toBe(0);
  });
});

describe("the sentences", () => {
  const sentences = (passage: Passage, strokes: Stroke[], differences?: (d: Difference[]) => Difference[]) => {
    const r = stats(passage, strokes, differences);
    return sentencesFor({ stats: r.stats, layout, board, differences: r.differences }).map((f) => f.sentence);
  };

  test("a roll of a mod-tap key says its overlap in milliseconds and what the key does when held", () => {
    const strokes = Array.from({ length: 8 }, (_, i): Stroke[] => [
      { position: at.s as number, down: i * 400, up: i * 400 + 100 },
      { position: at.d as number, down: i * 400 + 60, up: i * 400 + 130 },
    ]).flat();
    const found = sentences(TEXT("sd".repeat(8)), strokes);
    expect(found).toContain("S→D rolls overlap by 40 ms (8 of 8 times); S types Option when held, so that is the time the firmware has to tell a roll from a hold (its tapping term is 200 ms).");
  });

  test("a finger that makes the most errors is named, but only when it is worse than the rest", () => {
    // Twelve keys, one error on each of the left index and the right pinky: nobody stands out.
    const none = sentences(TEXT("fjfjfjfjfjfj"), run("fjfjfjfjfjfj", 150));
    expect(none.some((s) => s.includes("causes most errors"))).toBe(false);
    // Now the right pinky is asked for ; twelve times and misses it five times.
    const semi = layout.layers[0]?.bindings.findIndex((b) => b.kind === "key" && b.code === "SEMICOLON") as number;
    const strokes = [...run("fjfjfjfjfj", 150), ...Array.from({ length: 12 }, (_, i): Stroke => ({ position: semi, down: 2000 + i * 200, up: 2000 + i * 200 + 60 }))];
    const found = sentences(TEXT(`fjfjfjfjfj${";".repeat(12)}`), strokes, (d) => d);
    expect(found.filter((s) => s.includes("causes most errors"))).toEqual([]);
    const wrong = Array.from({ length: 12 }, (_, i): Stroke => ({ position: (i < 6 ? at.l : semi) as number, down: 2000 + i * 200, up: 2000 + i * 200 + 60 }));
    const bad = sentences(TEXT(`fjfjfjfjfj${";".repeat(12)}`), [...run("fjfjfjfjfj", 150), ...wrong]);
    expect(bad.find((s) => s.includes("causes most errors"))).toMatch(/^Your right ring causes most errors: 6 of its \d+ keys went wrong \(\d+%\)/);
  });

  test("a slow finger is named with its time against the others', and a steady typist gets no such sentence", () => {
    const steady = sentences(TEXT("asdfjklasdfjklasdfjklasdfjkl"), run("asdfjklasdfjklasdfjklasdfjkl", 150));
    expect(steady.some((s) => s.includes("slow down"))).toBe(false);
    // The keys the right pinky presses (; and ') take 400 ms to reach, the rest 150.
    const semi = layout.layers[0]?.bindings.findIndex((b) => b.kind === "key" && b.code === "SEMICOLON") as number;
    let t = 0;
    const strokes: Stroke[] = [];
    const letters = "asdfjkl;";
    for (let i = 0; i < 160; i++) {
      const ch = letters[i % letters.length] as string;
      const position = ch === ";" ? semi : (at[ch] as number);
      t += ch === ";" ? 400 : 150;
      strokes.push({ position, down: t, up: t + 70 });
    }
    const slow = sentences(TEXT(Array.from({ length: 160 }, (_, i) => letters[i % letters.length]).join("")), strokes);
    expect(slow.find((s) => s.includes("slow down"))).toBe("You slow down on keys your right pinky presses: 400 ms to reach them, against 150 ms for your other fingers.");
  });

  test("names are plain words: fingers with spaces, modifiers as a Mac says them", () => {
    expect(fingerName("left-index")).toBe("left index");
    expect(modPhrase(["LCTL", "LSFT", "LALT", "LGUI"])).toBe("Control + Shift + Option + Command");
    expect(modPhrase(["LGUI", "RGUI"])).toBe("Command");
  });
});
