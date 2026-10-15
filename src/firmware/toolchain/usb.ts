// Which USB devices are plugged in, from macOS's system_profiler. Used to pick the Moonlander
// revision (05): rev A and rev B differ in USB product ID.
import { capture } from "./run.ts";

export type UsbDevice = {
  /** `0x1969`, lower case. */
  productId: string;
  vendorId: string;
  name: string;
  /** The `manufacturer` system_profiler reports, or empty when it reports none. */
  maker: string;
};

const hex = (v: unknown): string | undefined => (typeof v === "string" ? /0x[0-9a-f]{4}/i.exec(v)?.[0]?.toLowerCase() : undefined);

/** Walks `SPUSBDataType`; hubs nest their devices under `_items`. */
export function parseUsbDevices(json: unknown): UsbDevice[] {
  const found: UsbDevice[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object" || node === null) return;
    const o = node as Record<string, unknown>;
    const productId = hex(o.product_id);
    if (productId) {
      found.push({
        productId,
        vendorId: hex(o.vendor_id) ?? "",
        name: typeof o._name === "string" ? o._name : "",
        maker: typeof o.manufacturer === "string" ? o.manufacturer : "",
      });
    }
    walk(o._items);
    walk(o.SPUSBDataType);
  };
  walk(json);
  return found;
}

export async function listUsbDevices(): Promise<UsbDevice[]> {
  if (process.platform !== "darwin" || !Bun.which("system_profiler")) return [];
  const r = await capture(["system_profiler", "SPUSBDataType", "-json"], { timeoutMs: 20_000 });
  if (r.exitCode !== 0) return [];
  try {
    return parseUsbDevices(JSON.parse(r.stdout));
  } catch {
    return [];
  }
}
