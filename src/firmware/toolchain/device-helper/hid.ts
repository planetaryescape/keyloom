import pkg from "../../../../package.json" with { type: "json" };
import { HidError, type HidTransport, type RawHidInterface } from "../hid.ts";
import { extractHelper } from "./extract.ts";
import { packagedHelper } from "./packaged.ts";
import { DeviceTransportClient } from "./transport-client.ts";
import { hidDevicesSchema, writtenSchema } from "./transport-protocol.ts";

function encoded(report: Uint8Array): string {
  if (report.length !== 32) throw new HidError("raw HID requires exactly 32 payload bytes");
  return Buffer.from(report).toString("base64");
}
/** Explicit adapter injection, never an automatic fallback/default switch. References expire with this client. */
export function helperHidTransport(client: DeviceTransportClient): HidTransport {
  const targets = new WeakSet<RawHidInterface>();
  const reference = (target: RawHidInterface) => {
    if (!targets.has(target)) throw new HidError("rediscover this keyboard before connecting");
    return target.handle;
  };
  return {
    async list() {
      const { devices } = await client.request("list", { transport: "hid" }, hidDevicesSchema, 5_000);
      return devices.map((device) => {
        const target: RawHidInterface = { vendorId: device.vendorId, productId: device.productId, handle: device.deviceRef, ...(device.serial === undefined ? {} : { serial: device.serial }) };
        targets.add(target); return target;
      });
    },
    async write(target, report) {
      await client.request("hid.write", { deviceRef: reference(target), reportId: 0, bytes: encoded(report) }, writtenSchema, 500);
    },
    async openSession(target, onReport, onError = () => {}) {
      const sessionId = await client.open(reference(target), onReport, onError);
      let close: Promise<void> | undefined;
      return {
        async write(report) {
          if (close) throw new HidError("the keyboard connection is closing");
          await client.request("session.write", { sessionId, reportId: 0, bytes: encoded(report) }, writtenSchema, 500);
        },
        close() { close ??= client.close(sessionId); return close; },
      };
    },
  };
}
/** Available for explicit adoption wiring after S59. Diagnostics-only pairs refuse unsupported. */
export async function packagedHidTransport(): Promise<{ transport: HidTransport; shutdown(): Promise<void> }> {
  const pair = packagedHelper;
  if (!pair) throw new HidError("the installed keyboard connection is not bundled");
  const extracted = extractHelper(await Bun.file(pair.asset).bytes(), pair.manifest, pkg.version);
  const client = await DeviceTransportClient.connect(extracted.path, extracted.manifest);
  return { transport: helperHidTransport(client), shutdown: () => client.shutdown() };
}
