// A fake split keyboard on USB serial and UF2 boot drives for the ZMK hands-free flow: nothing here can reach a real device.
// Each half is either running its app (with a serial port if its firmware has keyloom's module) or sitting in its bootloader,
// where its boot drive is a folder under `root`. A touch moves a half into its bootloader; writing a .uf2 to the drive flashes it
// and the half comes back running whatever marker is in that file, as a real half does.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SerialPort, SerialTransport } from "../../src/firmware/toolchain/serial.ts";
import { SerialError } from "../../src/firmware/toolchain/serial.ts";
import { type HalfLetter, keyInFirmware } from "../../src/firmware/zmk/handsfree.ts";
import type { ZmkHandsFreeDeps } from "../../src/firmware/zmk/handsfree-flash.ts";

export type FakeHalf = {
  letter: HalfLetter;
  /** The boot drive's label; the Corne's halves share one. */
  volume: string;
  vendorId: number;
  productId: number;
  /** The node a touch must name. */
  path: string;
  /** The USB serial number while it runs. Without one the firmware has no serial port (it is older than keyloom's module). */
  serial?: string;
  /** Whether the half's own USB cable is plugged in; a half on battery that is sent to its bootloader returns to its app. */
  cabled: boolean;
  /** Set by the world: "app" or "boot". */
  mode: "app" | "boot";
};

export const GLOVE80_VENDOR = 0x16c0;
export const OLD_KEY = "AAAAAAAAAAAA";
export const serialOf = (key: string, letter: HalfLetter, tail = ":GLV80-0123456789ABCDEF"): string => `keyloom/${key}-${letter}${tail}`;

/** One UF2 image whose payload carries the serial template, placed across a block boundary so a scan has to join blocks. */
export function uf2Carrying(text: string | undefined, family: number, blocks = 4): Uint8Array {
  const out = new Uint8Array(blocks * 512);
  const view = new DataView(out.buffer);
  const data = new Uint8Array(blocks * 256).fill(0x5a);
  if (text !== undefined) data.set(new TextEncoder().encode(text), 250);
  for (let i = 0; i < blocks; i++) {
    const o = i * 512;
    view.setUint32(o, 0x0a324655, true);
    view.setUint32(o + 4, 0x9e5d5157, true);
    view.setUint32(o + 8, 0x2000, true);
    view.setUint32(o + 12, 0x26000 + i * 256, true);
    view.setUint32(o + 16, 256, true);
    view.setUint32(o + 20, i, true);
    view.setUint32(o + 24, blocks, true);
    view.setUint32(o + 28, family, true);
    out.set(data.subarray(i * 256, (i + 1) * 256), o + 32);
    view.setUint32(o + 508, 0x0ab16f30, true);
  }
  return out;
}

/** A Glove80 build: the left image then the right, as the Nix build joins them. */
export function glove80Image(key: string | undefined): Uint8Array {
  const left = uf2Carrying(key && serialOf(key, "L"), 0x9807b007);
  const right = uf2Carrying(key && serialOf(key, "R"), 0x9808b007);
  const out = new Uint8Array(left.length + right.length);
  out.set(left);
  out.set(right, left.length);
  return out;
}

export type FakeWorld = {
  deps: ZmkHandsFreeDeps;
  halves: FakeHalf[];
  /** Every touch, in order. */
  touches: Array<{ path: string; baud: number }>;
  /** The images each half was flashed with, in order, by half. */
  flashed: Array<{ letter: HalfLetter; key: string | undefined }>;
  /** The person's key combo: puts a half in its bootloader whatever it runs. */
  press: (letter: HalfLetter) => void;
  stop: () => void;
};

export function fakeWorld(opts: {
  /** The folder the boot drives appear in. */
  root: string;
  halves: Array<Partial<FakeHalf> & Pick<FakeHalf, "letter" | "volume">>;
  /** How long a half takes to mount its drive after it is sent to its bootloader. */
  bootDelayMs?: number;
  /** What a half reports after it was flashed with an image carrying `key`; the default is the real behaviour, the new build's marker. */
  after?: (half: FakeHalf, key: string | undefined) => string | undefined;
  /** Makes touching `path` fail, as stty does without permission. */
  touchError?: (path: string) => string | undefined;
  comeBackMs?: number;
  /** How long after a half comes back its serial port appears; until then it shows only as a USB device, as a real half does. */
  portLagMs?: number;
  /** Halves whose USB serial port never appears after they are flashed; they show only as a USB device, as the Corne's left half did. */
  portlessAfterFlash?: HalfLetter[];
}): FakeWorld {
  const halves: FakeHalf[] = opts.halves.map((h) => ({
    vendorId: GLOVE80_VENDOR, productId: h.letter === "L" ? 0x27db : 0x27d9, path: `/dev/fake-ttyACM-${h.letter}`, cabled: true, mode: "app", ...h,
  }));
  const touches: FakeWorld["touches"] = [];
  const flashed: FakeWorld["flashed"] = [];
  const bootDelay = opts.bootDelayMs ?? 30;

  const enterBoot = (half: FakeHalf) => {
    half.mode = "boot";
    // On battery the bootloader gives up after 3 s with no USB, so no drive is ever seen.
    if (!half.cabled) {
      setTimeout(() => (half.mode = "app"), bootDelay);
      return;
    }
    setTimeout(() => mkdirSync(join(opts.root, half.volume), { recursive: true }), bootDelay);
  };

  // When each half's serial port appears after it comes back; a half with no entry has its port.
  const portAt = new Map<HalfLetter, number>();
  const portless = new Set<HalfLetter>();
  const portUp = (h: FakeHalf) => !portless.has(h.letter) && (portAt.get(h.letter) ?? 0) <= Date.now();
  const transport: SerialTransport = {
    async list() {
      return halves
        .filter((h) => h.mode === "app" && h.serial !== undefined && portUp(h))
        .map((h): SerialPort => ({ vendorId: h.vendorId, productId: h.productId, serial: h.serial as string, path: h.path }));
    },
    async touch(path, baud) {
      touches.push({ path, baud });
      const refused = opts.touchError?.(path);
      if (refused) throw new SerialError(refused);
      const half = halves.find((h) => h.path === path);
      if (!half || half.mode !== "app" || half.serial === undefined) throw new SerialError(`stty: ${path}: No such file or directory`);
      if (baud === 1200) enterBoot(half);
      // The central's 1201 reaches the peripherals over the split link.
      else if (baud === 1201 && half.letter === "L") for (const p of halves) if (p.letter === "R" && p.mode === "app") enterBoot(p);
    },
  };

  // A bootloader acts once the file is whole: wait until its size holds still across two ticks.
  const sizes = new Map<string, number>();
  const timer = setInterval(() => {
    for (const volume of new Set(halves.map((h) => h.volume))) {
      const dir = join(opts.root, volume);
      if (!existsSync(dir)) continue;
      const file = readdirSync(dir).find((n) => n.endsWith(".uf2"));
      if (!file) continue;
      const bytes = readFileSync(join(dir, file));
      if (bytes.length === 0 || sizes.get(volume) !== bytes.length) {
        sizes.set(volume, bytes.length);
        continue;
      }
      sizes.delete(volume);
      const half = halves.find((h) => h.volume === volume && h.mode === "boot");
      rmSync(dir, { recursive: true, force: true });
      if (!half) continue;
      // Glove80 bootloaders keep their own family; a shared-family board runs the role in the written image.
      const family = half.vendorId === GLOVE80_VENDOR ? (half.letter === "L" ? 0x9807b007 : 0x9808b007) : 0xada52840;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const blocks: Uint8Array[] = [];
      const payload: Uint8Array[] = [];
      for (let off = 0; off + 512 <= bytes.length; off += 512) {
        if (view.getUint32(off + 28, true) !== family) continue;
        blocks.push(bytes.subarray(off, off + 512));
        payload.push(bytes.subarray(off + 32, off + 32 + view.getUint32(off + 16, true)));
      }
      if (blocks.length === 0) continue;
      const key = keyInFirmware(Buffer.concat(blocks));
      const role = /keyloom\/[0-9A-Z]{12}-([LR]):/.exec(Buffer.concat(payload).toString("latin1"))?.[1] as HalfLetter | undefined;
      flashed.push({ letter: half.letter, key });
      half.mode = "boot";
      setTimeout(() => {
        half.mode = "app";
        if (opts.portLagMs !== undefined) portAt.set(half.letter, Date.now() + opts.portLagMs);
        if (opts.portlessAfterFlash?.includes(half.letter)) portless.add(half.letter);
        const next = opts.after ? opts.after(half, key) : key === undefined || role === undefined ? undefined : serialOf(key, role);
        if (next === undefined) delete half.serial;
        else half.serial = next;
      }, opts.comeBackMs ?? 40);
    }
  }, 10);

  return {
    deps: {
      serial: async () => transport,
      // With a port lag, USB sees a running half at once, by its IDs and serial number, before its serial port is up. Without one,
      // USB shows nothing, so a half is seen only through its port.
      usb: async () =>
        halves
          .filter((h) => (opts.portLagMs !== undefined || opts.portlessAfterFlash !== undefined) && h.mode === "app")
          .map((h) => ({ vendorId: `0x${h.vendorId.toString(16)}`, productId: `0x${h.productId.toString(16)}`, name: `fake ${h.letter}`, maker: "MoErgo", ...(h.serial === undefined ? {} : { serial: h.serial }) })),
      pollMs: 10,
      restartWaitMs: 600,
      verifyWaitMs: 800,
    },
    halves, touches, flashed,
    press: (letter) => enterBoot(halves.find((h) => h.letter === letter) as FakeHalf),
    stop: () => clearInterval(timer),
  };
}
