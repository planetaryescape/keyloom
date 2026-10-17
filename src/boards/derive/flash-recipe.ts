// The flash recipe for a derived board (22#building-the-board-definition). keyloom flashes four ways: Zapp (ZSA boards only), UF2 boot
// drives, a command-line DFU tool (atmel-dfu, stm32-dfu and caterina: 76% of QMK boards with USB IDs, D-365), and "manual", where it
// shows what to do and waits. A derived board gets the first that fits its bootloader, and manual with the reason when none does. Pure.
import type { FlashRecipe, FlashStep } from "../recipes.ts";

export type QmkFlash = { flash: FlashRecipe; artifact: "bin" | "hex" | "uf2"; /** Why the recipe is manual, in a sentence a person can read; absent for a recipe keyloom runs. */ manualReason?: string };

// What `make` produces for each bootloader (qmk_firmware docs/flashing.md: AVR bootloaders take a .hex, ARM DFU ones a .bin, RP2040 a .uf2).
const ARTIFACT: Record<string, QmkFlash["artifact"]> = {
  "atmel-dfu": "hex", "qmk-dfu": "hex", "lufa-dfu": "hex", caterina: "hex", halfkay: "hex", usbasploader: "hex", bootloadhid: "hex", "lufa-ms": "hex",
  "stm32-dfu": "bin", stm32duino: "bin", "wb32-dfu": "bin", "at32-dfu": "bin", "gd32v-dfu": "bin", kiibohd: "bin",
  rp2040: "uf2", tinyuf2: "uf2", uf2boot: "uf2",
};

// Where QMK's flashing guide says to start, per bootloader, and which tool writes the file.
const MANUAL: Record<string, string> = {
  "atmel-dfu": "Put the board in its DFU bootloader (the QK_BOOT key, the RESET button on the PCB, or shorting RST to GND), then write the .hex with QMK Toolbox or dfu-programmer.",
  "qmk-dfu": "Put the board in its DFU bootloader (the QK_BOOT key, the RESET button on the PCB, or shorting RST to GND), then write the .hex with QMK Toolbox or dfu-programmer.",
  "lufa-dfu": "Put the board in its DFU bootloader (the QK_BOOT key, the RESET button on the PCB, or shorting RST to GND), then write the .hex with QMK Toolbox or dfu-programmer.",
  caterina: "Reset the board (the QK_BOOT key, the RESET button, or shorting RST to GND; some need it twice within 750 ms, and you have about 7 seconds), then write the .hex with QMK Toolbox or avrdude -c avr109.",
  halfkay: "Press the Teensy's program button (or the QK_BOOT key), then write the .hex with the Teensy Loader or QMK Toolbox.",
  usbasploader: "Enter the bootloader (the QK_BOOT key or the board's reset method), then write the .hex with QMK Toolbox or avrdude.",
  bootloadhid: "Enter the bootloader (the QK_BOOT key or the board's reset method), then write the .hex with QMK Toolbox or bootloadHID.",
  "stm32-dfu": "Put the board in its DFU bootloader (the QK_BOOT key, the RESET button, or holding BOOT0 while plugging in), then write the .bin with QMK Toolbox or dfu-util.",
  stm32duino: "Enter the bootloader (the QK_BOOT key or the board's reset method), then write the .bin with QMK Toolbox or dfu-util.",
  "wb32-dfu": "Put the board in its DFU bootloader (the QK_BOOT key or the board's reset method), then write the .bin with QMK Toolbox or wb32-dfu-updater.",
  "at32-dfu": "Put the board in its DFU bootloader (the QK_BOOT key or the board's reset method), then write the .bin with QMK Toolbox or dfu-util.",
  tinyuf2: "Put the board in its UF2 bootloader (the QK_BOOT key or double-tapping reset), then copy the .uf2 onto the drive that appears.",
  uf2boot: "Put the board in its UF2 bootloader (the QK_BOOT key or double-tapping reset), then copy the .uf2 onto the drive that appears.",
};

/** The RP2040 ROM bootloader's drive is always called RPI-RP2 (qmk_firmware docs/flashing.md, "Raspberry Pi RP2040 UF2"). */
const RP2040_VOLUME = "RPI-RP2";

// The USB product ID atmel-dfu's bootloader reports for each chip, all under Atmel's vendor ID 03eb. dfu-programmer's own target table
// (src/arguments.c, `device_id`, dfu-programmer/dfu-programmer master, read 2026-10-17) is the source; its names are the ones the tool takes.
const ATMEL_VENDOR_ID = "03eb";
const ATMEL_DFU_PRODUCT: Record<string, string> = {
  atmega8u2: "2fee", atmega16u2: "2fef", atmega32u2: "2ff0", atmega16u4: "2ff3", atmega32u4: "2ff4", atmega32u6: "2ff2",
  at90usb82: "2ff7", at90usb162: "2ffa", at90usb646: "2ff9", at90usb647: "2ff9", at90usb1286: "2ffb", at90usb1287: "2ffb",
};
/** The STM32 ROM bootloader, the same for every STM32 (qmk_firmware docs/flashing.md, "STM32/APM32 DFU"). */
const STM32_DFU_ID = "0483:df11";

const DFU_ENTER = "Press the QK_BOOT key, press the RESET button on the PCB, or short RST to GND.";
const STM32_ENTER = "Press the QK_BOOT key, press the RESET button, or hold BOOT0 while plugging in the USB cable.";
const CATERINA_ENTER = "Press the QK_BOOT key or the RESET button, or short RST to GND (some boards need it twice within 750 ms). The bootloader only waits about 7 seconds, so keyloom is ready first.";

/** The recipe that runs a DFU tool for this bootloader, or the reason it can't be written. */
function dfuToolFlash(bootloader: string, processor: string | undefined, bootInstructions: string | undefined): FlashRecipe | string {
  const enter = (fallback: string): string => bootInstructions ?? fallback;
  if (bootloader === "stm32-dfu") return { kind: "dfu-tool", tool: "dfu-util", bootloader: STM32_DFU_ID, enter: enter(STM32_ENTER) };
  if (processor === undefined) return `QMK's data doesn't say which chip this ${bootloader} keyboard has, and the tool needs its name`;
  if (bootloader === "caterina") return { kind: "dfu-tool", tool: "avrdude", mcu: processor, enter: enter(CATERINA_ENTER) };
  const product = ATMEL_DFU_PRODUCT[processor];
  if (product === undefined) return `keyloom doesn't know the atmel-dfu USB ID of the ${processor}`;
  return { kind: "dfu-tool", tool: "dfu-programmer", bootloader: `${ATMEL_VENDOR_ID}:${product}`, mcu: processor, enter: enter(DFU_ENTER) };
}

export function qmkFlash(bootloader: string | undefined, bootInstructions?: string, processor?: string): QmkFlash {
  const artifact = (bootloader === undefined ? undefined : ARTIFACT[bootloader]) ?? "bin";
  if (bootloader === "rp2040") {
    return {
      artifact,
      flash: {
        kind: "uf2-drives",
        steps: [{ volume: RP2040_VOLUME, label: "keyboard", enter: bootInstructions ?? "Tap the QK_BOOT key, double-tap the RESET button, or hold BOOTSEL while plugging in the USB cable." }],
      },
    };
  }
  let unwritable: string | undefined;
  if (bootloader === "atmel-dfu" || bootloader === "stm32-dfu" || bootloader === "caterina") {
    const recipe = dfuToolFlash(bootloader, processor, bootInstructions);
    if (typeof recipe !== "string") return { artifact, flash: recipe };
    unwritable = recipe;
  }
  const how = bootloader === undefined ? undefined : MANUAL[bootloader];
  const reason = unwritable ?? (bootloader === undefined
    ? "QMK's data doesn't say which bootloader this keyboard has"
    : bootloader === "tinyuf2" || bootloader === "uf2boot"
      ? `keyloom doesn't know the name of ${bootloader}'s boot drive yet`
      : `keyloom has no flash recipe for ${bootloader} yet`);
  const instructions = [bootInstructions, how ?? "Put the board in its bootloader with its own reset method (QMK's flashing guide, docs/flashing.md, lists the tool for each bootloader), then write the built file with that tool."]
    .filter((s): s is string => s !== undefined)
    .join(" ");
  return { artifact, manualReason: reason, flash: { kind: "manual", instructions } };
}

// Boot drive names, read from the bootloaders' sources: Adafruit_nRF52_Bootloader@c67f0bc src/boards/<board>/board.h UF2_VOLUME_LABEL.
// A controller not listed here is refused rather than given a guessed name, since a wrong name makes the flash wait forever.
const ZMK_VOLUMES: Record<string, string> = {
  "nice_nano//zmk": "NICENANO",
  "bluemicro840//zmk": "BLUEMICRO",
  "nrfmicro/nrf52840/zmk": "NRFMICRO",
  "nrfmicro/nrf52840/flipped_zmk": "NRFMICRO",
  "nrfmicro/nrf52833/zmk": "NRFMICRO",
  "rpi_pico//zmk": RP2040_VOLUME,
  "rp2040_zero//zmk": RP2040_VOLUME,
  "xiao_rp2040//zmk": RP2040_VOLUME,
  "sparkfun_pro_micro_rp2040//zmk": RP2040_VOLUME,
};

export const zmkControllersWithBootDrive = (): string[] => Object.keys(ZMK_VOLUMES);
export const zmkBootVolume = (controller: string): string | undefined => ZMK_VOLUMES[controller];

/** The build-target id for a shield's half: `corne_left` is `left`. A single board keeps its own id. */
export const targetId = (sibling: string): string => /_(left|right|central|peripheral|lh|rh)$/.exec(sibling)?.[1]?.replace(/^lh$/, "left").replace(/^rh$/, "right") ?? sibling.replace(/[^a-z0-9-]/g, "-");

const HALF_WORDS: Record<string, string> = { left: "left half", right: "right half", central: "central half", peripheral: "peripheral half" };

/** One UF2 step per build target; "double-tap reset" is the nice!nano and Adafruit-bootloader way in, and RP2040 boards boot to the drive with BOOTSEL. */
export function zmkFlash(controller: string, siblings: readonly string[]): FlashRecipe | undefined {
  const volume = zmkBootVolume(controller);
  if (volume === undefined) return undefined;
  const enter = volume === RP2040_VOLUME ? "hold BOOTSEL while plugging in the USB cable" : "double-tap its reset button";
  const steps: FlashStep[] = siblings.map((s) => {
    const id = targetId(s);
    const label = siblings.length === 1 ? "keyboard" : (HALF_WORDS[id] ?? id);
    return { volume, label, target: id, enter: siblings.length === 1 ? `Plug it in and ${enter}.` : `Plug in the ${label} and ${enter}.` };
  });
  return { kind: "uf2-drives", steps };
}
