// A Moonlander that can be flashed more than once: it runs a serial number, one raw-HID packet puts it in the DFU
// bootloader (and releases the fake zapp, which waits for a flag file as the real one waits for the bootloader), and
// a few listings later it is back running the marker of whatever build the test says was written. Nothing here can
// reach a real device.
import { join } from "node:path";
import type { HandsFreeDeps } from "../../src/firmware/qmk/handsfree-flash.ts";
import type { HidTransport } from "../../src/firmware/toolchain/hid.ts";
import type { UsbDevice } from "../../src/firmware/toolchain/usb.ts";
import { dfuBootloader, rawHidOf, runningKeyboard } from "./fake-hid.ts";

/** A zapp that, like the real one, writes only once the keyboard is in its bootloader, and then waits for the next flash. */
export const REPEATING_ZAPP =
  'echo "Firmware loaded: STM32 DFU (316 bytes)"; while [ ! -f "$BOOTLOADER_FLAG" ]; do sleep 0.05; done; echo "Flashing"; sleep 0.1; rm -f "$BOOTLOADER_FLAG"; echo ran >> "$ZAPP_CALLS"; exit 0';

export function liveKeyboard(root: string, initialSerial: string | undefined) {
  const flag = join(root, "in-bootloader");
  const state = {
    serial: initialSerial as string | undefined, mode: "running" as "running" | "dfu" | "gone", listings: 0, expected: undefined as string | undefined,
    /** Raw HID cannot be found, so keyloom cannot restart the keyboard itself and asks for the reset key. */
    noHid: false,
  };
  const writes: Uint8Array[] = [];
  const transport: HidTransport = {
    list: async () => (state.mode === "running" && !state.noHid ? [rawHidOf()] : []),
    write: async (_t, report) => {
      writes.push(new Uint8Array(report));
      state.mode = "dfu";
      state.listings = 0;
      await Bun.write(flag, "");
    },
  };
  const usb = async (): Promise<UsbDevice[]> => {
    if (state.mode === "gone") return [];
    if (state.mode === "dfu") {
      state.listings++;
      if (state.listings <= 2) return [dfuBootloader()];
      state.mode = "running";
      state.serial = state.expected;
    }
    return [runningKeyboard(state.serial)];
  };
  const deps: HandsFreeDeps = { usb, hid: async () => transport, pollMs: 5 };
  /** The person presses the reset key: the keyboard enters its bootloader and the fake zapp is released. */
  const pressReset = async () => {
    state.mode = "dfu";
    state.listings = 0;
    await Bun.write(flag, "");
  };
  return { deps, flag, state, writes, unplug: () => (state.mode = "gone"), plugIn: () => (state.mode = "running"), pressReset };
}

/** Writes `marker` into a built firmware file where the linker would have put SERIAL_NUMBER, and keeps its DFU suffix valid. */
export async function stampMarker(path: string, marker: string): Promise<void> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  bytes.set(new TextEncoder().encode(marker), 8);
  new DataView(bytes.buffer).setUint32(bytes.length - 4, ~Bun.hash.crc32(bytes.subarray(0, bytes.length - 4)) >>> 0, true);
  await Bun.write(path, bytes);
}
