// The real thing: a conditional layer generated into BK's Moonlander keymap and run on QMK's own core in Docker (D-387). Gated like
// emulate.docker.test.ts:
//   KEYLOOM_DOCKER_TESTS=qmk bun test test/firmware/qmk/conditional-layers.docker.test.ts
import { describe, expect, test } from "bun:test";
import { checkoutDirFor } from "../../../src/app/firmware.ts";
import { getLayout } from "../../../src/app/layouts.ts";
import type { EmulatorEvent } from "../../../src/firmware/emulate/types.ts";
import { emulateQmk } from "../../../src/firmware/qmk/emulate.ts";
import { applyOps } from "../../../src/layout/apply-ops.ts";
import type { ChangeOp } from "../../../src/layout/change.ts";
import type { Layout } from "../../../src/layout/schema.ts";
import { commandShiftApp } from "../../helpers/command-shift.ts";
import { moonlander } from "../../helpers/board.ts";

const gated = ["1", "qmk"].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? describe : describe.skip;
const TIMEOUT = 300_000;

// Two keys on the base layer hold layers 1 and 2; layer 3 is the one the condition turns on. Key T is A on the base layer, and
// transparent on layers 1 and 2, so it is only Z when layer 3 is on.
const LOWER_KEY = 0;
const RAISE_KEY = 1;
const T = 29;
const key = (code: string) => ({ kind: "key" as const, code });
const transparent = { kind: "transparent" as const };
const setUp: ChangeOp[] = [
  { op: "setBinding", at: { layerId: "layer-0", position: LOWER_KEY }, binding: { kind: "layer", action: "momentary", layerId: "layer-1" } },
  { op: "setBinding", at: { layerId: "layer-0", position: RAISE_KEY }, binding: { kind: "layer", action: "momentary", layerId: "layer-2" } },
  { op: "setBinding", at: { layerId: "layer-0", position: T }, binding: key("A") },
  ...["layer-1", "layer-2"].flatMap((layerId): ChangeOp[] => [LOWER_KEY, RAISE_KEY, T].map((position) => ({ op: "setBinding", at: { layerId, position }, binding: transparent }))),
  { op: "setBinding", at: { layerId: "layer-3", position: T }, binding: key("Z") },
  ...[LOWER_KEY, RAISE_KEY].map((position): ChangeOp => ({ op: "setBinding", at: { layerId: "layer-3", position }, binding: transparent })),
];
const condition: ChangeOp = { op: "upsertConditionalLayer", conditionalLayer: { id: "tri", ifLayerIds: ["layer-1", "layer-2"], thenLayerId: "layer-3" } };

const press = (position: number, at: number): EmulatorEvent => ({ at, position, action: "press" });
const release = (position: number, at: number): EmulatorEvent => ({ at, position, action: "release" });
const tapT = (at: number): EmulatorEvent[] => [press(T, at), release(T, at + 40)];

gated("a conditional layer on a Moonlander layout on QMK's real core", () => {
  async function emulate(events: EmulatorEvent[], ops: ChangeOp[]) {
    const board = await moonlander();
    const fixture = await commandShiftApp();
    const document = getLayout(fixture.app, fixture.layoutId).document;
    const applied = applyOps(document, [...setUp, ...ops]);
    if (!applied.ok) throw new Error(applied.error.message);
    const layout: Layout = applied.layout;
    return emulateQmk({ board: board.definition, boardRevisionId: "reva", layout, checkoutDir: checkoutDirFor(board), events });
  }
  const both = (): EmulatorEvent[] => [press(LOWER_KEY, 0), press(RAISE_KEY, 20), ...tapT(100), release(RAISE_KEY, 300), release(LOWER_KEY, 320)];

  test("without the condition, holding both layers leaves key T as A", async () => {
    expect((await emulate(both(), [])).text).toBe("a");
  }, TIMEOUT);

  test("with it, holding both turns layer 3 on, so key T is Z", async () => {
    expect((await emulate(both(), [condition])).text).toBe("z");
  }, TIMEOUT);

  test("holding only one of the two does not, and letting go of one turns it off again", async () => {
    const one = await emulate([press(LOWER_KEY, 0), ...tapT(100), release(LOWER_KEY, 300)], [condition]);
    expect(one.text).toBe("a");
    const letGo: EmulatorEvent[] = [press(LOWER_KEY, 0), press(RAISE_KEY, 20), release(RAISE_KEY, 100), ...tapT(200), release(LOWER_KEY, 400)];
    expect((await emulate(letGo, [condition])).text).toBe("a");
  }, TIMEOUT);

  test("after the layers are reordered the condition still turns the same layer on", async () => {
    // Layer 3 moves to index 1, so the numbers in layer_state_set_user and in the layer keys all change.
    const moved: ChangeOp = { op: "moveLayer", layerId: "layer-3", afterLayerId: "layer-0" };
    expect((await emulate(both(), [condition, moved])).text).toBe("z");
  }, TIMEOUT);
});
