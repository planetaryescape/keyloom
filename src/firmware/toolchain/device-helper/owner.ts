import { HidError, type HidTransport } from "../hid.ts";
import { packagedHidTransport } from "./hid.ts";

type OwnedHid = { transport: HidTransport; shutdown(): Promise<void> };
/** One explicitly selected parent lifetime. Failed setup and cleanup never create a replacement child. */
export class CandidateHidOwner {
  private owned: Promise<OwnedHid> | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly connect: () => Promise<OwnedHid>) {}
  async transport(): Promise<HidTransport> {
    if (this.closing) throw new HidError("the keyboard connection has shut down; start a new command");
    this.owned ??= Promise.resolve().then(this.connect);
    return (await this.owned).transport;
  }
  shutdown(): Promise<void> {
    this.closing ??= (async () => { if (this.owned) await (await this.owned).shutdown(); })();
    return this.closing;
  }
}
const parent = new CandidateHidOwner(packagedHidTransport);
export const candidateHidTransport = (): Promise<HidTransport> => parent.transport();
export const shutdownCandidateHid = (): Promise<void> => parent.shutdown();
