// Which USB devices are plugged in, from macOS's system_profiler. Used to pick the Moonlander
// revision (05): rev A and rev B differ in USB product ID.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { capture, which } from "./run.ts";

export type UsbDevice = {
  /** `0x1969`, lower case. */
  productId: string;
  vendorId: string;
  name: string;
  /** The `manufacturer` system_profiler reports, or empty when it reports none. */
  maker: string;
  /** The USB serial number string, when the device has one. A keyloom build writes its build marker here (D-070). */
  serial?: string;
  /** The device version the descriptor reports (bcdDevice) as `0x0305`. QMK sets it from `device_version`, so it helps tell boards that share ids apart. */
  bcdDevice?: string;
};

/** macOS 26 reports `0x0305`; older macOS `3.05`; Linux's sysfs `0305`. All are the same four BCD digits. */
const bcd = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const digits = /^(?:0x)?([0-9a-f]{4})$/i.exec(v.trim())?.[1] ?? /^(\d{1,2})\.(\d{2})$/.exec(v.trim())?.slice(1).join("").padStart(4, "0");
  return digits === undefined ? undefined : `0x${digits.toLowerCase()}`;
};

const hex = (v: unknown): string | undefined => (typeof v === "string" ? /0x[0-9a-f]{4}/i.exec(v)?.[0]?.toLowerCase() : undefined);

/**
 * Walks either system_profiler USB report; hubs nest their devices under `_items`. macOS 26 and later
 * report `SPUSBHostDataType` with `USBDeviceKey*` fields (seen on Darwin 27, 2026-10-15); older
 * releases report `SPUSBDataType` with `product_id`, `vendor_id` and `manufacturer`.
 */
export function parseUsbDevices(json: unknown): UsbDevice[] {
  const found: UsbDevice[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object" || node === null) return;
    const o = node as Record<string, unknown>;
    const productId = hex(o.product_id ?? o.USBDeviceKeyProductID);
    if (productId) {
      const maker = o.manufacturer ?? o.USBDeviceKeyVendorName;
      const serial = o.serial_num ?? o.USBDeviceKeySerialNumber;
      const bcdDevice = bcd(o.bcd_device ?? o.USBDeviceKeyProductVersion);
      found.push({
        productId,
        vendorId: hex(o.vendor_id ?? o.USBDeviceKeyVendorID) ?? "",
        name: typeof o._name === "string" ? o._name : "",
        maker: typeof maker === "string" ? maker : "",
        ...(typeof serial === "string" && serial !== "" ? { serial } : {}),
        ...(bcdDevice ? { bcdDevice } : {}),
      });
    }
    walk(o._items);
    walk(o.SPUSBDataType);
    walk(o.SPUSBHostDataType);
  };
  walk(json);
  return found;
}

/** Linux: every device under `/sys/bus/usb/devices` that reports ids. `root` is a parameter so tests can use a fake tree. */
export function linuxUsbDevices(root = "/sys/bus/usb/devices"): UsbDevice[] {
  const read = (dir: string, name: string): string | undefined => {
    try {
      return readFileSync(join(dir, name), "utf8").trim();
    } catch {
      return undefined;
    }
  };
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const found: UsbDevice[] = [];
  for (const entry of entries) {
    const dir = join(root, entry);
    const vendor = read(dir, "idVendor");
    const product = read(dir, "idProduct");
    if (!vendor || !product) continue; // an interface (`1-2:1.0`) has no ids of its own
    const serial = read(dir, "serial");
    const bcdDevice = bcd(read(dir, "bcdDevice"));
    found.push({
      productId: `0x${product.toLowerCase()}`, vendorId: `0x${vendor.toLowerCase()}`, name: read(dir, "product") ?? "", maker: read(dir, "manufacturer") ?? "",
      ...(serial ? { serial } : {}), ...(bcdDevice ? { bcdDevice } : {}),
    });
  }
  return found;
}

export async function listUsbDevices(): Promise<UsbDevice[]> {
  if (process.platform === "win32") {
    const { windowsDevicesUnavailable } = await import("./platform-support.ts");
    if (windowsDevicesUnavailable()) return [];
    const { defaultHidTransport } = await import("./hid-default.ts");
    const { defaultSerialTransport } = await import("./serial-default.ts");
    const records = [...await (await defaultHidTransport()).list(), ...await (await defaultSerialTransport()).list()];
    const hex = (n: number) => `0x${n.toString(16).padStart(4, "0")}`;
    return records.filter((r) => !r.driverMissing).map((r) => ({ vendorId: hex(r.vendorId), productId: hex(r.productId), name: "USB keyboard", maker: "", ...(r.serial === undefined ? {} : { serial: r.serial }) }));
  }
  // system_profiler exists only on macOS, so finding it is the platform check; tests rely on that to
  // put a fake one on PATH on Linux CI. Without it, Linux reads sysfs.
  if (!which("system_profiler")) return process.platform === "linux" ? linuxUsbDevices() : [];
  // Newer macOS answers the old data type with an empty report rather than an error, so try the new
  // one first and fall back only when it finds nothing.
  for (const dataType of ["SPUSBHostDataType", "SPUSBDataType"]) {
    const r = await capture(["system_profiler", dataType, "-json"], { timeoutMs: 20_000 });
    if (r.exitCode !== 0) continue;
    try {
      const devices = parseUsbDevices(JSON.parse(r.stdout));
      if (devices.length > 0) return devices;
    } catch {
      // Unparseable output means this data type isn't usable here; try the next one.
    }
  }
  return [];
}
