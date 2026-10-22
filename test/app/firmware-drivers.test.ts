// The firmware drivers for boards that aren't the Moonlander or the Glove80: what the recipe in board.json
// changes in the file extension, the instruction and the flash. Nothing here touches a real volume.
import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverFor } from "../../src/app/firmware-drivers.ts";
import { loadBoardDir } from "../../src/boards/load.ts";
import { LogSink } from "../../src/firmware/toolchain/run.ts";
import { templateCopy } from "../helpers/board-recipes.ts";
import { fakeBinDir } from "../helpers/fake-bin.ts";
import { tempDir } from "../helpers/tmp.ts";
import { MOONLANDER_DIR } from "../helpers/board.ts";
import { uf2Image } from "../helpers/zmk.ts";

const load = async (kind: "qmk" | "zmk", edit?: (b: Record<string, any>) => void) => loadBoardDir(await templateCopy(kind, edit));

describe("QMK driver", () => {
  test("the Moonlander still makes a .bin and waits for the reset button", async () => {
    const board = await loadBoardDir(MOONLANDER_DIR);
    const d = driverFor(board);
    expect(d.artifactExtension(board, "reva")).toBe("bin");
    // Before the flasher has looked at the keyboard nothing is asked of the person: with keyloom's firmware on it, nothing is needed.
    expect(d.waitingInstruction(board)).toContain("checking whether it can restart the keyboard");
  });

  test("the artifact extension is the one the recipe names", async () => {
    const board = await load("qmk");
    expect(driverFor(board).artifactExtension(board, "default")).toBe("hex");
  });

  test("a manual flash fails at once, with the file's path and the board's own instructions", async () => {
    const board = await load("qmk");
    const dir = tempDir();
    const states: string[] = [];
    const r = await driverFor(board).flash({
      board, buildId: "bld_test", boardRevision: "default", artifactPath: join(dir, "a.hex"), log: new LogSink(join(dir, "f.log")), onState: (s) => states.push(s),
    });
    expect(r.state).toBe("failed");
    expect(r.error).toContain(join(dir, "a.hex"));
    expect(r.error).toContain("QMK Toolbox");
    expect(states).toEqual(["failed"]);
    expect(driverFor(board).waitingInstruction(board)).toContain("QMK Toolbox");
  });

  test("a dfu-tool board shows its own bootloader instruction and flashes through the injected bus and tool", async () => {
    const board = await load("qmk", (b) => {
      b.revisions[0].flash = { kind: "dfu-tool", tool: "dfu-programmer", mcu: "atmega32u4", bootloader: "03eb:2ff4", enter: "Press the QK_BOOT key." };
      b.revisions[0].detect = { usbProductId: "0x6456", usbVendorId: "0xcb10" };
    });
    const d = driverFor(board);
    expect(d.waitingInstruction(board)).toBe("Press the QK_BOOT key.");
    const dir = tempDir();
    const calls = join(dir, "calls.log");
    const bin = fakeBinDir({ "dfu-programmer": `echo "$@" >> "${calls}"` });
    const bus: Array<{ vendorId: string; productId: string; name: string; maker: string }> = [{ vendorId: "0x03eb", productId: "0x2ff4", name: "", maker: "" }];
    const artifact = join(dir, "a.hex");
    await Bun.write(artifact, ":00000001FF\n");
    const r = await d.flash({
      board, buildId: "bld_test", boardRevision: "default", artifactPath: artifact, log: new LogSink(join(dir, "f.log")), bootloaderWaitMs: 3000,
      // The board returns once the flasher is verifying, as the real one does after the tool resets it.
      onState: (_s, _i, note) => { if (note?.verifying) bus.splice(0, bus.length, { vendorId: "0xcb10", productId: "0x6456", name: "", maker: "" }); },
      handsFree: { usb: async () => [...bus], pollMs: 20, dfu: { tools: { "dfu-programmer": join(bin, "dfu-programmer") } } },
    });
    expect(r.state).toBe("succeeded");
    expect((await Bun.file(calls).text()).trim().split("\n")).toEqual(["atmega32u4 erase --force", `atmega32u4 flash --force ${artifact}`, "atmega32u4 reset"]);
  }, 15_000);

  test("a UF2 board flashes its one file to the drive the step names", async () => {
    const board = await load("qmk", (b) => {
      b.revisions[0].build.artifact = "uf2";
      b.revisions[0].flash = { kind: "uf2-drives", steps: [{ volume: "RPI-RP2", label: "board", enter: "Hold BOOT and plug in." }] };
    });
    const dir = tempDir();
    const root = join(dir, "Volumes");
    mkdirSync(join(root, "RPI-RP2"), { recursive: true });
    const artifact = join(dir, "a.uf2");
    const image = uf2Image(0xe48bff56, 4);
    await Bun.write(artifact, image);
    const timer = setInterval(() => {
      const f = join(root, "RPI-RP2", "firmware.uf2");
      if (existsSync(f)) {
        expect(Buffer.from(readFileSync(f))).toEqual(Buffer.from(image));
        rmSync(join(root, "RPI-RP2"), { recursive: true, force: true });
      }
    }, 10);
    const r = await driverFor(board).flash({
      board, buildId: "bld_test", boardRevision: "default", artifactPath: artifact, log: new LogSink(join(dir, "f.log")), onState: () => {}, volumesRoot: root, bootloaderWaitMs: 2000,
    });
    clearInterval(timer);
    expect(r).toMatchObject({ state: "succeeded", error: null });
    expect(driverFor(board).artifactExtension(board, "default")).toBe("uf2");
    expect(driverFor(board).waitingInstruction(board)).toContain("Hold BOOT and plug in.");
  });
});

describe("ZMK driver", () => {
  test("the Glove80 still makes a .uf2; a west board makes a .zip bundle", async () => {
    const glove = await loadBoardDir(`${import.meta.dir}/../../boards/moergo/glove80`);
    expect(driverFor(glove).artifactExtension(glove, "default")).toBe("uf2");
    const west = await load("zmk");
    expect(driverFor(west).artifactExtension(west, "default")).toBe("zip");
  });

  test("a west board generates files named for its keymapName", async () => {
    const west = await load("zmk");
    // A layout is not needed to see the names: generate is exercised with the template's four keys.
    const { generateZmkSource } = await import("../../src/firmware/zmk/generate.ts");
    const { importZmkSource } = await import("../../src/firmware/zmk/import.ts");
    const dir = tempDir();
    await Bun.write(join(dir, "mine.keymap"), `/ { keymap { compatible = "zmk,keymap"; base { bindings = <&kp A &kp B &kp C &kp D>; }; }; };`);
    const { layout } = await importZmkSource(join(dir, "mine.keymap"), west.definition);
    const source = generateZmkSource({ layout, board: west.definition, geometry: west.geometry, revisionId: "rev_T", keymapName: "board" });
    expect(source.files.map((f) => f.path)).toEqual(["board.keymap", "board.conf"]);
  });

  test("a west flash writes each half's UF2 from the bundle", async () => {
    const west = await load("zmk");
    const dir = tempDir();
    const root = join(dir, "Volumes");
    mkdirSync(root, { recursive: true });
    const left = uf2Image(0xada52840, 3);
    const right = uf2Image(0xada52840, 4);
    const artifact = join(dir, "a.zip");
    await Bun.write(artifact, zipSync({ "left.uf2": left, "right.uf2": right }));
    const got: Uint8Array[] = [];
    const drive = join(root, "NICENANO");
    const arm = () => mkdirSync(drive, { recursive: true });
    arm();
    const timer = setInterval(() => {
      const f = join(drive, "firmware.uf2");
      if (existsSync(f)) {
        got.push(new Uint8Array(readFileSync(f)));
        rmSync(drive, { recursive: true, force: true });
        if (got.length < 2) setTimeout(arm, 1200); // longer than the 500 ms poll, as a real re-plug is
      }
    }, 10);
    const r = await driverFor(west).flash({
      board: west, buildId: "bld_test", boardRevision: "default", artifactPath: artifact, log: new LogSink(join(dir, "f.log")), onState: () => {}, volumesRoot: root, bootloaderWaitMs: 3000,
    });
    clearInterval(timer);
    // A board without hands-free hooks keeps the manual flow: each drive is written as it appears.
    expect(r.state).toBe("succeeded");
    expect(got).toEqual([left, right]);
  }, 15_000);

  test("restoreLastGoodUf2 reads a saved half image or returns null", async () => {
    const dir = tempDir();
    const { restoreLastGoodUf2 } = await import("../../src/app/firmware-drivers.ts");
    expect(await restoreLastGoodUf2(dir, "foostan/corne", "left")).toBeNull();

    const corneDir = join(dir, "foostan-corne");
    mkdirSync(corneDir, { recursive: true });
    const img = uf2Image(0xada52840, 2);
    await Bun.write(join(corneDir, "left.uf2"), img);

    const restored = await restoreLastGoodUf2(dir, "foostan/corne", "left");
    expect(restored).not.toBeNull();
    expect(restored).toEqual(img);
  });
});
