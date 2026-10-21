import { deviceBackend } from "../firmware/toolchain/device-helper/selection.ts";
import { shutdownCandidateHid } from "../firmware/toolchain/device-helper/owner.ts";

/** App/CLI lifecycle boundary. Legacy builds own no helper; a candidate must observe cleanup. */
export async function shutdownDeviceConnections(): Promise<void> {
  if (deviceBackend() === "native-hid") await shutdownCandidateHid();
}
