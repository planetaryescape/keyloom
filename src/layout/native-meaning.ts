// What a native binding does, as one vocabulary the readers (native-read.ts) produce and the writers (native-write.ts) consume:
// one-shot modifiers, caps word, bootloader, reset, RGB lighting, Bluetooth and output selection, and a layer held by a hold-tap
// (MoErgo's magic). A reading says what the key does; a writer says what that becomes on a board. Pure.
import type { Mod } from "./schema.ts";

export type LightingOp = "toggle" | "hueUp" | "hueDown" | "satUp" | "satDown" | "briUp" | "briDown" | "speedUp" | "speedDown" | "effectNext" | "effectPrev";

/** One thing a key does. A binding that does several (a ZMK macro of two calls) reads as several steps. */
export type Step =
  | { kind: "oneShot"; mods: Mod[] }
  | { kind: "capsWord" }
  | { kind: "bootloader" }
  | { kind: "reset" }
  | { kind: "lighting"; op: LightingOp }
  | { kind: "bluetooth"; op: "clear" | "clearAll" | "next" | "previous" }
  | { kind: "bluetoothSelect"; profile: number }
  | { kind: "output"; to: "usb" | "ble" };

/**
 * `steps`: the key does these. `holdLayer`: the key holds `layerId` while it is held, and its tap (named by `tap`) is not carried.
 * `unknown`: keyloom reads nothing in this source.
 */
export type Reading =
  | { kind: "steps"; steps: Step[] }
  | { kind: "holdLayer"; layerId: string; tap: string }
  | { kind: "unknown" };

/** Mods in the order QMK, ZMK and kanata all list them, so a set of mods always reads and writes the same way. */
export const MOD_ORDER: readonly Mod[] = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"];
