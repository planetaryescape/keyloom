// The heuristics against BK's three boards (docs/research/new-keyboard.md, "Heuristics against BK's three boards"). Each board is
// derived from its firmware source data, never from the committed geometry.json, and compared with the committed board.json.
import { describe, expect, test } from "bun:test";
import { deriveFingers, deriveHands, deriveMirror, deriveRowGroups, guessHomeRow, rowNames } from "../../../src/boards/derive/heuristics.ts";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { sourceBoards } from "../../helpers/derive-sources.ts";

const boards = await sourceBoards();

describe("heuristics against the committed boards", () => {
  test("the source data is the same keys as the committed geometry", async () => {
    for (const b of boards) {
      const committed = (await loadBoardDir(b.dir)).geometry.keys;
      expect(b.keys).toEqual(committed);
    }
  });

  test("hands: 194 of 194 keys land on the committed hand", async () => {
    let right = 0;
    let total = 0;
    for (const b of boards) {
      const def = (await loadBoardDir(b.dir)).definition;
      const hands = deriveHands(b.keys);
      expect(hands.left).toEqual([...def.hands.left].sort((x, y) => x - y));
      expect(hands.right).toEqual([...def.hands.right].sort((x, y) => x - y));
      right += hands.left.length + hands.right.length;
      total += def.keyCount;
    }
    expect([right, total]).toEqual([194, 194]);
  });

  test("thumbs: 26 of 26 found, and none that are not", async () => {
    let found = 0;
    let truth = 0;
    for (const b of boards) {
      const def = (await loadBoardDir(b.dir)).definition;
      const derived = deriveFingers(b.keys, deriveHands(b.keys)).thumbs;
      const expected = Object.entries(def.fingers).filter(([, f]) => f.endsWith("thumb")).map(([p]) => Number(p)).sort((x, y) => x - y);
      expect(derived).toEqual(expected);
      found += derived.filter((p) => expected.includes(p)).length;
      truth += expected.length;
    }
    expect([found, truth]).toEqual([26, 26]);
  });

  test("fingers: 132 of 132 on the Moonlander and Glove80, and every key of the Corne", async () => {
    const tally = { good: 0, total: 0 };
    for (const b of boards) {
      const def = (await loadBoardDir(b.dir)).definition;
      const { fingers } = deriveFingers(b.keys, deriveHands(b.keys));
      const nonThumb = Object.entries(def.fingers).filter(([, f]) => !f.endsWith("thumb"));
      const wrong = nonThumb.filter(([p, f]) => fingers[p] !== f).map(([p, f]) => `${b.name} ${p}: ${fingers[p]} not ${f}`);
      expect(wrong).toEqual([]);
      if (b.name !== "Corne") {
        tally.good += nonThumb.length - wrong.length;
        tally.total += nonThumb.length;
      }
    }
    expect([tally.good, tally.total]).toEqual([132, 132]);
  });

  test("rows: each board's main block splits into the committed number of rows, with the home row where the guess puts it", async () => {
    for (const b of boards) {
      const def = (await loadBoardDir(b.dir)).definition;
      const found = deriveFingers(b.keys, deriveHands(b.keys));
      const { thumbs } = found;
      const groups = deriveRowGroups(b.keys, found);
      const committed = Object.entries(def.rows).filter(([name]) => name !== "thumb");
      expect(groups.length).toBe(committed.length);
      const names = rowNames(groups.length, guessHomeRow(groups.length));
      expect(names).toEqual(committed.map(([n]) => n));
      // The committed Moonlander files two thumb keys (59, 60) in its `lower` row; the rule counts them as thumbs, as the finger table does.
      const isThumb = new Set(thumbs);
      groups.forEach((g, i) => expect(g).toEqual((def.rows[names[i] as string] as number[]).filter((p) => !isThumb.has(p)).sort((x, y) => x - y)));
    }
  });

  test("mirror pairs agree with the committed ones", async () => {
    for (const b of boards) {
      const def = (await loadBoardDir(b.dir)).definition;
      const hands = deriveHands(b.keys);
      const found = deriveFingers(b.keys, hands);
      const { fingers } = found;
      const groups = deriveRowGroups(b.keys, found);
      const names = rowNames(groups.length, guessHomeRow(groups.length));
      const rowOf = new Map(groups.flatMap((g, i) => g.map((p) => [p, names[i] as string] as const)));
      const mirror = deriveMirror(b.keys, hands, fingers, rowOf);
      expect(mirror).toEqual(def.mirror);
    }
  });
});
