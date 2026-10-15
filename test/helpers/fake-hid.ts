// A fake keyboard on USB and raw HID for the hands-free flow: nothing here can reach a real device.
import type { HandsFreeDeps } from "../../src/firmware/qmk/handsfree-flash.ts";
import type { HidTransport, RawHidInterface } from "../../src/firmware/toolchain/hid.ts";
import type { UsbDevice } from "../../src/firmware/toolchain/usb.ts";

export const MOONLANDER_REVA = { productId: "0x1969", bootloader: "0483:df11", name: "Moonlander" };

export const runningKeyboard = (serial?: string): UsbDevice => ({ productId: "0x1969", vendorId: "0x3297", name: "Moonlander Mark I", maker: "ZSA Technology Labs", ...(serial ? { serial } : {}) });
export const dfuBootloader = (): UsbDevice => ({ productId: "0xdf11", vendorId: "0x0483", name: "STM32 BOOTLOADER", maker: "STMicroelectronics" });

export type FakeKeyboard = {
  deps: HandsFreeDeps;
  /** Every report written to the raw HID interface. */
  writes: Uint8Array[];
  /** USB listings so far. */
  listings: () => number;
};

/**
 * `usb(n)` is what the nth USB listing (from 0) shows; `hid` is the raw HID interfaces; `onWrite` can throw to model a write error.
 */
export function fakeKeyboard(opts: {
  usb: (listing: number) => UsbDevice[];
  hid?: RawHidInterface[];
  onWrite?: () => void;
  pollMs?: number;
}): FakeKeyboard {
  const writes: Uint8Array[] = [];
  let n = 0;
  const transport: HidTransport = {
    list: async () => opts.hid ?? [],
    write: async (_target, report) => {
      writes.push(new Uint8Array(report));
      opts.onWrite?.();
    },
  };
  return {
    writes,
    listings: () => n,
    deps: { usb: async () => opts.usb(n++), hid: async () => transport, pollMs: opts.pollMs ?? 5 },
  };
}

export const rawHidOf = (serial?: string): RawHidInterface => ({ vendorId: 0x3297, productId: 0x1969, handle: "fake-1", ...(serial ? { serial } : {}) });
