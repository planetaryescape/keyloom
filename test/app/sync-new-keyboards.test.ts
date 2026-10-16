// The new-keyboard card follows the sync engine's own USB reads (D-336): the keyboards keyloom has no board for are published on the
// engine's event stream, from the devices its last read saw, and a failure to name one never stops the engine.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appSyncDeps } from "../../src/app/sync-deps.ts";
import type { DetectedKeyboard } from "../../src/app/index.ts";
import type { UsbDevice } from "../../src/firmware/toolchain/usb.ts";
import { type SyncWorld, syncWorld, waitFor } from "../helpers/fake-sync.ts";

setDefaultTimeout(20_000);

let current: SyncWorld | undefined;
afterEach(async () => {
  await current?.stopAll();
  current = undefined;
});

const corne: DetectedKeyboard = {
  device: { vendorId: "0x1d50", productId: "0x615e", product: "Corne", maker: "ZMK Project", bcdDevice: null, serial: null },
  status: "candidates", knownBoard: null, candidates: [], ambiguous: false, next: "keyloom keyboard add --candidate zmk:corne --home-row <n>",
};

describe("new keyboards on the sync stream", () => {
  test("are published with the boards, from each read, and go when unplugged", async () => {
    current = await syncWorld();
    const w = current;
    let plugged = true;
    const e = w.engine({}, { ...w.deps, newKeyboards: async () => (plugged ? [corne] : []) });
    const seen: DetectedKeyboard[][] = [];
    e.subscribe((_boards, keyboards) => seen.push(keyboards));
    await e.start();
    expect(e.newKeyboards().map((k) => k.device.product)).toEqual(["Corne"]);
    await waitFor(() => seen.some((k) => k.length === 1), "a frame with the Corne");
    plugged = false;
    await waitFor(() => e.newKeyboards().length === 0 && seen.at(-1)?.length === 0, "a frame without it");
  });

  test("a failure to name one leaves the engine reading its own keyboards", async () => {
    current = await syncWorld();
    const w = current;
    const e = w.engine({}, { ...w.deps, newKeyboards: async () => Promise.reject(new Error("index unreadable")) });
    await e.start();
    expect(e.newKeyboards()).toEqual([]);
    expect(w.stateOf(e)).toBeDefined();
  });

  test("the app's deps name keyboards from the devices the keyboard read already saw, with no second USB read", async () => {
    let reads = 0;
    const devices: UsbDevice[] = [{ vendorId: "0x1d50", productId: "0x615e", name: "Corne", maker: "ZMK Project", serial: "0123456789ABCDEF" }];
    current = await syncWorld();
    const deps = appSyncDeps(current.app, { handsFree: { usb: async () => (reads++, devices) } });
    expect(await deps.newKeyboards?.()).toEqual([]);
    await deps.readKeyboards();
    const before = reads;
    const found = (await deps.newKeyboards?.()) ?? [];
    expect(reads).toBe(before);
    // BK's committed Corne is a board keyloom ships, so the device is known and not offered; nothing else on the bus is a keyboard.
    expect(found.every((k) => k.status !== "known")).toBe(true);
  });
});
