// Which USB devices are plugged in, from macOS's system_profiler. Used to pick the Moonlander
// revision (05): rev A and rev B differ in USB product ID.
import { capture, which } from "./run.ts";

export type UsbDevice = {
  /** `0x1969`, lower case. */
  productId: string;
  vendorId: string;
  name: string;
  /** The `manufacturer` system_profiler reports, or empty when it reports none. */
  maker: string;
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
      found.push({
        productId,
        vendorId: hex(o.vendor_id ?? o.USBDeviceKeyVendorID) ?? "",
        name: typeof o._name === "string" ? o._name : "",
        maker: typeof maker === "string" ? maker : "",
      });
    }
    walk(o._items);
    walk(o.SPUSBDataType);
    walk(o.SPUSBHostDataType);
  };
  walk(json);
  return found;
}

export async function listUsbDevices(): Promise<UsbDevice[]> {
  if (process.platform !== "darwin" || !which("system_profiler")) return [];
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
