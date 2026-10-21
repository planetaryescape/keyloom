import pkg from "../../../../package.json" with { type: "json" };
import { extractHelper, manifestSchema, type HelperManifest } from "./extract.ts";
import { HelperFailure } from "./errors.ts";
import { packagedHelper } from "./packaged.ts";
import { DeviceTransportClient } from "./transport-client.ts";
import { HelperSetupFailure } from "./setup-failure.ts";
import type { Capability } from "./transport-protocol.ts";

/** Available for explicit adoption wiring after S59. Diagnostics-only pairs refuse unsupported. */
export function extractForSetup(bytes: Uint8Array, manifest: HelperManifest, release: string): ReturnType<typeof extractHelper> {
  try {
    return extractHelper(bytes, manifest, release);
  } catch (error) {
    const original = error instanceof Error ? error : new Error("helper extraction failed with a non-Error value", { cause: error });
    throw new HelperSetupFailure(original, "no_child");
  }
}

export async function ownClient<T>(client: { shutdown(): Promise<void> }, makeTransport: () => T): Promise<{ transport: T; shutdown(): Promise<void> }> {
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

export async function packagedTransport<T>(capabilities: readonly Capability[], makeTransport: (client: DeviceTransportClient) => T, notBundled: () => Error): Promise<{ transport: T; shutdown(): Promise<void> }> {
  const pair = packagedHelper;
  if (!pair) throw new HelperSetupFailure(notBundled(), "no_child");
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
    client = await DeviceTransportClient.connect(extracted.path, extracted.manifest, undefined, capabilities);
  } catch (error) {
    if (error instanceof HelperSetupFailure) throw error;
    // The launcher may have acquired a child before an unexpected construction failure.
    const original = error instanceof Error ? error : new Error("helper launch failed with a non-Error value", { cause: error });
    throw new HelperSetupFailure(original, "unconfirmed");
  }

  return ownClient(client, () => makeTransport(client));
}
