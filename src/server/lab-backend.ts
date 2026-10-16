import type { LabPassagesResponse, LabReadoutResponse, LabSession, StartRecordingRequest } from "../api/lab.ts";

// The server's typing lab interface (rung 22, D-314). The CLI injects the app-backed implementation, which holds the one recording
// in progress and the keyboard behind it; the server knows nothing about USB or the emulator.
export interface LabBackend {
  passages(layoutRef: string): Promise<LabPassagesResponse>;
  sessions(layoutRef: string): Promise<LabSession[]>;
  start(layoutRef: string, request: StartRecordingRequest): Promise<{ passage: LabPassagesResponse["passages"][number]; startedAt: number }>;
  stop(typedText: string): Promise<LabSession>;
  cancel(): Promise<void>;
  readout(id: string): Promise<LabReadoutResponse>;
  analyse(id: string): Promise<LabReadoutResponse>;
  remove(id: string): Promise<void>;
}

export class LabError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LabError";
  }
}
