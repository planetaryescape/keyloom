// The log parser against real output of the native_posix_64 build (test/fixtures/zmk/emulate/*.log, captured
// from `keyloom emulate` runs, see the README there) and against hand-made lines for what real runs rarely hit.
import { describe, expect, test } from "bun:test";
import { EmulationError } from "../../../src/firmware/emulate/error.ts";
import { parseRunLog } from "../../../src/firmware/zmk/emulate-log.ts";

const fixture = async (name: string) => (await Bun.file(`${import.meta.dir}/../../fixtures/zmk/emulate/${name}.log`).text()).split("\n");

const ts = (ms: number) => `[00:00:${String(Math.floor(ms / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")},000]`;
const dbg = (ms: number, fn: string, message: string) => `${ts(ms)} <dbg> zmk: ${fn}: ${message}`;
const event = (ms: number, col: number, state: 0 | 1) => dbg(ms, "kscan_mock_work_handler_0", `ev 1 row 0 column ${col} state ${state}`);
const keycode = (ms: number, down: boolean, page: number, usage: number) =>
  dbg(ms, `hid_listener_keycode_${down ? "pressed" : "released"}`, `usage_page 0x${page.toString(16).padStart(2, "0")} keycode 0x${usage.toString(16).padStart(2, "0")} implicit_mods 0x00 explicit_mods 0x00`);
const mods = (ms: number, byte: number) => dbg(ms, "zmk_hid_implicit_modifiers_press", `Modifiers set to 0x${byte.toString(16).padStart(2, "0")}`);
const send = (ms: number, page = 7) => dbg(ms, "zmk_endpoints_send_report", `usage page 0x${page.toString(16).padStart(2, "0")}`);
const opts = { keyCount: 80, nkro: false };

describe("parseRunLog on real runs", () => {
  test("a tapped letter is a press report and an empty one, 40 ms apart, with time zero at the first key", async () => {
    const r = parseRunLog(await fixture("glove80-tap-letter"), opts);
    expect(r.eventsSeen).toBe(2);
    expect(r.reports).toEqual([
      { at: 0, kind: "keyboard", mods: [], keys: ["W"] },
      { at: 40, kind: "keyboard", mods: [], keys: [] },
    ]);
    expect(r.warnings).toEqual([]);
  });

  test("a home-row mod held past its tapping term sends the modifier alone, then the key with it", async () => {
    const r = parseRunLog(await fixture("glove80-home-row-mod"), opts);
    expect(r.reports).toEqual([
      { at: 281, kind: "keyboard", mods: ["LSFT"], keys: [] },
      { at: 300, kind: "keyboard", mods: ["LSFT"], keys: ["U"] },
      { at: 340, kind: "keyboard", mods: ["LSFT"], keys: [] },
      { at: 360, kind: "keyboard", mods: [], keys: [] },
    ]);
  });

  test("a layer-tap that resolves as a tap sends its key, and the key typed during it, in order", async () => {
    const r = parseRunLog(await fixture("glove80-layer-tap"), opts);
    expect(r.reports.map((x) => (x.kind === "keyboard" ? x.keys : x.usages))).toEqual([["SPACE"], ["SPACE", "W"], ["SPACE"], []]);
  });

  test("a media key is a consumer report, kept apart from keyboard ones", async () => {
    const r = parseRunLog(await fixture("corne-consumer"), { keyCount: 42, nkro: false });
    expect(r.reports).toEqual([
      { at: 0, kind: "consumer", usages: ["AUDIO_VOL_UP"] },
      { at: 40, kind: "consumer", usages: [] },
    ]);
  });
});

describe("parseRunLog on lines made for the case", () => {
  test("reports that don't differ from the last of their kind are dropped, and an empty first report is dropped", () => {
    const lines = [
      event(10, 80, 0), event(20, 1, 1),
      send(21), // nothing down yet: same as the empty start
      keycode(22, true, 7, 0x04), send(22), send(23),
      keycode(24, true, 0x0c, 0xe9), send(24, 0x0c),
      keycode(25, false, 7, 0x04), send(25),
    ];
    expect(parseRunLog(lines, opts).reports).toEqual([
      { at: 2, kind: "keyboard", mods: [], keys: ["A"] },
      { at: 4, kind: "consumer", usages: ["AUDIO_VOL_UP"] },
      { at: 5, kind: "keyboard", mods: [], keys: [] },
    ]);
  });

  test("the modifier byte comes from the firmware's own 'Modifiers set to' lines, so implicit and masked modifiers are right", () => {
    const lines = [event(10, 1, 1), mods(10, 0x02), keycode(10, true, 7, 0x05), send(10), mods(11, 0x00), keycode(11, false, 7, 0x05), send(11)];
    expect(parseRunLog(lines, opts).reports).toEqual([
      { at: 0, kind: "keyboard", mods: ["LSFT"], keys: ["B"] },
      { at: 1, kind: "keyboard", mods: [], keys: [] },
    ]);
  });

  test("a modifier key's own press is in the modifier byte, not the key list", () => {
    const lines = [event(10, 1, 1), mods(10, 0x01), keycode(10, true, 7, 0xe0), send(10)];
    expect(parseRunLog(lines, opts).reports).toEqual([{ at: 0, kind: "keyboard", mods: ["LCTL"], keys: [] }]);
  });

  test("a key pressed while already down is let go first, with a report of its own", () => {
    const lines = [
      event(10, 1, 1), keycode(10, true, 7, 0x04), send(10),
      dbg(20, "hid_listener_keycode_pressed", "unregistering usage_page 0x07 keycode 0x04 since it was already pressed"), send(20),
      keycode(20, true, 7, 0x04), send(20),
    ];
    expect(parseRunLog(lines, opts).reports.map((r) => (r.kind === "keyboard" ? r.keys : []))).toEqual([["A"], [], ["A"]]);
  });

  test("ZMK's six-key report drops the seventh key and says so; NKRO keeps it and lists keys in usage order", () => {
    const presses = [0x09, 0x08, 0x07, 0x06, 0x05, 0x04, 0x0a].flatMap((u, i) => [event(10 + i, 1, 1), keycode(10 + i, true, 7, u), send(10 + i)]);
    const six = parseRunLog(presses, opts);
    expect(six.reports.at(-1)).toMatchObject({ keys: ["F", "E", "D", "C", "B", "A"] });
    expect(six.warnings).toEqual(["more keys were down at once than ZMK's 6-key report holds, so it dropped some presses (NKRO has no limit)."]);
    const all = parseRunLog(presses, { ...opts, nkro: true });
    expect(all.reports.at(-1)).toMatchObject({ keys: ["A", "B", "C", "D", "E", "F", "G"] });
    expect(all.warnings).toEqual([]);
  });

  test("a freed slot is filled by the next key, as hid.c does", () => {
    const lines = [
      event(1, 1, 1), keycode(1, true, 7, 0x04), send(1), keycode(2, true, 7, 0x05), send(2), keycode(3, false, 7, 0x04), send(3), keycode(4, true, 7, 0x06), send(4),
    ];
    expect(parseRunLog(lines, opts).reports.map((r) => (r.kind === "keyboard" ? r.keys : []))).toEqual([["A"], ["A", "B"], ["B"], ["C", "B"]]);
  });

  test("errors the firmware prints on every run stay quiet; others are passed on once", () => {
    const lines = [
      `${ts(1)} <wrn> zmk: Not found in transform: row: 0, col: 80, pressed: false`,
      `${ts(2)} <err> zmk: USB endpoint is not supported`,
      `${ts(3)} <wrn> zmk: Have 3 combos!`,
      `${ts(4)} <err> zmk: Tried to unregister modifier 1 too often`,
      `${ts(5)} <err> zmk: Tried to unregister modifier 1 too often`,
    ];
    expect(parseRunLog(lines, opts).warnings).toEqual(["the firmware logged an error: Tried to unregister modifier 1 too often"]);
  });

  test("a usage page ZMK has no report for is ignored with a warning", () => {
    const lines = [event(1, 1, 1), keycode(1, true, 1, 0x81), send(1, 1)];
    const r = parseRunLog(lines, opts);
    expect(r.reports).toEqual([]);
    expect(r.warnings[0]).toContain("usage page 0x1");
  });

  test("a log that lost lines is refused, not trusted", () => {
    expect(() => parseRunLog(["--- 12 messages dropped ---"], opts)).toThrow(EmulationError);
  });

  test("events on the unmapped first column aren't counted as key events", () => {
    expect(parseRunLog([event(1, 80, 0), event(2, 79, 1)], opts).eventsSeen).toBe(1);
  });
});
