// D-237: the keyboard-state reader no longer assumes ZSA's vendor ID, so a QMK board keyloom has derived is seen by `doctor` and sync's
// readers, while a ZSA board behaves exactly as before. Nothing is restarted or written; the bus and raw HID are fakes.
import { afterAll, describe, expect, test } from "bun:test";
import { addKeyboard, openApp, rebootKeyboard, runKeyboardChecks, UsageError } from "../../src/app/index.ts";
import { attachedKeyboards } from "../../src/app/keyboard.ts";
import { readKeyboards, syncSupported, syncableBoards } from "../../src/app/sync-keyboard.ts";
import { showBoard } from "../../src/app/boards.ts";
import { setUserBoards } from "../../src/boards/registry.ts";
import { GeometryError } from "../../src/boards/geometry-error.ts";
import type { HandsFreeDeps } from "../../src/firmware/qmk/handsfree-flash.ts";
import type { UsbDevice } from "../../src/firmware/toolchain/usb.ts";
import { runningKeyboard } from "../helpers/fake-hid.ts";
import { tempDir } from "../helpers/tmp.ts";

const fixtures = `${import.meta.dir}/../fixtures/qmk/crkbd`;
const FILES: Record<string, string> = { "keyboards/crkbd/info.json": `${fixtures}/info.json`, "keyboards/crkbd/rev1/keyboard.json": `${fixtures}/rev1/keyboard.json` };
const tree = async (url: string): Promise<string> => {
  const file = FILES[url.replace(/^.*\/7a1bbf37c5c07da4ea0a162bb139083a46ef40a1\//, "")];
  if (file === undefined) throw new GeometryError(`GET ${url} returned 404`);
  return Bun.file(file).text();
};

const corne = (serial?: string): UsbDevice => ({ vendorId: "0x4653", productId: "0x0001", name: "Corne", maker: "foostan", ...(serial ? { serial } : {}) });
// A fake bus whose raw HID cannot be reached, as in a test: a write would be refused anyway.
const bus = (devices: UsbDevice[]): HandsFreeDeps => ({ usb: async () => devices, hid: async () => { throw new Error("no raw HID in this test"); } });

async function derivedCorne() {
  const app = openApp({ dataDir: tempDir() });
  await addKeyboard(app, { candidate: "qmk:crkbd/rev1", homeRow: 2 }, { fetchText: tree, cacheDir: tempDir(), boards: [] });
  return app;
}

// Derived boards live in the registry of this process; leave it as other test files expect it.
afterAll(() => setUserBoards([]));

describe("a QMK board that is not ZSA's", () => {
  test("is seen by the keyboard-state reader, identified by the vendor and product ID it was derived from, and is not restartable", async () => {
    await derivedCorne();
    const seen = await attachedKeyboards(bus([corne("")]));
    expect(seen.map((k) => [k.boardId, k.identity.vendorId, k.identity.productId, k.target])).toEqual([["local/crkbd-rev1", "0x4653", "0x0001", undefined]]);
    expect(seen[0]?.firmware.state).toBe("other");
  });

  test("shows up in doctor in words that do not promise hands-free flashing", async () => {
    await derivedCorne();
    const checks = await runKeyboardChecks({ usb: async () => [corne("0123")], hid: async () => { throw new Error("no"); } });
    const mine = checks.find((c) => c.name === "keyboard local/crkbd-rev1 default");
    expect(mine?.ok).toBe(true);
    expect(mine?.detail).toContain("every flash needs the board's own bootloader key");
    expect(mine?.detail).not.toContain("flashes after it need none");
  });

  test("is not syncable, because sync needs a keyboard keyloom can restart", async () => {
    await derivedCorne();
    expect(syncSupported(showBoard("local/crkbd-rev1"))).toBe(false);
    expect(syncableBoards().map((b) => b.definition.id)).not.toContain("local/crkbd-rev1");
    const readings = await readKeyboards({ usb: async () => [corne("0123")] });
    expect(readings.has("local/crkbd-rev1")).toBe(false);
  });

  test("keyloom never offers to restart it into a bootloader, and says what to do", async () => {
    await derivedCorne();
    await expect(rebootKeyboard({ board: "local/crkbd-rev1", handsFree: bus([corne("0123")]) })).rejects.toThrow(/can only restart a ZSA keyboard/);
    await expect(rebootKeyboard({ board: "local/crkbd-rev1", handsFree: bus([corne("0123")]) })).rejects.toBeInstanceOf(UsageError);
  });
});

describe("a ZSA board is read exactly as before", () => {
  test("a Moonlander is seen by ZSA's vendor ID and its product ID, restartable, with the marker read from the serial", async () => {
    const seen = await attachedKeyboards(bus([runningKeyboard("keyloom/AAAAAAAAAAAA")]));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ boardId: "zsa/moonlander", identity: { vendorId: "0x3297", productId: "0x1969" }, firmware: { state: "keyloom", serial: "keyloom/AAAAAAAAAAAA" } });
    expect(seen[0]?.target?.bootloader).toBe("0483:df11");
    expect(syncSupported(showBoard("zsa/moonlander"))).toBe(true);
  });

  test("the same product ID under another vendor ID is not a Moonlander", async () => {
    const lookalike: UsbDevice = { ...runningKeyboard("keyloom/AAAAAAAAAAAA"), vendorId: "0x1234" };
    expect(await attachedKeyboards(bus([lookalike]))).toEqual([]);
  });
});
