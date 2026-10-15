// The build and flash recipes a board.json can name (04). Each recipe is a strict object, so a
// misspelled or unknown field in a contributed board.json fails `boards check` instead of being ignored.
// The firmware modules read their recipe through these types; none of them re-declares a field.
import { z } from "zod";

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const imageDigest = z.string().regex(/@sha256:[0-9a-f]{64}$/, "must be pinned by sha256 digest");

// --- builds ---------------------------------------------------------------------------------

export const QmkDockerBuildSchema = z.strictObject({
  kind: z.literal("qmk-docker"),
  /** The QMK CLI image, pinned by digest so a build can't change under us (S5). */
  image: imageDigest,
  /** The `LAYOUT_*` macro keymaps[] is written with. Geometry is read from the layout of the same name. */
  layoutMacro: z.string().min(1),
  /** Where `<name>/keymap.c` goes, relative to the checkout. */
  keymapsDir: z.string().min(1),
  /** Submodules the build needs; the others are skipped to keep the checkout small (S5). */
  submodules: z.array(z.string().min(1)),
  /** Written to keymap.json when the layout carries none of its own. */
  modules: z.array(z.string().min(1)).optional(),
  /** The JSON file with `layouts`, when it isn't `keyboards/<qmkTarget>/keyboard.json` (mainline QMK keeps it in the parent folder's info.json). */
  layoutFile: z.string().min(1).optional(),
  /** What `make` produces: `bin` (STM32, default), `hex` (AVR) or `uf2` (RP2040). */
  artifact: z.enum(["bin", "hex", "uf2"]).optional(),
});
export type QmkDockerBuild = z.infer<typeof QmkDockerBuildSchema>;

export const ZmkMoergoTemplateBuildSchema = z.strictObject({
  kind: z.literal("zmk-moergo-template"),
  /** MoErgo's config template; its Dockerfile route is what keyloom builds with (D-036). */
  template: z.strictObject({ repo: z.string().url(), sha }),
  /** The file in the firmware tree that holds the `zmk,physical-layout`; geometry.json is generated from it. */
  physicalLayout: z.string().min(1),
});
export type ZmkMoergoTemplateBuild = z.infer<typeof ZmkMoergoTemplateBuildSchema>;

export const ZmkWestTargetSchema = z.strictObject({
  /** Names the target's UF2 in the build, and the flash step that writes it. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** The `-DSHIELD` value, such as `corne_left`. */
  shield: z.string().min(1),
});

export const ZmkWestDockerBuildSchema = z.strictObject({
  kind: z.literal("zmk-west-docker"),
  /** ZMK's build image (`zmkfirmware/zmk-build-arm`), pinned by digest. */
  image: imageDigest,
  /** The `west build -b` board, such as `nice_nano_v2`. */
  board: z.string().min(1),
  /** Base name of the user config files, `config/<keymapName>.keymap` and `.conf` (the shield name without `_left`/`_right`). */
  keymapName: z.string().regex(/^[a-z0-9_-]+$/),
  /** The file in the firmware tree that holds the `zmk,physical-layout`; geometry.json is generated from it. */
  physicalLayout: z.string().min(1),
  /** One west build each, in the order given. */
  targets: z.array(ZmkWestTargetSchema).min(1),
});
export type ZmkWestDockerBuild = z.infer<typeof ZmkWestDockerBuildSchema>;

export const BuildRecipeSchema = z.discriminatedUnion("kind", [QmkDockerBuildSchema, ZmkMoergoTemplateBuildSchema, ZmkWestDockerBuildSchema]);
export type BuildRecipe = z.infer<typeof BuildRecipeSchema>;

// --- flashes --------------------------------------------------------------------------------

export const ZappFlashSchema = z.strictObject({
  kind: z.literal("zapp"),
  /** USB `VID:PID` of the bootloader this revision's binary is built for (S11). */
  bootloader: z.string().regex(/^[0-9a-f]{4}:[0-9a-f]{4}$/),
});
export type ZappFlash = z.infer<typeof ZappFlashSchema>;

export const FlashStepSchema = z.strictObject({
  /** The boot drive's volume label, such as `NICENANO`. */
  volume: z.string().min(1),
  /** What the person calls this part, such as `left half`. */
  label: z.string().min(1),
  /** How to put it into its bootloader; shown while keyloom waits for the drive. */
  enter: z.string().min(1),
  /** Which build target's UF2 this step writes (`zmk-west-docker`). Leave out when the build makes one UF2 for every step. */
  target: z.string().min(1).optional(),
});
export type FlashStep = z.infer<typeof FlashStepSchema>;

const usbId = z.string().regex(/^0x[0-9a-f]{4}$/i);

/** One half of a split board, as keyloom's ZMK module knows it (firmware/zmk/keyloom-zmk, D-095). */
export const HandsFreeHalfSchema = z.strictObject({
  /** The central half owns the keymap and the host link; a peripheral is reached over the split link. */
  role: z.enum(["central", "peripheral"]),
  /** The `label` of the flash step that writes this half. Halves that mount under one volume name (the Corne's) are told apart by this and by the serial marker. */
  step: z.string().min(1),
  /** The letter after the build ID in this half's USB serial number: the central is `L`, a peripheral `R`. */
  marker: z.enum(["L", "R"]),
  /** The half's USB product ID while it runs, when known; without it any keyloom marker with this letter is taken to be the half. */
  usbProductId: usbId.optional(),
  /** The central can restart this half over the split link when the half has no serial port of its own (first keyloom flash of a half whose cable is plugged in). */
  relay: z.boolean().optional(),
});
export type HandsFreeHalf = z.infer<typeof HandsFreeHalfSchema>;

export const HandsFreeSchema = z
  .strictObject({
    /** A close at 1200 baud on a half's USB serial port restarts that half into its UF2 bootloader. */
    trigger: z.literal("cdc-1200"),
    /** The board's USB vendor ID while it runs, when known. */
    usbVendorId: usbId.optional(),
    halves: z.array(HandsFreeHalfSchema).min(1),
    /**
     * How the build marker gets into the USB serial number. `usb-sn-template`: the board has its own function that fills
     * the end of CONFIG_USB_DEVICE_SN with the chip ID (the Glove80), so keyloom writes one template per half.
     * `usb-sn-override`: the module provides that function and picks the half's letter itself.
     */
    serialMarker: z.enum(["usb-sn-template", "usb-sn-override"]),
    /** What follows `keyloom/<12>-<L|R>` in the template. It must end in the 16 characters the chip ID replaces. */
    serialTail: z.string().regex(/^:.*[0-9A-F]{16}$/),
  })
  .refine((h) => h.halves.filter((x) => x.role === "central").length === 1, { message: "exactly one half must be the central" })
  .refine((h) => new Set(h.halves.map((x) => x.marker)).size === h.halves.length, { message: "each half needs its own marker letter" })
  .refine((h) => h.halves.every((x) => x.role === "peripheral" || x.relay !== true), { message: "only a peripheral can be relayed to" });
export type HandsFree = z.infer<typeof HandsFreeSchema>;

export const Uf2DrivesFlashSchema = z
  .strictObject({
    kind: z.literal("uf2-drives"),
    /** In the order to flash: MoErgo says the right half first (D-038). */
    steps: z.array(FlashStepSchema).min(1),
    /** Present when the board's ZMK build carries keyloom's module, so a flash needs no keypress after the first one (D-095). */
    handsFree: HandsFreeSchema.optional(),
  })
  .refine((f) => f.handsFree === undefined || f.handsFree.halves.every((h) => f.steps.some((s) => s.label === h.step)), {
    message: "every handsFree half must name the label of a flash step",
    path: ["handsFree"],
  });
export type Uf2DrivesFlash = z.infer<typeof Uf2DrivesFlashSchema>;

export const ManualFlashSchema = z.strictObject({
  kind: z.literal("manual"),
  /** What to tell the person: which tool flashes the built file, and how to put the board in its bootloader. */
  instructions: z.string().min(1),
});
export type ManualFlash = z.infer<typeof ManualFlashSchema>;

export const FlashRecipeSchema = z.discriminatedUnion("kind", [ZappFlashSchema, Uf2DrivesFlashSchema, ManualFlashSchema]);
export type FlashRecipe = z.infer<typeof FlashRecipeSchema>;
