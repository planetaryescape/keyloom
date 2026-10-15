// The real thing: BK's Moonlander layout, generated to keymap.c and run on QMK's own core in Docker. Gated, because it
// needs Docker and the pinned checkout (plus googletest, ~10 MB, fetched on first run):
//   KEYLOOM_DOCKER_TESTS=qmk bun test test/firmware/qmk/emulate.docker.test.ts
import { describe, expect, test } from "bun:test";
import { applyOps } from "../../../src/app/changes.ts";
import { checkoutDirFor } from "../../../src/app/firmware.ts";
import { getLayout } from "../../../src/app/layouts.ts";
import type { EmulatorEvent, EmulatorReport } from "../../../src/firmware/emulate/types.ts";
import { emulateQmk } from "../../../src/firmware/qmk/emulate.ts";
import { commandShiftApp, F16_POSITION } from "../../helpers/command-shift.ts";
import { moonlander } from "../../helpers/board.ts";

const gated = ["1", "qmk"].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? describe : describe.skip;

// Base-layer positions in BK's Moonlander import.
const A = 29;
const S = 30; // MT(MOD_LALT, KC_S): left hand, so the right hand's keys are the opposite hand
const E = 17; // left hand
const U = 23; // right hand
const C = 45;
const V = 46;
const OSM_LSFT = 57; // OSM(MOD_LSFT)

const tap = (position: number, at: number, ms = 40): EmulatorEvent[] => [
  { at, position, action: "press" },
  { at: at + ms, position, action: "release" },
];

const keyboardReports = (reports: EmulatorReport[]) => reports.filter((r) => r.kind === "keyboard");

gated("a Moonlander layout on QMK's real core", () => {
  const TIMEOUT = 300_000;

  async function emulate(events: EmulatorEvent[], edit?: (app: Awaited<ReturnType<typeof commandShiftApp>>) => void) {
    const board = await moonlander();
    const fixture = await commandShiftApp();
    edit?.(fixture);
    const layout = getLayout(fixture.app, fixture.layoutId).document;
    return emulateQmk({ board: board.definition, boardRevisionId: "reva", layout, checkoutDir: checkoutDirFor(board), events });
  }

  test("tapping a letter sends that letter and then lets go", async () => {
    const result = await emulate(tap(A, 0));
    expect(result.firmware).toBe("qmk");
    expect(result.reports).toEqual([
      { at: 0, kind: "keyboard", mods: [], keys: ["A"] },
      { at: 40, kind: "keyboard", mods: [], keys: [] },
    ]);
    expect(result.text).toBe("a");
  }, TIMEOUT);

  test("holding the S home-row mod and tapping a right-hand key sends Alt with that key", async () => {
    const result = await emulate([{ at: 0, position: S, action: "press" }, ...tap(U, 100), { at: 300, position: S, action: "release" }]);
    const keyboard = keyboardReports(result.reports);
    expect(keyboard).toContainEqual({ at: expect.any(Number), kind: "keyboard", mods: ["LALT"], keys: ["U"] });
    expect(keyboard.at(-1)).toMatchObject({ mods: [], keys: [] });
    expect(result.text).toBe("");
  }, TIMEOUT);

  test("the same hold with a left-hand key is a tap of S then that key, because chordal hold is on", async () => {
    const result = await emulate([{ at: 0, position: S, action: "press" }, ...tap(E, 100), { at: 300, position: S, action: "release" }]);
    expect(keyboardReports(result.reports).some((r) => r.kind === "keyboard" && r.mods.length > 0)).toBe(false);
    expect(result.text).toBe("se");
  }, TIMEOUT);

  test("after a Command-Shift key replaces F16, pressing it sends Command and Shift together", async () => {
    const before = await emulate(tap(F16_POSITION, 0));
    expect(before.reports[0]).toMatchObject({ mods: [], keys: ["F16"] });

    const after = await emulate(tap(F16_POSITION, 0), ({ app, layoutId }) => {
      const view = getLayout(app, layoutId);
      applyOps(app, layoutId, {
        baseRevisionId: view.revision.id,
        summary: "Command-Shift on F16",
        ops: [
          { op: "setBinding", at: { layerId: view.document.layers[0]?.id as string, position: F16_POSITION }, binding: { kind: "modifier", mods: ["LGUI", "LSFT"] } },
          { op: "dropFunction", function: "key:F16", reason: "BK barely uses it" },
        ],
      });
    });
    // QMK sends the two modifiers one after the other (Shift, then Shift+Gui) and lets go the same way.
    expect(after.reports).toContainEqual({ at: 0, kind: "keyboard", mods: ["LSFT", "LGUI"], keys: [] });
    expect(after.reports.at(-1)).toMatchObject({ mods: [], keys: [] });
    expect(after.text).toBe("");
  }, TIMEOUT);

  test("a one-shot Shift applies to the next key only", async () => {
    const result = await emulate([...tap(OSM_LSFT, 0), ...tap(A, 100), ...tap(A, 200)]);
    expect(result.text).toBe("Aa");
    expect(result.reports).toContainEqual({ at: 100, kind: "keyboard", mods: ["LSFT"], keys: ["A"] });
  }, TIMEOUT);

  test("pressing C and V together fires the combo, which types Gui then C", async () => {
    const result = await emulate([
      { at: 0, position: C, action: "press" }, { at: 10, position: V, action: "press" },
      { at: 80, position: C, action: "release" }, { at: 90, position: V, action: "release" },
    ]);
    // Not C and V: the combo's macro replaces them, with the macro's 100 ms wait between its two taps.
    expect(result.reports.map((r) => (r.kind === "keyboard" ? [...r.mods, ...r.keys].join("+") : "consumer"))).toEqual(["LGUI", "", "C", ""]);
    expect(result.reports[2]?.at).toBe((result.reports[0]?.at ?? 0) + 100);
  }, TIMEOUT);

  test("a position that is not on the board is refused before Docker runs", async () => {
    await expect(emulate([{ at: 0, position: 99, action: "press" }])).rejects.toThrow("position 99 is not a key on this board");
  });
});
