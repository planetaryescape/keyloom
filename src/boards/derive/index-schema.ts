// The shape of the generated keyboard index (scripts/gen-keyboard-index.ts): what keyloom knows about the QMK keyboards and ZMK
// boards and shields in two pinned upstream trees, enough to name a keyboard from its USB identity and to find its layout.
import { z } from "zod";

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const usbId = z.string().regex(/^0x[0-9a-f]{4}$/);
const source = z.strictObject({ repo: z.string().url(), sha });

export const QmkEntrySchema = z.strictObject({
  /** The folder under `keyboards/`, which is also the `qmk compile -kb` name. */
  target: z.string().min(1),
  /** `keyboard_name`: the USB product string the firmware reports. */
  name: z.string().min(1),
  maker: z.string().optional(),
  vid: usbId,
  pid: usbId,
  /** bcdDevice, from `usb.device_version`. */
  bcd: usbId.optional(),
  bootloader: z.string().optional(),
  /** `processor`, else the development board's: `atmega32u4`, `STM32F303`, `RP2040`. */
  processor: z.string().optional(),
  bootInstructions: z.string().optional(),
  split: z.boolean(),
  /** Layout macro to its key count. */
  layouts: z.record(z.string(), z.number().int().positive()),
  /** `LAYOUT` to the layout it names, where the macro has a more specific name. */
  aliases: z.record(z.string(), z.string()).optional(),
});
export type QmkEntry = z.infer<typeof QmkEntrySchema>;

export const ZmkEntrySchema = z.strictObject({
  /** The metadata `id`: `corne`. */
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["shield", "board"]),
  /** The build targets of a split shield (`corne_left`, `corne_right`); one id for a single board. */
  siblings: z.array(z.string().min(1)).min(1),
  /** The interconnect a shield needs a controller to provide (`pro_micro`). */
  requires: z.array(z.string()).optional(),
  /** The product string each build target reports, where the tree sets one. A split shield names its central half only. */
  productNames: z.record(z.string(), z.string()).optional(),
  vid: usbId.optional(),
  pid: usbId.optional(),
  /** The shield's physical layout: the file, the node's label inside it, and the number of keys. */
  layout: z.strictObject({ file: z.string().min(1), label: z.string().min(1), keys: z.number().int().positive() }).optional(),
  features: z.array(z.string()).optional(),
});
export type ZmkEntry = z.infer<typeof ZmkEntrySchema>;

export const ZmkControllerSchema = z.strictObject({
  /** The `west build -b` name, such as `nice_nano//zmk`. */
  id: z.string().min(1),
  name: z.string().min(1),
  exposes: z.array(z.string()),
});
export type ZmkController = z.infer<typeof ZmkControllerSchema>;

export const KeyboardIndexSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sources: z.strictObject({ qmk: source, zmk: source }),
  qmk: z.array(QmkEntrySchema),
  zmk: z.array(ZmkEntrySchema),
  controllers: z.array(ZmkControllerSchema),
});
export type KeyboardIndex = z.infer<typeof KeyboardIndexSchema>;
