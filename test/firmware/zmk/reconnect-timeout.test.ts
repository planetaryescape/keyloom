import { expect, spyOn, test } from "bun:test";
import { zipSync } from "fflate";
import { loadBoardDir } from "../../../src/boards/load.ts";
import { zmkRevision } from "../../../src/firmware/zmk/board-config.ts";
import { zmkHandsFreeHooks } from "../../../src/firmware/zmk/handsfree-flash.ts";
import { halfMarker } from "../../../src/firmware/zmk/handsfree.ts";
import { uf2Carrying } from "../../helpers/fake-zmk-halves.ts";

const board = await loadBoardDir("boards/keebart/corne-choc-pro-bt");
const revision = zmkRevision(board.definition);
const build = "bld_01M509Z0DJYBG04NY1MKBCK6TY";
const right = uf2Carrying(halfMarker(build, "R") + ":0123456789ABCDEF", 0xada52840);
const artifact = zipSync({ "right.uf2": right, "left.uf2": uf2Carrying(halfMarker(build, "L") + ":0123456789ABCDEF", 0xada52840) });

test("a slow Corne reconnect uses its board deadline; explicit overrides and the default remain bounded", async () => {
  let now = 0;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    for (const mode of ["board", "override", "default"] as const) {
      now = 0;
      let lists = 0;
      const handsFree = structuredClone(revision.flash.handsFree!);
      expect(handsFree.verifyWaitMs).toBe(180_000);
      if (mode === "default") delete handsFree.verifyWaitMs;
      const hooks = zmkHandsFreeHooks({
        board: board.definition, handsFree, steps: revision.flash.steps, artifact, buildId: build,
        findVolume: async () => null, log: () => {},
        deps: {
          pollMs: 0,
          ...(mode === "override" ? { verifyWaitMs: 45_000 } : {}),
          usb: async () => [],
          serial: async () => ({
            list: async () => {
              lists++;
              now += 60_000;
              return lists === 1 ? [] : [{ vendorId: 0x1d50, productId: 0x615e, path: "/fake/right", serial: halfMarker(build, "R") }];
            },
            touch: async () => { throw Error("verification must not restart a device"); },
          }),
        },
      });
      const result = await hooks.verify!(revision.flash.steps[0]!, 0, right);
      expect(result.ok).toBe(mode === "board");
      expect(lists).toBe(mode === "board" ? 2 : 1);
    }
  } finally { clock.mockRestore(); }
});
