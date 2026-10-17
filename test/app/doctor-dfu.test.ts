// `keyloom doctor` checks the DFU tools a board's flash recipe runs, and says how to install a missing one (22, D-365).
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { runToolchainChecks } from "../../src/app/doctor.ts";
import { loadBoardDir } from "../../src/boards/load.ts";
import { setUserBoards } from "../../src/boards/registry.ts";
import { templateCopy } from "../helpers/board-recipes.ts";
import { fakeBinDir } from "../helpers/fake-bin.ts";

const savedPath = process.env.PATH;
afterEach(() => { process.env.PATH = savedPath; });
afterAll(() => setUserBoards([]));

const dfuBoard = async (flash: Record<string, unknown>) => loadBoardDir(await templateCopy("qmk", (b) => { b.revisions[0].flash = flash; }));

describe("doctor and the DFU tools", () => {
  test("a board that needs dfu-programmer gets a warning with the brew command when it is missing, and the path when it isn't", async () => {
    setUserBoards([await dfuBoard({ kind: "dfu-tool", tool: "dfu-programmer", mcu: "atmega32u4", bootloader: "03eb:2ff4", enter: "Press reset." })]);
    // The tests' PATH carries refusing stand-ins for the real tools (test/helpers/no-real-flash.ts); a bare PATH is how "not installed" looks.
    process.env.PATH = "/usr/bin:/bin";
    const missing = (await runToolchainChecks()).find((c) => c.name === "dfu-programmer");
    expect(missing).toMatchObject({ ok: true, warn: true });
    expect(missing?.detail).toContain("brew install dfu-programmer");

    const bin = fakeBinDir({ "dfu-programmer": "exit 0" });
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    const present = (await runToolchainChecks()).find((c) => c.name === "dfu-programmer");
    expect(present?.warn).toBeUndefined();
    expect(present?.detail).toBe(`${bin}/dfu-programmer`);
  });

  test("only the tools a board needs are checked", async () => {
    setUserBoards([await dfuBoard({ kind: "dfu-tool", tool: "dfu-util", bootloader: "0483:df11", enter: "Press reset." })]);
    process.env.PATH = "/usr/bin:/bin";
    const names = (await runToolchainChecks()).map((c) => c.name);
    expect(names).toContain("dfu-util");
    expect(names).not.toContain("dfu-programmer");
    expect(names).not.toContain("avrdude");
  });
});
