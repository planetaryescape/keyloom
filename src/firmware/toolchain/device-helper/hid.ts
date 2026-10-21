import pkg from "../../../../package.json" with { type: "json" };
import { HidError, type HidTransport, type RawHidInterface } from "../hid.ts";
import { extractHelper, manifestSchema, type HelperManifest } from "./extract.ts";
import { HelperFailure } from "./errors.ts";
import { packagedHelper } from "./packaged.ts";
import { DeviceTransportClient } from "./transport-client.ts";
import { HelperSetupFailure } from "./setup-failure.ts";
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
export function extractForSetup(bytes: Uint8Array, manifest: HelperManifest, release: string): ReturnType<typeof extractHelper> {
  try {
    return extractHelper(bytes, manifest, release);
  } catch (error) {
    const original = error instanceof Error ? error : new Error("helper extraction failed with a non-Error value", { cause: error });
    throw new HelperSetupFailure(original, "no_child");
  }
}

export async function ownHidClient(client: { shutdown(): Promise<void> }, makeTransport: () => HidTransport): Promise<{ transport: HidTransport; shutdown(): Promise<void> }> {
  try {
    return { transport: makeTransport(), shutdown: () => client.shutdown() };
  } catch (error) {
    try {
      await client.shutdown();
    } catch (cleanupFailure) {
      const original = error instanceof Error ? error : new Error("helper adapter setup failed with a non-Error value", { cause: error });
      const cleanup = cleanupFailure instanceof Error ? cleanupFailure : new Error("helper teardown failed with a non-Error value", { cause: cleanupFailure });
      throw new HelperSetupFailure(original, "unconfirmed", cleanup);
    }
    const original = error instanceof Error ? error : new Error("helper adapter setup failed with a non-Error value", { cause: error });
    throw new HelperSetupFailure(original, "terminated");
  }
}

export async function packagedHidTransport(): Promise<{ transport: HidTransport; shutdown(): Promise<void> }> {
  const pair = packagedHelper;
  if (!pair) throw new HelperSetupFailure(new HidError("the installed keyboard connection is not bundled"), "no_child");
  let bytes: Uint8Array;
  try {
    bytes = await Bun.file(pair.asset).bytes();
  } catch (error) {
    const original = error instanceof Error ? error : new Error("packaged helper read failed with a non-Error value", { cause: error });
    throw new HelperSetupFailure(original, "no_child");
  }
  const parsed = manifestSchema.safeParse(pair.manifest);
  if (!parsed.success) throw new HelperSetupFailure(new HelperFailure("version_mismatch"), "no_child");
  const extracted = extractForSetup(bytes, parsed.data, pkg.version);

  let client: DeviceTransportClient;
  try {
    client = await DeviceTransportClient.connect(extracted.path, extracted.manifest);
  } catch (error) {
    if (error instanceof HelperSetupFailure) throw error;
    // The launcher may have acquired a child before an unexpected construction failure.
    const original = error instanceof Error ? error : new Error("helper launch failed with a non-Error value", { cause: error });
    throw new HelperSetupFailure(original, "unconfirmed");
  }

  return ownHidClient(client, () => helperHidTransport(client));
}
