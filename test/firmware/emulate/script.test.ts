import { describe, expect, test } from "bun:test";
import { GAP_MS, HOLD_MS, ScriptError, TAP_MS, parseScript } from "../../../src/firmware/emulate/script.ts";

describe("parseScript", () => {
  test("a tap is a press and a release TAP_MS later, and key numbers count from 1 like the editor", () => {
    expect(parseScript("tap 31")).toEqual([
      { at: 0, position: 30, action: "press" },
      { at: TAP_MS, position: 30, action: "release" },
    ]);
  });

  test("two taps are separate presses with a gap between them", () => {
    const events = parseScript("tap 1 then tap 2");
    expect(events.map((e) => [e.at, e.position, e.action])).toEqual([
      [0, 0, "press"],
      [TAP_MS, 0, "release"],
      [TAP_MS + GAP_MS, 1, "press"],
      [2 * TAP_MS + GAP_MS, 1, "release"],
    ]);
  });

  test("the example from the help: hold 31 300 then tap 32 holds 31 while 32 is tapped, then lets 31 go", () => {
    expect(parseScript("hold 31 300 then tap 32")).toEqual([
      { at: 0, position: 30, action: "press" },
      { at: 300, position: 31, action: "press" },
      { at: 300 + TAP_MS, position: 31, action: "release" },
      { at: 300 + TAP_MS + GAP_MS, position: 30, action: "release" },
    ]);
  });

  test("hold without a time waits HOLD_MS, and release lets go at that moment", () => {
    expect(parseScript("hold 5 then release 5")).toEqual([
      { at: 0, position: 4, action: "press" },
      { at: HOLD_MS, position: 4, action: "release" },
    ]);
  });

  test("a chord presses every key together and releases them together", () => {
    const events = parseScript("tap 12+13");
    expect(events.filter((e) => e.action === "press").map((e) => [e.at, e.position])).toEqual([[0, 11], [0, 12]]);
    expect(events.filter((e) => e.action === "release").map((e) => [e.at, e.position])).toEqual([[TAP_MS, 11], [TAP_MS, 12]]);
  });

  test("@ms starts a step at that time, wait advances the clock, and a time in the past is an error", () => {
    expect(parseScript("@500 tap 1")[0]).toEqual({ at: 500, position: 0, action: "press" });
    expect(parseScript("wait 200 then tap 1")[0]?.at).toBe(200);
    expect(() => parseScript("wait 200 then @100 tap 1")).toThrow(/starts at 100 ms, but the script is already at 200 ms/);
  });

  test("keys still down at the end are released, last pressed first", () => {
    const events = parseScript("hold 1 100 then hold 2 100");
    expect(events.slice(2)).toEqual([
      { at: 200, position: 1, action: "release" },
      { at: 200, position: 0, action: "release" },
    ]);
  });

  test("steps split on then, semicolons and new lines; # starts a comment; case doesn't matter", () => {
    const text = "# a comment\nTAP 1 ; Tap 2\n\ntap 3 # trailing\nthen TAP 4";
    expect(parseScript(text).filter((e) => e.action === "press").map((e) => e.position)).toEqual([0, 1, 2, 3]);
  });

  test("a key past the end of the board names the board's range", () => {
    expect(() => parseScript("tap 81", { keyCount: 80 })).toThrow(/there is no key 81 in "tap 81"; this board has keys 1 to 80/);
    expect(() => parseScript("tap 0")).toThrow(/there is no key 0/);
    expect(() => parseScript("tap A")).toThrow(/"A" is not a key number/);
  });

  test("mistakes name the step", () => {
    expect(() => parseScript("")).toThrow(ScriptError);
    expect(() => parseScript("# nothing")).toThrow(/no key presses/);
    expect(() => parseScript("press 1")).toThrow(/don't know "press" in "press 1"; use tap, hold, release or wait/);
    expect(() => parseScript("tap 1 2")).toThrow(/for two taps in a row write "tap 31 then tap 32"/);
    expect(() => parseScript("hold 1 then hold 1")).toThrow(/key 1 is already down/);
    expect(() => parseScript("release 3")).toThrow(/key 3 isn't down/);
    expect(() => parseScript("wait soon")).toThrow(/"soon" is not a number of milliseconds/);
    expect(() => parseScript("@100")).toThrow(/has a time but no action/);
  });
});
