// Raw HID, the way keyloom talks to a running keyboard (D-071): find the interface QMK exposes for
// host software (usage page 0xFF60, usage 0x61) and write one report to it. Each platform's code is
// in its own file; callers take a HidTransport so tests never touch a keyboard.
/** QMK's raw HID endpoint: the usage page and usage its report descriptor declares, and the size of its reports (no report ID). */
export const RAW_HID_USAGE_PAGE = 0xff60;
export const RAW_HID_USAGE = 0x61;
export const RAW_HID_REPORT_SIZE = 32;

export type RawHidInterface = {
  vendorId: number;
  productId: number;
  /** The USB serial number the device reports, which lets the right keyboard be picked when two are attached. */
  serial?: string;
  /** Read-only Linux access check; a later open is still authoritative. */
  permissionDenied?: true;
  /** Windows found the USB device but its in-box driver supplied no usable interface. */
  driverMissing?: true;
  /** What the platform needs to open it again: a registry entry ID on macOS, a /dev/hidrawN path on Linux. */
  handle: string;
};

/** A raw HID interface held open: reports from the keyboard arrive in the callback given to openSession, and write() sends to it. */
export type HidSession = {
  write(report: Uint8Array): void | Promise<void>;
  close(): void | Promise<void>;
};

export type HidTransport = {
  /** Every raw-HID interface attached, for any vendor. Windows reads HID caps through a metadata-only handle; no streaming handle is opened. */
  list(): Promise<RawHidInterface[]>;
  /** Sends one output report (no report ID). Opens the device for as long as the write takes. */
  write(target: RawHidInterface, report: Uint8Array): Promise<void>;
  /**
   * Keeps the interface open to read the reports the keyboard sends (the typing lab's key stream, D-281). Only the lab uses it;
   * absent where keyloom cannot read raw HID.
   */
  openSession?(target: RawHidInterface, onReport: (report: Uint8Array) => void, onError?: (error: Error) => void): Promise<HidSession>;
};

export class HidError extends Error {
  override name = "HidError";
}

export const isRawHidUsage = (usagePage: number, usage: number): boolean => usagePage === RAW_HID_USAGE_PAGE && usage === RAW_HID_USAGE;
