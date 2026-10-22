import { HidError, type HidTransport, type RawHidInterface } from "../hid.ts";
import { DeviceTransportClient } from "./transport-client.ts";
import { packagedTransport } from "./setup.ts";
import { HID_CAPABILITIES, hidDevicesSchema, writtenSchema } from "./transport-protocol.ts";
export { extractForSetup, ownClient as ownHidClient } from "./setup.ts";

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
      const { devices } = await client.list("hid", hidDevicesSchema, 5_000);
      return devices.map((device) => {
        const target: RawHidInterface = { vendorId: device.vendorId, productId: device.productId, handle: device.deviceRef, ...(device.serial === undefined ? {} : { serial: device.serial }), ...(device.driverMissing ? { driverMissing: true as const } : {}), ...(device.permissionDenied ? { permissionDenied: true as const } : {}) };
        targets.add(target); return target;
      });
    },
    async write(target, report) {
      // The one-shot helper request includes endpoint open and close around the write.
      await client.request("hid.write", { deviceRef: reference(target), reportId: 0, bytes: encoded(report) }, writtenSchema, 3_500);
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
export const packagedHidTransport = () => packagedTransport(HID_CAPABILITIES, helperHidTransport, () => new HidError("the installed keyboard connection is not bundled"));
