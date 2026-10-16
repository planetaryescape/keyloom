// The lab's engine on synthetic recordings (D-282): traces built to misfire with a known tapping term, run through a stand-in firmware,
// must be classified, must produce the fix that removes the misfires, and must say what the fix costs.
import { describe, expect, test } from "bun:test";
import { applyOps } from "../../src/layout/apply-ops.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { type Analysis, analyse } from "../../src/lab/analyse.ts";
import type { Passage } from "../../src/lab/passage-types.ts";
import { type Stroke, bkMoonlander, eventsOf, letterPositions, modelReplay, typeText } from "../helpers/typing-lab.ts";

const TEXT = (t: string): Passage => ({ id: "t", title: "t", why: "", steps: [{ kind: "text", text: t }] });

/** BK's layout with chordal hold and permissive hold off, so a roll that outlasts the tapping term is a hold. */
function plain(layout: Layout): Layout {
  return {
    ...layout,
    settings: layout.settings.filter((s) => s.key !== "CHORDAL_HOLD" && s.key !== "PERMISSIVE_HOLD"),
    holdTapProfiles: layout.holdTapProfiles.map((p) => ({ ...p, options: Object.fromEntries(Object.entries(p.options).filter(([k]) => k !== "CHORDAL_HOLD" && k !== "PERMISSIVE_HOLD")) })),
  };
}

const world = await bkMoonlander();
const base = plain(world.layout);
const at = letterPositions(base);
const S = at.s as number;
const D = at.d as number;
const J = at.j as number;

/** n rolls of S then D where S is held `held` ms and D goes down `lag` ms after it, held 40 ms. */
function sdRolls(n: number, opts: { held?: number; lag?: number; start?: number } = {}): Stroke[] {
  const { held = 260, lag = 150, start = 0 } = opts;
  return Array.from({ length: n }, (_, i): Stroke[] => {
    const t = start + i * 450;
    return [{ position: S, down: t, up: t + held }, { position: D, down: t + lag, up: t + lag + 40 }];
  }).flat();
}

async function run(passage: Passage, strokes: Stroke[], layout: Layout = base, extra: { maxRuns?: number; counted?: { runs: number } } = {}): Promise<Analysis> {
  const model = modelReplay(world.board);
  return analyse({
    board: world.board, layout, passage, events: eventsOf(strokes),
    replay: async (doc, events) => {
      if (extra.counted) extra.counted.runs++;
      return model(doc, events);
    },
    ...(extra.maxRuns === undefined ? {} : { maxRuns: extra.maxRuns }),
  });
}

describe("classifying what the firmware did with the keys that were pressed", () => {
  test("an S→D roll held past the tapping term is a hold where a tap was meant, and says how it happened", async () => {
    const a = await run(TEXT("sd".repeat(6)), sdRolls(6));
    expect(a.counts).toEqual({ misfireHold: 6, misfireTap: 0, typo: 0, missed: 0, double: 0 });
    const first = a.differences.find((d) => d.kind === "misfire-hold");
    expect(first).toMatchObject({ position: S, profileId: "home-row-mods", facts: { heldMs: 260, overlapMs: 110, nextPosition: D } });
    expect(a.findings[0]?.sentence).toContain("Option fired 6 times when you meant to type S");
    expect(a.findings[0]?.sentence).toContain("6 of them in a roll");
  });

  test("a recording the firmware handles well has no misfires and nothing to suggest", async () => {
    const a = await run(TEXT("sd".repeat(6)), sdRolls(6, { held: 120, lag: 60 }));
    expect(a.counts.misfireHold).toBe(0);
    expect(a.suggestions).toEqual([]);
    expect(a.emulatorRuns).toBe(1);
  });

  test("a hold step that comes out as the key's letter is a tap where a hold was meant", async () => {
    const passage: Passage = { id: "h", title: "h", why: "", steps: [{ kind: "hold", key: "s", then: "j" }, { kind: "hold", key: "s", then: "j" }, { kind: "hold", key: "s", then: "j" }] };
    // S is held 150 ms with J pressed and let go inside it: shorter than the term, and nothing makes it a hold.
    const strokes = [0, 500, 1000].flatMap((t): Stroke[] => [{ position: S, down: t, up: t + 150 }, { position: J, down: t + 40, up: t + 100 }]);
    const a = await run(passage, strokes);
    expect(a.counts.misfireTap).toBe(3);
    expect(a.counts.misfireHold).toBe(0);
    expect(a.differences[0]).toMatchObject({ kind: "misfire-tap", position: S });
  });

  test("a different key is a typo, a key never pressed is missed, and a key pressed twice at once is a double", async () => {
    const p = letterPositions(base);
    const word = (letters: string, extra: Stroke[] = []) => [...typeText(letters, p, { pace: 200 }), ...extra];
    const typo = await run(TEXT("cat"), [{ position: p.x as number, down: 0, up: 80 }, ...typeText("at", p, { pace: 200, start: 200 })]);
    expect(typo.differences).toEqual([expect.objectContaining({ kind: "typo", position: p.x, expectedPositions: [p.c] })]);

    const missed = await run(TEXT("cat"), word("ca"));
    expect(missed.differences).toEqual([expect.objectContaining({ kind: "missed", cause: "you", expectedPositions: [p.t] })]);

    const double = await run(TEXT("cat"), [...word("ca"), { position: p.a as number, down: 330, up: 370 }, { position: p.t as number, down: 700, up: 780 }]);
    expect(double.differences).toEqual([expect.objectContaining({ kind: "double", position: p.a })]);

    // The same letter typed twice on purpose, with time between, is not a double.
    const deliberate = await run(TEXT("ee"), [{ position: p.e as number, down: 0, up: 60 }, { position: p.e as number, down: 300, up: 360 }]);
    expect(deliberate.differences).toEqual([]);
  });

  test("the same recording in a different order of the array gives the same result", async () => {
    const strokes = sdRolls(4);
    const forward = await run(TEXT("sd".repeat(4)), strokes);
    const model = modelReplay(world.board);
    const shuffled = await analyse({
      board: world.board, layout: base, passage: TEXT("sd".repeat(4)), events: [...eventsOf(strokes)].reverse(), replay: model,
    });
    expect(shuffled.counts).toEqual(forward.counts);
    expect(shuffled.suggestions.map((s) => s.candidate.id)).toEqual(forward.suggestions.map((s) => s.candidate.id));
  });
});

describe("trying the same recording with other settings", () => {
  test("finds the tapping term that fixes the misfires and proposes it as ordinary ops", async () => {
    const a = await run(TEXT("sd".repeat(6)), sdRolls(6));
    const term = a.suggestions.find((s) => s.candidate.family.endsWith(":term"));
    expect(term).toBeDefined();
    expect(term?.evidence).toMatchObject({ scope: "profile", profileId: "home-row-mods", before: 6, after: 0, removed: 6, introduced: 0 });
    expect(term?.evidence.examples).toHaveLength(3);
    expect(term?.candidate.title).toBe("Raise the tapping term of Home-row mods from 200 to 280 ms");
    const ops = term?.ops ?? [];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "upsertHoldTapProfile", profile: { id: "home-row-mods", options: { TAPPING_TERM: 280 } } });
    // The proposal is proven the way the suggestion says: apply it and replay the recording.
    const fixed = applyOps(base, ops);
    expect(fixed.ok).toBe(true);
    const again = await run(TEXT("sd".repeat(6)), sdRolls(6), (fixed as { layout: Layout }).layout);
    expect(again.counts.misfireHold).toBe(0);
  });

  test("a layout-wide setting is tried on every key and offered when it clearly helps", async () => {
    const a = await run(TEXT("sd".repeat(6)), sdRolls(6));
    const chordal = a.suggestions.find((s) => s.candidate.id === "layout:CHORDAL_HOLD:on");
    expect(chordal?.evidence).toMatchObject({ scope: "layout", removed: 6, introduced: 0 });
    expect(chordal?.ops).toEqual([{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "CHORDAL_HOLD", value: true } }]);
  });

  test("a fix that breaks quick holds is not clear, and what it costs is counted", async () => {
    // Six rolls to fix, four quick holds (S held 250 ms, J inside it) that a longer term turns into taps.
    const holds = [0, 1, 2, 3].flatMap((i): Stroke[] => {
      const t = 5000 + i * 600;
      return [{ position: S, down: t, up: t + 250 }, { position: J, down: t + 100, up: t + 220 }];
    });
    const passage: Passage = { id: "m", title: "m", why: "", steps: [{ kind: "text", text: "sd".repeat(6) }, ...Array.from({ length: 4 }, () => ({ kind: "hold" as const, key: "s", then: "j" }))] };
    const a = await run(passage, [...sdRolls(6), ...holds]);
    expect(a.counts).toMatchObject({ misfireHold: 6, misfireTap: 0 });
    // Raising the term to 280 fixes the six rolls and turns the four quick holds into taps: a net of two for four new problems.
    expect(a.suggestions.some((s) => s.candidate.family.endsWith(":term"))).toBe(false);
    expect(a.notes.join("\n")).toContain("Raise the tapping term of Home-row mods from 200 to 280 ms would remove 6 misfire(s) and add 4, so it is not offered");
    // The layout-wide setting does not touch the quick holds, so it is still offered.
    expect(a.suggestions.map((s) => s.candidate.id)).toContain("layout:CHORDAL_HOLD:on");
  });

  test("one emulator run tries a setting for every profile at once, so the cost does not multiply by the number of profiles", async () => {
    // Give the right-hand keys a profile of their own, with their own rolls to fix.
    const split: Layout = {
      ...base,
      holdTapProfiles: [...base.holdTapProfiles, { id: "right-mods", name: "Right mods", firmware: "qmk", options: {} }],
      layers: base.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p) => (b.kind === "holdTap" && [36, 37, 39].includes(p) ? { ...b, profileId: "right-mods" } : b)) } : l)),
    };
    const H = at.h as number;
    const K = at.k as number;
    const hk = Array.from({ length: 6 }, (_, i): Stroke[] => [{ position: H, down: 3000 + i * 450, up: 3000 + i * 450 + 260 }, { position: K, down: 3000 + i * 450 + 150, up: 3000 + i * 450 + 190 }]).flat();
    const counted = { runs: 0 };
    const a = await run(TEXT("sd".repeat(6) + "hk".repeat(6)), [...sdRolls(6), ...hk], split, { counted });
    expect(a.counts.misfireHold).toBe(12);
    expect(a.suggestions.filter((s) => s.evidence.scope === "profile").map((s) => s.evidence.profileId).sort()).toEqual(["home-row-mods", "right-mods"]);
    // Baseline, five rounds at most for two profiles together, the fine round, the pair and the layout-wide settings: far fewer than one run per candidate per profile.
    expect(counted.runs).toBeLessThanOrEqual(12);
    expect(a.emulatorRuns).toBe(counted.runs);
  });

  test("a budget bounds the runs and says what it left out", async () => {
    const a = await run(TEXT("sd".repeat(6)), sdRolls(6), base, { maxRuns: 2 });
    expect(a.emulatorRuns).toBeLessThanOrEqual(3);
    expect(a.notes.join("\n")).toContain("stopped at 2 emulator runs");
    expect(a.coarseSearch).toBe(true);
  });
});

describe("checking the replay against what the keyboard typed", () => {
  test("a replay that types something else than the keyboard did is flagged", async () => {
    const a = await analyse({ board: world.board, layout: base, passage: TEXT("sd".repeat(6)), events: eventsOf(sdRolls(6)), replay: modelReplay(world.board), typedText: "sdsdsdsdsdsd", suggest: false });
    expect(a.fidelity).toMatchObject({ typedByKeyboard: 12, typedByReplay: 0, differing: 12 });
    expect(a.notes.join("\n")).toContain("treat the suggestions with care");
  });

  test("a replay that types the same is not flagged", async () => {
    const strokes = typeText("sdsd", { s: S, d: D }, { pace: 150 });
    const a = await analyse({ board: world.board, layout: base, passage: TEXT("sdsd"), events: eventsOf(strokes), replay: modelReplay(world.board), typedText: "sdsd", suggest: false });
    expect(a.fidelity?.differing).toBe(0);
    expect(a.notes).toEqual([]);
  });
});
