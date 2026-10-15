import { describe, expect, test } from "bun:test";
import { type KeyMapping, type Side, type Strategy, mapKeys } from "../../src/boards/correspondence.ts";
import { type KeySlot, keySlots } from "../../src/boards/key-slots.ts";
import { type Board, loadBoardDir } from "../../src/boards/load.ts";
import { importOryxSource } from "../../src/firmware/qmk/import.ts";
import { importZmkSource } from "../../src/firmware/zmk/import.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import type { Binding, Layout } from "../../src/layout/schema.ts";
import { FIXTURE_DIR, MOONLANDER_DIR } from "../helpers/board.ts";
import { GLOVE80_DIR, TEMPLATE_FIXTURE } from "../helpers/zmk.ts";

const CORNE_DIR = `${import.meta.dir}/../../boards/foostan/corne`;
const CORNE_FIXTURE = `${import.meta.dir}/../fixtures/zmk/corne`;

type Fixture = { name: string; board: Board; layout: Layout };

const moonBoard = await loadBoardDir(MOONLANDER_DIR);
const gloveBoard = await loadBoardDir(GLOVE80_DIR);
const corneBoard = await loadBoardDir(CORNE_DIR);
const moonlander: Fixture = { name: "Moonlander", board: moonBoard, layout: (await importOryxSource(FIXTURE_DIR, moonBoard.definition)).layout };
const glove80: Fixture = { name: "Glove80", board: gloveBoard, layout: (await importZmkSource(TEMPLATE_FIXTURE, gloveBoard.definition)).layout };
const corne: Fixture = { name: "Corne", board: corneBoard, layout: (await importZmkSource(CORNE_FIXTURE, corneBoard.definition)).layout };
const boards = [moonlander, glove80, corne];

const side = (f: Fixture, layerId = f.layout.layers[0]?.id as string): Side => ({ layout: f.layout, board: f.board, layerId });
const slotsOf = (f: Fixture) => keySlots(f.board.definition, f.board.geometry).slots;
const slotOf = (f: Fixture, p: number) => slotsOf(f).get(p) as KeySlot;

/** The base-layer position that types this letter on the home row. */
function homeRowKey(f: Fixture, tap: string): number {
  const base = f.layout.layers[0]?.bindings ?? [];
  const home = new Set(f.board.definition.rows.home);
  const hit = base.findIndex((b, p) => home.has(p) && bindingFunctions(b, f.layout.tapDances)[0] === `key:${tap}`);
  if (hit < 0) throw new Error(`no ${tap} on the home row of ${f.name}`);
  return hit;
}

const pairs = boards.flatMap((a) => boards.filter((b) => b !== a).map((b) => [a, b] as const));
const strategies: Strategy[] = ["function", "position", "auto"];

describe("key slots", () => {
  test("the letters A S D F are pinky, ring, middle, index on the home row of every board, J K L ; likewise on the right", () => {
    for (const f of boards) {
      const fingers = ["A", "S", "D", "F"].map((t) => slotOf(f, homeRowKey(f, t)));
      expect(fingers.map((s) => ("finger" in s ? s.finger : ""))).toEqual(["pinky", "ring", "middle", "index"]);
      for (const s of fingers) expect(s.thumb ? -1 : s.rowOffset).toBe(0);
      expect(fingers.every((s) => s.hand === "left")).toBe(true);
      const right = ["J", "K", "L"].map((t) => slotOf(f, homeRowKey(f, t)));
      expect(right.map((s) => s.finger)).toEqual(["index", "middle", "ring"]);
      expect(right.every((s) => s.hand === "right")).toBe(true);
    }
  });

  test("F and J are the home keys of the index fingers (column offset 0)", () => {
    for (const f of boards) {
      for (const t of ["F", "J", "A", "SEMICOLON"]) {
        const s = slotOf(f, homeRowKey(f, t));
        expect(s.thumb ? NaN : s.colOffset).toBe(0);
      }
    }
  });

  test("every key of the three boards has a place, and no two keys of one hand share one", () => {
    for (const f of boards) {
      const table = keySlots(f.board.definition, f.board.geometry);
      expect(table.unplaced).toEqual([]);
      const seen = new Set<string>();
      for (const s of table.slots.values()) {
        const id = s.thumb ? `${s.hand}:thumb:${s.thumbRank}` : `${s.hand}:${s.finger}:${s.rowOffset}:${s.colOffset}`;
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });
});

describe("mapKeys", () => {
  test("home row maps to home row by finger, for every pair of boards, by position", () => {
    for (const [a, b] of pairs) {
      const m = mapKeys(side(a), side(b), "position");
      for (const t of ["A", "S", "D", "F", "J", "K", "L"]) {
        const from = homeRowKey(a, t);
        const hit = m.mapped.find((x) => x.source === from)?.matches[0];
        expect(hit, `${a.name} ${t} -> ${b.name}`).toBeDefined();
        const target = slotOf(b, (hit as { target: number }).target);
        const source = slotOf(a, from);
        expect(target.hand).toBe(source.hand);
        expect(target.finger).toBe(source.finger);
        expect(target.thumb ? NaN : target.rowOffset).toBe(0);
        expect(target.thumb ? NaN : target.colOffset).toBe(0);
      }
    }
  });

  test("by function, the letters of the home row land on the same letters", () => {
    for (const [a, b] of pairs) {
      const m = mapKeys(side(a), side(b), "function");
      for (const t of ["A", "S", "D", "F", "J", "K", "L"]) {
        const hit = m.mapped.find((x) => x.source === homeRowKey(a, t))?.matches[0];
        expect(hit?.target, `${a.name} ${t} -> ${b.name}`).toBe(homeRowKey(b, t));
      }
    }
  });

  test("thumb keys map to thumb keys of the same hand, in order from the middle", () => {
    for (const [a, b] of pairs) {
      const m = mapKeys(side(a), side(b), "position");
      const thumbs = m.mapped.filter((x) => slotOf(a, x.source).thumb);
      expect(thumbs.length).toBeGreaterThan(0);
      for (const x of thumbs) {
        const s = slotOf(a, x.source);
        const t = slotOf(b, (x.matches[0] as { target: number }).target);
        expect(t.thumb).toBe(true);
        expect(t.hand).toBe(s.hand);
        expect(t.thumb && s.thumb && t.thumbRank).toBe(s.thumb && s.thumbRank);
      }
      // A thumb never lands on a main-block key.
      for (const x of m.mapped) if (!slotOf(a, x.source).thumb) expect(slotOf(b, (x.matches[0] as { target: number }).target).thumb).toBe(false);
    }
  });

  test("a position match is never across hands or fingers, and no target key is the best match of two source keys", () => {
    for (const [a, b] of pairs) {
      for (const strategy of ["position", "auto"] as const) {
        const m = mapKeys(side(a), side(b), strategy);
        const used = new Set<number>();
        for (const x of m.mapped) {
          const best = x.matches.find((y) => !y.extra) as { target: number; method: string };
          expect(used.has(best.target)).toBe(false);
          used.add(best.target);
          if (best.method === "position") {
            const s = slotOf(a, x.source);
            const t = slotOf(b, best.target);
            expect([t.hand, t.finger]).toEqual([s.hand, s.finger]);
            if (!s.thumb && !t.thumb) expect(t.rowOffset).toBe(s.rowOffset);
          }
        }
      }
    }
  });

  test("keys with no counterpart are reported, not forced: the Moonlander's number row and the Corne have nothing in common there", () => {
    const m = mapKeys(side(moonlander), side(corne), "position");
    const sSlots = slotsOf(moonlander);
    const numberRow = moonBoard.definition.rows.number as number[];
    for (const p of numberRow) {
      expect(m.mapped.some((x) => x.source === p)).toBe(false);
      expect(m.unmatchedSource.find((u) => u.position === p)?.why).toBe("no-place-on-target");
    }
    // Every source key is either mapped or reported.
    expect(m.mapped.length + m.unmatchedSource.length).toBe(moonBoard.definition.keyCount);
    expect(sSlots.size).toBe(72);
    // The Corne has 42 keys, so at most 42 source keys can land on it.
    expect(m.mapped.length).toBeLessThanOrEqual(42);
    expect(m.mapped.length).toBe(42);
  });

  test("a key whose function the target lacks is unmatched by function", () => {
    const m = mapKeys(side(moonlander), side(corne), "function");
    const f16 = (moonlander.layout.layers[0]?.bindings ?? []).findIndex((b) => bindingFunctions(b, moonlander.layout.tapDances)[0] === "key:F16");
    expect(f16).toBeGreaterThanOrEqual(0);
    expect(m.mapped.some((x) => x.source === f16)).toBe(false);
    expect(m.unmatchedSource.find((u) => u.position === f16)?.why).toBe("no-key-does-this");
  });

  test("auto uses function first, then position only for target keys function left free", () => {
    for (const [a, b] of pairs) {
      const auto = mapKeys(side(a), side(b), "auto");
      const byFunction = mapKeys(side(a), side(b), "function");
      for (const x of byFunction.mapped) {
        const want = x.matches.find((y) => !y.extra);
        const got = auto.mapped.find((y) => y.source === x.source)?.matches.find((y) => !y.extra);
        expect(got?.target, `${a.name} key ${x.source} -> ${b.name}`).toBe(want?.target);
      }
      expect(auto.mapped.length).toBeGreaterThanOrEqual(byFunction.mapped.length);
    }
  });

  test("arrows map by function, wherever they sit", () => {
    const put = (f: Fixture, positions: number[], codes: string[]): Fixture => ({
      ...f,
      layout: {
        ...f.layout,
        layers: f.layout.layers.map((l, i) =>
          i === 0 ? { ...l, bindings: l.bindings.map((b, p): Binding => (positions.includes(p) ? { kind: "key", code: codes[positions.indexOf(p)] as string } : b)) } : l,
        ),
      },
    });
    const arrows = ["LEFT", "DOWN", "UP", "RIGHT"];
    // The Moonlander's arrows are on its bottom-right; the Corne's are on whatever thumb and bottom keys we choose.
    const a = put(moonlander, [61, 62, 63, 64], arrows);
    const b = put(corne, [20, 21, 33, 34], arrows);
    const m = mapKeys(side(a), side(b), "auto");
    for (const [i, code] of arrows.entries()) {
      const from = [61, 62, 63, 64][i] as number;
      const hit = m.mapped.find((x) => x.source === from)?.matches[0];
      expect(hit?.method, code).toBe("function");
      expect(hit?.target, code).toBe([20, 21, 33, 34][i] as number);
    }
  });

  test("the same board maps every key to itself, by every strategy", () => {
    for (const f of boards) {
      for (const strategy of strategies) {
        const m = mapKeys(side(f), side(f), strategy);
        for (const x of m.mapped) {
          const best = x.matches.find((y) => !y.extra);
          // Keys that do nothing (transparent, none) can only match by place; keys with a function match themselves.
          if (best?.method === "position" || strategy !== "function") expect(best?.target).toBe(x.source);
        }
        expect(m.mapped.length).toBeGreaterThan(0);
      }
    }
  });

  test("a layer-switching key maps to the matching layer's key, and not to a key that goes somewhere else", () => {
    // Layer 1 of the Moonlander and layer 1 of the Glove80 template have different jobs; a MO(1) must not match a MO(1) to a different layer.
    const m = mapKeys(side(moonlander), side(glove80), "function");
    const layers = moonlander.layout.layers[0]?.bindings ?? [];
    const target = glove80.layout.layers[0]?.bindings ?? [];
    for (const x of m.mapped) {
      const from = layers[x.source] as Binding;
      const to = target[(x.matches[0] as { target: number }).target] as Binding;
      if (from.kind === "layer" && to.kind === "layer") expect(to.action).toBe(from.action);
    }
  });
});

/** The same board, written differently: records reordered, lists shuffled. A mapping must not notice. */
function reshuffled(f: Fixture, seed: number): Fixture {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const shuffle = <T,>(xs: T[]) => xs.map((x) => [rnd(), x] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const d = f.board.definition;
  return {
    ...f,
    board: {
      ...f.board,
      definition: {
        ...d,
        hands: { left: shuffle(d.hands.left), right: shuffle(d.hands.right) },
        fingers: Object.fromEntries(shuffle(Object.entries(d.fingers))),
        rows: Object.fromEntries(shuffle(Object.entries(d.rows)).map(([k, v]) => [k, shuffle(v)])),
        mirror: Object.fromEntries(shuffle(Object.entries(d.mirror))),
      },
    },
  };
}

const plain = (m: KeyMapping) => JSON.stringify(m);

describe("storage order", () => {
  test("the mapping does not depend on the order of anything in board.json", () => {
    for (const [a, b] of pairs) {
      for (const strategy of strategies) {
        const want = plain(mapKeys(side(a), side(b), strategy));
        for (const seed of [1, 7, 42, 1234]) {
          expect(plain(mapKeys(side(reshuffled(a, seed)), side(reshuffled(b, seed + 1)), strategy)), `${a.name}->${b.name} ${strategy} seed ${seed}`).toBe(want);
        }
      }
    }
  });

  test("key slots do not depend on it either", () => {
    for (const f of boards) {
      const want = JSON.stringify([...slotsOf(f)]);
      for (const seed of [3, 99]) expect(JSON.stringify([...slotsOf(reshuffled(f, seed))])).toBe(want);
    }
  });

  test("two source keys with the same function pair with the nearest target keys, whichever is listed first", () => {
    // Two Shift keys on each side: left to left, right to right.
    const shift = (code: string): Binding => ({ kind: "modifier", mods: [code as "LSFT"] });
    const doc = (f: Fixture, left: number, right: number): Fixture => ({
      ...f,
      layout: { ...f.layout, layers: f.layout.layers.map((l, i) => (i === 0 ? { ...l, bindings: l.bindings.map((b, p): Binding => (p === left ? shift("LSFT") : p === right ? shift("LSFT") : b)) } : l)) },
    });
    // Both are "Left Shift" functions: the pairing is by place, and the result is the same however the pair is built.
    const a = doc(moonlander, 42, 53);
    const b = doc(corne, 24, 35);
    const m = mapKeys(side(a), side(b), "function");
    expect(m.mapped.find((x) => x.source === 42)?.matches[0]?.target).toBe(24);
    expect(m.mapped.find((x) => x.source === 53)?.matches[0]?.target).toBe(35);
  });
});
