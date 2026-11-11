import { HidError, type HidTransport } from "../hid.ts";
import { HelperCleanupUnconfirmedError, HelperSetupFailure, markLatchedSetup } from "./setup-failure.ts";
import { SerialError, type SerialTransport } from "../serial.ts";
import { helperSerialTransport, packagedSerialTransport } from "./serial.ts";
import { deviceBackend } from "./selection.ts";
import { helperHidTransport, packagedHidTransport } from "./hid.ts";
import { packagedTransport } from "./setup.ts";
import { NATIVE_CAPABILITIES } from "./transport-protocol.ts";

/** The first wait before a dead helper's next replacement; it doubles while each replacement dies too, up to the maximum. */
const REPLACE_BACKOFF_MS = 1_000;
const REPLACE_BACKOFF_MAX_MS = 30_000;

/** `dead` says the child's channel died (exited, broke the protocol, stopped answering), so it will never serve again. */
type Owned<T> = { transport: T; shutdown(): Promise<void>; dead?(): boolean };
/**
 * One explicitly selected parent lifetime. Failed setup and cleanup never create a replacement child. A child whose channel died after
 * setup is replaced on the next `transport()`, but only once its termination is observed (R4-03): nothing is replayed, sessions on the
 * dead child stay failed, and a termination that can't be confirmed latches like failed cleanup, so two children never own the device.
 * Replacements of children that keep dying back off, from 1 s doubling to 30 s, until a child is seen alive again.
 */
export class CandidateDeviceOwner<T = HidTransport> {
  private owned: Promise<Owned<T>> | undefined;
  private closing: Promise<void> | undefined;
  /** Replacements since a child was last seen alive, and when the next one may start. */
  private deaths = 0;
  private nextReplaceAt = 0;
  constructor(
    private readonly connect: () => Promise<Owned<T>>,
    private readonly stoppedError: () => Error = () => new HidError("the keyboard connection has shut down; start a new command"),
    private readonly now: () => number = Date.now,
  ) {}
  async transport(): Promise<T> {
    if (this.closing) throw this.stoppedError();
    const current = this.owned;
    if (current !== undefined) {
      // A setup failure stays latched: only a child that set up and then died is replaced.
      const settled = await current.catch(() => undefined);
      const dead = settled?.dead?.() === true;
      if (settled !== undefined && !dead) this.deaths = 0;
      // A helper that dies on every call would otherwise be respawned on each 5 s device poll (#290 review). Until the backoff ends
      // the dead child's transport is returned, and its calls fail as a lost connection that is worth another try.
      if (settled !== undefined && dead && this.owned === current && !this.closing && this.now() >= this.nextReplaceAt) {
        this.nextReplaceAt = this.now() + Math.min(REPLACE_BACKOFF_MS * 2 ** this.deaths, REPLACE_BACKOFF_MAX_MS);
        this.deaths++;
        this.owned = this.replace(settled);
      }
      if (this.closing) throw this.stoppedError();
    }
    this.owned ??= Promise.resolve().then(this.connect);
    try {
      return (await this.owned).transport;
    } catch (error) {
      if (error instanceof HelperSetupFailure) {
        markLatchedSetup(error.original);
        throw error.original;
      }
      throw error;
    }
  }
  private async replace(dead: Owned<T>): Promise<Owned<T>> {
    try {
      await dead.shutdown();
    } catch {
      // The dead child may still hold the device. Latched: shutdown() and every later transport() report it, and nothing starts.
      throw new HelperCleanupUnconfirmedError();
    }
    return this.connect();
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
// One paired client serves both adapters; the owner retains failed setup and cleanup receipts.
const parent = new CandidateDeviceOwner<{ hid: HidTransport | undefined; serial: SerialTransport | undefined }>(async () => {
  if (deviceBackend() === "native") return packagedTransport(NATIVE_CAPABILITIES,
    (client) => ({ hid: helperHidTransport(client), serial: helperSerialTransport(client) }),
    () => new HidError("the installed keyboard connection is not bundled"));
  if (deviceBackend() === "native-serial") {
    const owned = await packagedSerialTransport();
    return { ...owned, transport: { hid: undefined, serial: owned.transport } };
  }
  const owned = await packagedHidTransport();
  return { ...owned, transport: { hid: owned.transport, serial: undefined } };
});
export const candidateHidTransport = async (): Promise<HidTransport> => {
  if (deviceBackend() !== "native" && deviceBackend() !== "native-hid") throw new HidError("the native HID backend is not selected");
  const transport = (await parent.transport()).hid;
  if (!transport) throw new HidError("the native HID backend is not selected");
  return transport;
};
export const candidateSerialTransport = async (): Promise<SerialTransport> => {
  if (deviceBackend() !== "native" && deviceBackend() !== "native-serial") throw new SerialError("the native serial backend is not selected");
  const transport = (await parent.transport()).serial;
  if (!transport) throw new SerialError("the native serial backend is not selected");
  return transport;
};
export const shutdownCandidateDevice = (): Promise<void> => parent.shutdown();
export const shutdownCandidateHid = shutdownCandidateDevice;
