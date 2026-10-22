// Writes what a key does (native-meaning.ts) as the source a target firmware runs, or says why the target can't do it. Each refusal
// names the thing the target lacks, so the put shows "the Moonlander has no Bluetooth", not a generic sentence. Pure.
import { modsText } from "./render-grid.ts";
import { MOD_ORDER, type LightingOp, type Step } from "./native-meaning.ts";
import { kanataSource } from "./kanata/natives.ts";
import type { Mod } from "./schema.ts";

/** What the target board can do, for the writers: whether keyloom writes lighting for it, and whether it has Bluetooth. */
export type TargetFacts = { board: string; lighting: { supported: boolean; because?: string }; bluetooth: boolean };

export type Written = { source: string; label: string } | { why: string };

const QMK_MOD = new Map<Mod, string>([["LCTL", "MOD_LCTL"], ["LSFT", "MOD_LSFT"], ["LALT", "MOD_LALT"], ["LGUI", "MOD_LGUI"], ["RCTL", "MOD_RCTL"], ["RSFT", "MOD_RSFT"], ["RALT", "MOD_RALT"], ["RGUI", "MOD_RGUI"]]);
const ZMK_MOD = new Map<Mod, string>([["LCTL", "LCTRL"], ["LSFT", "LSHFT"], ["LALT", "LALT"], ["LGUI", "LGUI"], ["RCTL", "RCTRL"], ["RSFT", "RSHFT"], ["RALT", "RALT"], ["RGUI", "RGUI"]]);

const QMK_RGB: Record<LightingOp, string> = {
  toggle: "RGB_TOG", hueUp: "RGB_HUI", hueDown: "RGB_HUD", satUp: "RGB_SAI", satDown: "RGB_SAD",
  briUp: "RGB_VAI", briDown: "RGB_VAD", speedUp: "RGB_SPI", speedDown: "RGB_SPD", effectNext: "RGB_MODE_FORWARD", effectPrev: "RGB_MODE_REVERSE",
};
const ZMK_RGB: Record<LightingOp, string> = {
  toggle: "RGB_TOG", hueUp: "RGB_HUI", hueDown: "RGB_HUD", satUp: "RGB_SAI", satDown: "RGB_SAD",
  briUp: "RGB_BRI", briDown: "RGB_BRD", speedUp: "RGB_SPI", speedDown: "RGB_SPD", effectNext: "RGB_EFF", effectPrev: "RGB_EFR",
};
const LIGHT_LABEL: Record<LightingOp, string> = {
  toggle: "RGB", hueUp: "Hue+", hueDown: "Hue-", satUp: "Sat+", satDown: "Sat-", briUp: "Bri+", briDown: "Bri-", speedUp: "Spd+", speedDown: "Spd-", effectNext: "RGB»", effectPrev: "RGB«",
};

/** The source for a key with these steps on `firmware`, or the reason the target can't carry it. A key carries one step. */
export function writeSteps(steps: readonly Step[], firmware: "qmk" | "zmk" | "kanata", facts: TargetFacts): Written {
  if (firmware === "kanata") {
    const source = kanataSource(steps);
    const [step] = steps;
    if (source === undefined || step === undefined) return { why: "kanata has no action for it" };
    return { source, label: step.kind === "oneShot" ? `OS${modsText(orderedMods(step.mods))}` : "CapsW" };
  }
  const written: Written[] = [];
  for (const step of steps) {
    const w = firmware === "qmk" ? qmkStep(step, facts) : zmkStep(step, facts);
    if ("why" in w) return w;
    written.push(w);
  }
  if (written.length !== 1) return { why: "it does more than one thing at once, and a key carries one" };
  return written[0] as Written;
}

const orderedMods = (mods: readonly Mod[]): Mod[] => MOD_ORDER.filter((m) => mods.includes(m));
const noBluetooth = (facts: TargetFacts): Written => ({ why: `Bluetooth: ${facts.board} has no Bluetooth` });
const noLighting = (facts: TargetFacts, label: string): Written => ({
  why: `${facts.board} can't carry the ${label} light key: ${facts.lighting.because ?? "keyloom does not write lighting for it"}`,
});

function qmkStep(step: Step, facts: TargetFacts): Written {
  switch (step.kind) {
    case "oneShot": {
      const names = orderedMods(step.mods).map((m) => QMK_MOD.get(m));
      if (names.length === 0 || names.some((n) => n === undefined)) return { why: "keyloom can't write that modifier for QMK" };
      return { source: `OSM(${names.join("|")})`, label: `OS${modsText(orderedMods(step.mods))}` };
    }
    case "capsWord": return { source: "CW_TOGG", label: "CapsW" };
    case "bootloader": return { source: "QK_BOOT", label: "Boot" };
    case "reset": return { source: "QK_REBOOT", label: "Reset" };
    case "lighting": return facts.lighting.supported ? { source: QMK_RGB[step.op], label: LIGHT_LABEL[step.op] } : noLighting(facts, LIGHT_LABEL[step.op]);
    case "bluetooth": case "bluetoothSelect":
      return facts.bluetooth ? { why: "keyloom doesn't write Bluetooth keys for QMK" } : noBluetooth(facts);
    case "output":
      return step.to === "usb" ? { why: `Output: ${facts.board} has no Bluetooth, so there is no output to select` } : noBluetooth(facts);
  }
}

function zmkStep(step: Step, facts: TargetFacts): Written {
  switch (step.kind) {
    case "oneShot": {
      const mods = orderedMods(step.mods);
      const [mod] = mods;
      const key = mod === undefined ? undefined : ZMK_MOD.get(mod);
      if (mod === undefined || key === undefined || mods.length !== 1) return { why: "a ZMK sticky key holds one modifier, and this one-shot holds more" };
      return { source: `&sk ${key}`, label: `OS${modsText([mod])}` };
    }
    case "capsWord": return { source: "&caps_word", label: "CapsW" };
    case "bootloader": return { source: "&bootloader", label: "Boot" };
    case "reset": return { source: "&sys_reset", label: "Reset" };
    case "lighting": return facts.lighting.supported ? { source: `&rgb_ug ${ZMK_RGB[step.op]}`, label: LIGHT_LABEL[step.op] } : noLighting(facts, LIGHT_LABEL[step.op]);
    case "bluetooth": {
      if (!facts.bluetooth) return noBluetooth(facts);
      const name = { clear: "BT_CLR", clearAll: "BT_CLR_ALL", next: "BT_NXT", previous: "BT_PRV" }[step.op];
      return { source: `&bt ${name}`, label: name };
    }
    case "bluetoothSelect": return facts.bluetooth ? { source: `&bt BT_SEL ${step.profile}`, label: `BT${step.profile}` } : noBluetooth(facts);
    case "output": {
      if (step.to === "usb") return { source: "&out OUT_USB", label: "USB" };
      return facts.bluetooth ? { source: "&out OUT_BLE", label: "BLE" } : noBluetooth(facts);
    }
  }
}
