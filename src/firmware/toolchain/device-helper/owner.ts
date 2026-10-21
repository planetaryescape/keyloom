import { HidError, type HidTransport } from "../hid.ts";
import { HelperCleanupUnconfirmedError, HelperSetupFailure } from "./setup-failure.ts";
import { SerialError, type SerialTransport } from "../serial.ts";
import { packagedSerialTransport } from "./serial.ts";
import { deviceBackend } from "./selection.ts";
import { packagedHidTransport } from "./hid.ts";

type Owned<T> = { transport: T; shutdown(): Promise<void> };
/** One explicitly selected parent lifetime. Failed setup and cleanup never create a replacement child. */
export class CandidateDeviceOwner<T = HidTransport> {
  private owned: Promise<Owned<T>> | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly connect: () => Promise<Owned<T>>, private readonly stoppedError: () => Error = () => new HidError("the keyboard connection has shut down; start a new command")) {}
  async transport(): Promise<T> {
    if (this.closing) throw this.stoppedError();
    this.owned ??= Promise.resolve().then(this.connect);
    try {
      return (await this.owned).transport;
    } catch (error) {
      if (error instanceof HelperSetupFailure) throw error.original;
      throw error;
    }
  }
  shutdown(): Promise<void> {
    this.closing ??= (async () => {
      if (!this.owned) return;
      let owned: Owned<T>;
      try {
        owned = await this.owned;
      } catch (error) {
        if (error instanceof HelperSetupFailure && error.ownership !== "unconfirmed") return;
        throw new HelperCleanupUnconfirmedError();
      }
      await owned.shutdown();
    })();
    return this.closing;
  }
}
export { CandidateDeviceOwner as CandidateHidOwner };
// Only the statically selected backend can acquire a child in this process.
const parent = deviceBackend() === "native-serial"
  ? { backend: "native-serial" as const, owner: new CandidateDeviceOwner(packagedSerialTransport, () => new SerialError("the keyboard connection has shut down; start a new command")) }
  : { backend: "native-hid" as const, owner: new CandidateDeviceOwner(packagedHidTransport) };
export const candidateHidTransport = (): Promise<HidTransport> => {
  if (deviceBackend() !== "native-hid" || parent.backend !== "native-hid") return Promise.reject(new HidError("the native HID candidate is not selected"));
  return parent.owner.transport();
};
export const candidateSerialTransport = (): Promise<SerialTransport> => {
  if (deviceBackend() !== "native-serial" || parent.backend !== "native-serial") return Promise.reject(new SerialError("the native serial candidate is not selected"));
  return parent.owner.transport();
};
export const shutdownCandidateDevice = (): Promise<void> => parent.owner.shutdown();
export const shutdownCandidateHid = shutdownCandidateDevice;
