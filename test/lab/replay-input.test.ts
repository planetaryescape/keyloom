import { describe, expect, test } from "bun:test";
import { prepareEvents } from "../../src/lab/replay-input.ts";
import { pressesOf } from "../../src/lab/presses.ts";
import { align } from "../../src/lab/align.ts";
import type { Step } from "../../src/lab/intent.ts";

const ev = (at: number, position: number, action: "press" | "release") => ({ at, position, action });

describe("preparing a trace for an emulator", () => {
  test("starts at zero, rounds to whole milliseconds, keeps same-time events in the order they came, and drops where a key came from", () => {
    const out = prepareEvents([{ ...ev(1000.4, 5, "press"), source: 255 }, ev(1000.4, 6, "press"), ev(1090.6, 5, "release"), ev(1100, 6, "release")]);
    expect(out).toEqual([ev(0, 5, "press"), ev(0, 6, "press"), ev(90, 5, "release"), ev(100, 6, "release")]);
    expect(Object.keys(out[0] ?? {})).toEqual(["at", "position", "action"]);
  });

  test("puts events in time order whatever order they arrive in", () => {
    expect(prepareEvents([ev(300, 1, "release"), ev(100, 1, "press")])).toEqual([ev(0, 1, "press"), ev(200, 1, "release")]);
  });

  test("a pause longer than three seconds is shortened to three, however many there are", () => {
    const out = prepareEvents([ev(0, 1, "press"), ev(50, 1, "release"), ev(40_050, 2, "press"), ev(40_100, 2, "release"), ev(100_100, 3, "press")]);
    expect(out.map((e) => e.at)).toEqual([0, 50, 3050, 3100, 6100]);
  });

  test("nothing in is nothing out", () => {
    expect(prepareEvents([])).toEqual([]);
  });
});

describe("presses and alignment", () => {
  test("a key released out of order and one never released are both paired", () => {
    const presses = pressesOf([ev(0, 1, "press"), ev(10, 2, "press"), ev(40, 1, "release"), ev(90, 3, "press")]);
    expect(presses).toEqual([
      { index: 0, position: 1, downAt: 0, upAt: 40 },
      { index: 1, position: 2, downAt: 10, upAt: 90 },
      { index: 2, position: 3, downAt: 90, upAt: 90 },
    ]);
  });

  const step = (index: number, ...positions: number[]): Step => ({ index, positions, intent: "tap" });

  test("a character that more than one key types is matched by any of them", () => {
    const presses = pressesOf([ev(0, 70, "press"), ev(50, 70, "release")]);
    expect(align(presses, [step(0, 66, 70)]).map((a) => a.kind)).toEqual(["match"]);
  });

  test("a mistyped key is one wrong key, not a missing key and an extra one", () => {
    const presses = pressesOf([ev(0, 1, "press"), ev(10, 1, "release"), ev(100, 9, "press"), ev(110, 9, "release"), ev(200, 3, "press"), ev(210, 3, "release")]);
    expect(align(presses, [step(0, 1), step(1, 2), step(2, 3)]).map((a) => a.kind)).toEqual(["match", "wrong", "match"]);
  });

  test("an empty recording against a passage is all skipped, and a passage against no steps is all extra", () => {
    expect(align([], [step(0, 1), step(1, 2)]).map((a) => a.kind)).toEqual(["skipped", "skipped"]);
    expect(align(pressesOf([ev(0, 1, "press"), ev(5, 1, "release")]), []).map((a) => a.kind)).toEqual(["extra"]);
  });
});
