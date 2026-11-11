// What a flash will need, read before anyone clicks Flash (D-489, D-490). Commands are injected, so the answer
// never depends on what the test machine has installed.
import { describe, expect, test } from "bun:test";
import { showBoard } from "../../src/app/boards.ts";
import { flashPlanFor } from "../../src/app/firmware-flash-plan.ts";
import type { Board } from "../../src/boards/load.ts";

const mac = (has: string[]) => ({ platform: "darwin" as const, has: (c: string) => has.includes(c) });

/** The Moonlander with every revision's flash recipe replaced, standing in for a mainline QMK board. */
function moonlanderWith(flash: Record<string, unknown>): Board {
  const board = structuredClone(showBoard("zsa/moonlander"));
  for (const rev of board.definition.revisions) (rev as { flash: unknown }).flash = flash;
  return board;
}

describe("flashPlanFor", () => {
  test("a Moonlander flashes with Zapp: installed or not, and installable where Homebrew is", () => {
    const moonlander = showBoard("zsa/moonlander");
    expect(flashPlanFor(moonlander, "revb", mac(["brew", "zapp"]))).toEqual({ manual: null, tool: { name: "zapp", installed: true, canInstall: true, url: "https://github.com/zsa/zapp" }, canReveal: true });
    expect(flashPlanFor(moonlander, "revb", mac(["brew"])).tool).toMatchObject({ name: "zapp", installed: false, canInstall: true });
    expect(flashPlanFor(moonlander, "revb", { platform: "linux", has: () => false })).toMatchObject({ tool: { installed: false, canInstall: false }, canReveal: false });
  });

  test("a board keyloom can't flash carries its own steps, and no tool", () => {
    const plan = flashPlanFor(moonlanderWith({ kind: "manual", instructions: "Use QMK Toolbox." }), "revb", mac(["brew"]));
    expect(plan).toEqual({ manual: "Use QMK Toolbox.", tool: null, canReveal: true });
  });

  test("a DFU board names its tool, and a tool given directly counts as installed", () => {
    const board = moonlanderWith({ kind: "dfu-tool", tool: "dfu-util", bootloader: "0483:df11", enter: "Press reset." });
    expect(flashPlanFor(board, "revb", mac(["brew"])).tool).toMatchObject({ name: "dfu-util", installed: false });
    expect(flashPlanFor(board, "revb", { ...mac([]), dfuTools: { "dfu-util": "/fake/dfu-util" } }).tool).toMatchObject({ installed: true, canInstall: false });
  });

  test("ZMK boards copy to their boot drives: no tool to check", () => {
    expect(flashPlanFor(showBoard("moergo/glove80"), "default", mac([]))).toEqual({ manual: null, tool: null, canReveal: true });
  });
});
