import type { AddRequest, AddResponse, DetectResponse, PreviewRequest, PreviewResponse, PutPreviewResponse, PutRequest, PutResponse } from "../api/keyboards.ts";

// The server's new-keyboard interface (22, D-336). Like the other backends, the CLI injects the app-backed implementation, so the server
// knows nothing about USB, the firmware trees or the database.
export interface KeyboardsBackend {
  /** The keyboards on USB keyloom has no board for; with `search`, index entries by name as well. */
  detect(search: string | null): Promise<DetectResponse>;
  preview(request: PreviewRequest): Promise<PreviewResponse>;
  add(request: AddRequest): Promise<AddResponse>;
  previewPut(request: PutRequest): Promise<PutPreviewResponse>;
  put(request: PutRequest): Promise<PutResponse>;
}

/** A failure the browser should see as-is. */
export class KeyboardsError extends Error {
  constructor(
    readonly status: 400 | 404,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KeyboardsError";
  }
}
