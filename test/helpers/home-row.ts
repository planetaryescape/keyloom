// The two starting points for "do that here too" (rung 7): a left home row that has mods and a right one that
// does not. BK's own Moonlander already has some right-hand mods, so they are taken off first; the Glove80
// template has no hold-taps at all, so the left home row is given them.
import { applyOps, getLayout, importLayout, openApp } from "../../src/app/index.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import { FIXTURE_DIR } from "./board.ts";
import { tempDir } from "./tmp.ts";
import { TEMPLATE_FIXTURE } from "./zmk.ts";

export type HomeRowCase = {
  app: ReturnType<typeof openApp>;
  layoutId: string;
  layerId: string;
  /** The right-hand home row keys whose left-hand mirror has a mod: the ones "give these the same mods" must change. */
  selection: number[];
  /** What each selected position should hold afterwards, as `<tap code> + <hold mods>`. */
  expected: Record<number, { tap: string; mods: string[] }>;
};

export async function moonlanderHomeRow(): Promise<HomeRowCase> {
  const app = openApp({ dataDir: tempDir() });
  const { layoutId } = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "bk" });
  const view = getLayout(app, layoutId);
  const base = view.document.layers[0]!;
  // H J K L ; on the right. Taking the hold off drops the right-hand modifier it provided, which is the point.
  const ops: ChangeOp[] = [36, 37, 38, 39, 40].flatMap((position): ChangeOp[] => {
    const b = base.bindings[position]!;
    if (b.kind !== "holdTap") return [];
    return [
      ...bindingFunctions(b).slice(1).map((function_): ChangeOp => ({ op: "dropFunction", function: function_, reason: "start from a right hand without mods" })),
      { op: "setBinding", at: { layerId: base.id, position }, binding: { kind: "key", code: b.tap.code } },
    ];
  });
  applyOps(app, layoutId, { baseRevisionId: view.revision.id, ops, summary: "Right home row without mods" });
  return {
    app, layoutId, layerId: base.id,
    // Left: G/Hyper (33), F/Command (32), S/Option (30); D (31) and A (29) are plain.
    selection: [36, 37, 39],
    expected: {
      36: { tap: "H", mods: ["RCTL", "RSFT", "RALT", "RGUI"] },
      37: { tap: "J", mods: ["RGUI"] },
      39: { tap: "L", mods: ["RALT"] },
    },
  };
}

export const GLOVE80_PROFILE = "hrm";

export async function glove80HomeRow(): Promise<HomeRowCase> {
  const app = openApp({ dataDir: tempDir() });
  const { layoutId } = await importLayout(app, { board: "moergo/glove80", source: TEMPLATE_FIXTURE, name: "glove80" });
  const view = getLayout(app, layoutId);
  const base = view.document.layers[0]!;
  const left: Array<[number, string, "LGUI" | "LALT" | "LCTL" | "LSFT"]> = [[35, "A", "LGUI"], [36, "S", "LALT"], [37, "D", "LCTL"], [38, "F", "LSFT"]];
  const ops: ChangeOp[] = [
    {
      op: "upsertHoldTapProfile",
      // Opposite-hand-only holds: the left profile lists every right-hand key (06).
      profile: {
        id: GLOVE80_PROFILE, name: "Home row mods", firmware: "zmk",
        options: { bindings: "&kp &kp", flavor: "balanced", "tapping-term-ms": 200, "quick-tap-ms": 175, "hold-trigger-key-positions": [...view.board.definition.hands.right].sort((a, b) => a - b) },
      },
    },
    ...left.map(([position, tap, mod]): ChangeOp => ({
      op: "setBinding", at: { layerId: base.id, position }, binding: { kind: "holdTap", tap: { code: tap }, hold: { mods: [mod] }, profileId: GLOVE80_PROFILE },
    })),
  ];
  applyOps(app, layoutId, { baseRevisionId: view.revision.id, ops, summary: "Home row mods on the left hand" });
  return {
    app, layoutId, layerId: base.id,
    selection: [41, 42, 43, 44],
    expected: {
      41: { tap: "J", mods: ["RSFT"] },
      42: { tap: "K", mods: ["RCTL"] },
      43: { tap: "L", mods: ["RALT"] },
      44: { tap: "SEMICOLON", mods: ["RGUI"] },
    },
  };
}
