import { SerialError, type SerialTransport } from "../serial.ts";
import type { DeviceTransportClient } from "./transport-client.ts";
import { packagedTransport } from "./setup.ts";
import { SERIAL_CAPABILITIES, serialDevicesSchema, serialWrittenSchema, touchedSchema } from "./transport-protocol.ts";

/** `path` carries an opaque helper reference, never a native path or a caller-parsed identity. */
export function helperSerialTransport(client: DeviceTransportClient): SerialTransport {
  return {
    async list() {
      const { devices } = await client.list("serial", serialDevicesSchema, 5_000);
      return devices.map((device) => ({ vendorId: device.vendorId, productId: device.productId, path: device.deviceRef, ...(device.serial === undefined ? {} : { serial: device.serial }), ...(device.permissionDenied ? { permissionDenied: true as const } : {}) }));
    },
    async touch(path, baud) { await client.request("serial.touch", { deviceRef: path, baud }, touchedSchema, 3_500); },
    async open(path, onData, onError = () => {}) {
      const sessionId = await client.open(path, onData, onError, "serial");
      let close: Promise<void> | undefined;
      let writes = Promise.resolve();
      return {
        write(text) {
          if (close) return Promise.reject(new SerialError("the keyboard connection is closing"));
          const bytes = new TextEncoder().encode(text);
          const write = writes.then(async () => {
            for (let offset = 0; offset < bytes.length; offset += 4096) {
              const chunk = bytes.subarray(offset, offset + 4096);
              await client.request("session.write", { sessionId, bytes: Buffer.from(chunk).toString("base64") }, serialWrittenSchema.refine((result) => result.acceptedBytes === chunk.length), 500);
            }
          });
          // A rejected write stays rejected; an uncertain effect never admits a later queued write.
          writes = write;
          return write;
        },
        close() { close ??= writes.catch(() => {}).then(() => client.close(sessionId)); return close; },
      };
    },
  };
}
export const packagedSerialTransport = () => packagedTransport(SERIAL_CAPABILITIES, helperSerialTransport, () => new SerialError("the installed keyboard connection is not bundled"));
