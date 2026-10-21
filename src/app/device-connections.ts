import { deviceBackend } from "../firmware/toolchain/device-helper/selection.ts";
import { shutdownCandidateHid } from "../firmware/toolchain/device-helper/owner.ts";

/** Drain every consumer before closing the shared helper; neither a rejected drain nor close may hide the other. */
export async function drainDeviceConsumers(
  drains: readonly Promise<unknown>[],
  close: () => Promise<void>,
): Promise<void> {
  const settled = await Promise.allSettled(drains);
  const failures = settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  try {
    await close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "device consumers or helper cleanup failed");
}

/** App/CLI lifecycle boundary. Legacy builds own no helper; a candidate must observe cleanup. */
export async function shutdownDeviceConnections(): Promise<void> {
  if (deviceBackend() === "native-hid") await shutdownCandidateHid();
}
