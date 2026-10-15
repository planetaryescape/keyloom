// What keyloom adds to a ZMK build so it can be flashed without a keypress (D-095): the module in
// firmware/zmk/keyloom-zmk, and a build marker in each half's USB serial number. The generator (conf lines),
// the build (Nix expression) and the host side (handsfree-flash.ts) read their constants from here so they
// cannot drift apart from the firmware.
import { unzipSync } from "fflate";
import type { HandsFree } from "../../boards/recipes.ts";

/** A close at this rate restarts the half whose port it is into its UF2 bootloader. */
export const LOCAL_BAUD = 1200;
/** A close at this rate on the central restarts its peripherals. Kconfig-free: handsfree.c has the same constant. */
export const RELAY_BAUD = 1201;

const MARKER_PREFIX = "keyloom/";
const KEY_LENGTH = 12;

export type HalfLetter = "L" | "R";

/** The 12 characters that identify a build in its halves' serial numbers: the random tail of the ULID in `bld_<ULID>`, as on the Moonlander (D-070). */
export function buildKey(buildId: string): string {
  const id = buildId.replace(/^bld_/, "");
  if (!/^[0-9A-Z]{26}$/.test(id)) throw new Error(`"${buildId}" isn't a build ID, so it can't name a firmware build`);
  return id.slice(-KEY_LENGTH);
}

/** `keyloom/<12>-<letter>`: the part of a serial number that names a build and a half. */
export const halfMarker = (buildId: string, half: HalfLetter): string => `${MARKER_PREFIX}${buildKey(buildId)}-${half}`;

export type ParsedSerial = { key: string; half: HalfLetter };

/** Which build and half a USB serial number names, or undefined when keyloom's module did not write it. The chip ID after `:` is ignored. */
export function parseSerial(serial: string | undefined): ParsedSerial | undefined {
  const m = serial === undefined ? null : new RegExp(`^${MARKER_PREFIX}([0-9A-Z]{${KEY_LENGTH}})-([LR])(?::.*)?$`).exec(serial);
  return m ? { key: m[1] as string, half: m[2] as HalfLetter } : undefined;
}

const UF2_BLOCK = 512;
const UF2_DATA_AT = 32;

/** The payload bytes of a UF2 file in file order, so a string the linker placed across two blocks is whole again. */
function uf2Payload(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  for (let off = 0; off + UF2_BLOCK <= bytes.length; off += UF2_BLOCK) {
    const size = Math.min(view.getUint32(off + 16, true), 476);
    parts.push(bytes.subarray(off + UF2_DATA_AT, off + UF2_DATA_AT + size));
  }
  return Buffer.concat(parts);
}

/** The build key inside a firmware file, if it is a hands-free build: the serial-number template is a plain string in flash. */
export function keyInFirmware(bytes: Uint8Array): string | undefined {
  const text = Buffer.from(uf2Payload(bytes)).toString("latin1");
  return new RegExp(`${MARKER_PREFIX}([0-9A-Z]{${KEY_LENGTH}})-[LR]:`).exec(text)?.[1];
}

/**
 * The build key in a firmware artifact: a Glove80's single UF2, or a west build's zip with one UF2 per half. Every image must carry
 * the same key, so a bundle with a half missing its marker is not taken for a hands-free build.
 */
export function keyInArtifact(bytes: Uint8Array): string | undefined {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return keyInFirmware(bytes);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return undefined;
  }
  const keys = Object.entries(entries).filter(([name]) => name.endsWith(".uf2")).map(([, image]) => keyInFirmware(image));
  const first = keys[0];
  return first !== undefined && keys.every((k) => k === first) ? first : undefined;
}

/** What a build log says about the module: whether the firmware carries the key the generated conf asked for. */
export function moduleReport(files: ReadonlyArray<{ content: string }>, artifact: Uint8Array): string | undefined {
  const asked = files.map((f) => new RegExp(`${MARKER_PREFIX}([0-9A-Z]{${KEY_LENGTH}})-[LR]:`).exec(f.content)?.[1]).find((k) => k !== undefined);
  if (asked === undefined) return undefined;
  return keyInArtifact(artifact) === asked
    ? `keyloom: the firmware carries keyloom's hands-free module (build key ${asked})`
    : `keyloom: warning: the firmware does not carry the build key ${asked}, so keyloom can't restart or verify the halves by itself; flashing it needs the bootloader keys`;
}

export const serialLine = (template: string): string => `CONFIG_USB_DEVICE_SN="${template}"`;

/** File name of the per-half conf a Glove80-style build reads (`keyloom-L.conf`). */
export const halfConfFile = (half: HalfLetter): string => `keyloom-${half}.conf`;

export type HandsFreeConf = {
  /** Appended to the layout's conf, which every half reads. */
  shared: string[];
  /** Written beside it, one per half, for boards whose serial function takes the whole template. */
  perHalf: Array<{ path: string; content: string }>;
};

/**
 * The Kconfig that puts `buildId` in the halves' serial numbers. The USB descriptor is built from CONFIG_USB_DEVICE_SN,
 * and its length is fixed by the template, so the template always has the shape the firmware fills in.
 */
export function handsFreeConf(config: HandsFree, buildId: string): HandsFreeConf {
  const template = (half: HalfLetter): string => `${halfMarker(buildId, half)}${config.serialTail}`;
  if (config.serialMarker === "usb-sn-override") {
    // The module picks L or R from the half's role, so one template serves both.
    return { shared: ["CONFIG_KEYLOOM_SERIAL_OVERRIDE=y", serialLine(template("L"))], perHalf: [] };
  }
  return {
    shared: [],
    perHalf: config.halves.map((h) => ({ path: halfConfFile(h.marker), content: `# keyloom: this half's USB serial number\n${serialLine(template(h.marker))}\n` })),
  };
}

/**
 * Replaces the template's config/default.nix for a Glove80 build: the same two halves, built with keyloom's module and the
 * per-half serial template. nix-build reads `../keyloom-zmk` from the mounted checkout, so the module is copied into the store.
 */
export const GLOVE80_NIX = `# Written by keyloom: moergo-sc/glove80-zmk-config's default.nix plus keyloom's hands-free module (D-095).
{ pkgs ?  import <nixpkgs> {}
, firmware ? import ../src {}
}:

let
  config = ./.;
  module = ../keyloom-zmk;

  half = board: letter:
    (firmware.zmk.override {
      inherit board;
      keymap = "\${config}/glove80.keymap";
      kconfig = "\${config}/glove80.conf;\${config}/keyloom-\${letter}.conf";
      extraModules = [ module ];
    }).overrideAttrs (old: {
      cmakeFlags = old.cmakeFlags ++ [ "-DEXTRA_DTC_OVERLAY_FILE=\${module}/keyloom-cdc-acm.overlay" ];
    });

in firmware.combine_uf2 (half "glove80_lh" "L") (half "glove80_rh" "R")
`;
