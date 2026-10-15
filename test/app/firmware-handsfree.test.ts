// The hands-free flash end to end through the app, with a fake zapp, a fake USB bus and a fake raw HID: the build carries a marker,
// the keyboard is restarted by a packet instead of a keypress, and the flash is checked against the keyboard's serial number.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FlashFailedError, buildAndWait, flashAndWait, getFlash } from "../../src/app/index.ts";
import { checkoutDirFor } from "../../src/app/firmware.ts";
import { showBoard } from "../../src/app/boards.ts";
import { bootloaderPacket, buildMarker } from "../../src/firmware/qmk/handsfree.ts";
import { dfuImage } from "../helpers/fake-bin.ts";
import { dfuBootloader, fakeKeyboard, rawHidOf, runningKeyboard } from "../helpers/fake-hid.ts";
import { toolchainEnv } from "../helpers/toolchain-env.ts";

const OLD = "keyloom/AAAAAAAAAAAA";
const ORYX = "QxKPz/zLQ3Md";

// Like the real zapp, this writes only once the keyboard is in its bootloader, which the fake marks with a file.
const ZAPP = 'echo "Firmware loaded: STM32 DFU (316 bytes)"; while [ ! -f "$BOOTLOADER_FLAG" ]; do sleep 0.05; done; echo "Flashing"; sleep 0.1; echo ran >> "$ZAPP_CALLS"; exit 0';

async function scenario(opts: { firmware: string; afterFlash: (marker: string) => string | undefined }) {
  const e = await toolchainEnv({ zapp: ZAPP });
  const flag = join(e.root, "in-bootloader");
  const build = await e.run(() => buildAndWait(e.app, "synchronized", { boardRevision: "reva" }));
  const marker = buildMarker(build.id);
  // The fake docker's output has no firmware in it; give the artifact the marker a real build carries, and keep its DFU suffix valid.
  const image = dfuImage("0483:df11", 120);
  image.set(new TextEncoder().encode(marker), 8);
  const dfu = new Uint8Array(image.length);
  dfu.set(image);
  const view = new DataView(dfu.buffer);
  view.setUint32(dfu.length - 4, ~Bun.hash.crc32(dfu.subarray(0, dfu.length - 4)) >>> 0, true);
  await Bun.write(build.artifactPath as string, dfu);

  // phase 0: the keyboard runs `firmware`; a write (or the person) puts it in the bootloader; a few listings later it is back.
  let wrote = false;
  let listingsSinceWrite = 0;
  const keyboard = fakeKeyboard({
    hid: [rawHidOf(opts.firmware)],
    usb: () => {
      if (!wrote) return [runningKeyboard(opts.firmware)];
      listingsSinceWrite++;
      if (listingsSinceWrite <= 2) return [dfuBootloader()];
      const after = opts.afterFlash(marker);
      return after === undefined ? [] : [runningKeyboard(after)];
    },
    onWrite: () => {
      wrote = true;
      void Bun.write(flag, "");
    },
  });
  return { e, flag, build, marker, keyboard, run: <T>(fn: () => Promise<T>) => e.run(fn, { BOOTLOADER_FLAG: flag }) };
}

describe("a build for a ZSA board carries the hands-free pieces", () => {
  test("the keymap folder gets the build's marker as its serial number, the wrapper, and the linker flag", async () => {
    const e = await toolchainEnv();
    const build = await e.run(() => buildAndWait(e.app, "synchronized", { boardRevision: "reva" }));
    // The checkout lives under the fake XDG_CACHE_HOME, which only exists inside e.run.
    const dir = join(await e.run(async () => checkoutDirFor(showBoard("zsa/moonlander"))), "keyboards/zsa/moonlander/keymaps/keyloom");
    expect(await Bun.file(join(dir, "config.h")).text()).toContain(`#define SERIAL_NUMBER "${buildMarker(build.id)}"`);
    expect(await Bun.file(join(dir, "keymap.c")).text()).toContain("__wrap_raw_hid_receive");
    expect(await Bun.file(join(dir, "rules.mk")).text()).toContain("LDFLAGS += -Wl,--wrap=raw_hid_receive");
  });

  test("keyloom generate writes plain source, with no marker: it has no build", async () => {
    const e = await toolchainEnv();
    const { generateFirmware } = await import("../../src/app/index.ts");
    const out = join(e.root, "gen");
    await generateFirmware(e.app, "synchronized", { out });
    expect(await Bun.file(join(out, "config.h")).text()).toContain('#define SERIAL_NUMBER "QxKPz/zLQ3Md"');
    expect(await Bun.file(join(out, "keymap.c")).text()).not.toContain("__wrap_raw_hid_receive");
  });
});

describe("flashing a keyboard that runs keyloom's firmware", () => {
  test("sends the packet instead of asking for a keypress, then confirms the new build", async () => {
    const s = await scenario({ firmware: OLD, afterFlash: (m) => m });
    await s.run(async () => {
      const seen: Array<[string, string | null]> = [];
      const f = await flashAndWait(s.e.app, { buildId: s.build.id, handsFree: s.keyboard.deps, onState: (v) => seen.push([v.status, v.instruction]) });
      expect(f.status).toBe("succeeded");
      expect(f.note).toBe(`Verified: the keyboard is running build ${s.build.id}.`);
      expect(s.keyboard.writes).toHaveLength(1);
      expect([...(s.keyboard.writes[0] as Uint8Array)]).toEqual([...bootloaderPacket()]);
      expect(seen.some(([, i]) => i?.includes("nothing to press"))).toBe(true);
      expect(seen.some(([, i]) => i?.includes("reset button"))).toBe(false);
      // It reads back from the log, so a reload of the web app shows the same.
      expect((await getFlash(s.e.app, f.id)).note).toBe(f.note);
    });
  });

  test("a keyboard that comes back on the old firmware makes the flash fail, naming both builds", async () => {
    const s = await scenario({ firmware: OLD, afterFlash: () => OLD });
    await s.run(async () => {
      const err = (await flashAndWait(s.e.app, { buildId: s.build.id, handsFree: s.keyboard.deps }).catch((x) => x)) as FlashFailedError;
      expect(err).toBeInstanceOf(FlashFailedError);
      expect(err.message).toContain(OLD);
      expect(err.message).toContain(s.marker);
      const f = await getFlash(s.e.app, err.flashId);
      expect(f.status).toBe("failed");
      expect(f.note).toBeNull();
    });
  });
});

describe("flashing a keyboard that doesn't run keyloom's firmware yet", () => {
  test("sends nothing, asks for the bootloader key as before, and still verifies the first hands-free build", async () => {
    const s = await scenario({ firmware: ORYX, afterFlash: (m) => m });
    await s.run(async () => {
      const seen: Array<string | null> = [];
      const flashed = flashAndWait(s.e.app, { buildId: s.build.id, handsFree: s.keyboard.deps, onState: (v) => seen.push(v.instruction) });
      // The person presses the reset key: the keyboard enters the bootloader without any packet.
      setTimeout(() => void Bun.write(s.flag, ""), 600);
      const f = await flashed;
      expect(s.keyboard.writes).toEqual([]);
      expect(seen.some((i) => i?.includes("reset button"))).toBe(true);
      expect(f.status).toBe("succeeded");
    }).catch(() => undefined);
  });
});
