import { CaptureError } from "./trace.ts";

// Leave the helper's 500 ms write / 1 s close deadlines time to report their own error;
// capture still has a backstop when a transport never settles (D-446).
export const CAPTURE_WRITE_TIMEOUT_MS = 750;
export const CAPTURE_CLOSE_TIMEOUT_MS = 1250;

/** Bounds the wait, without replaying or claiming to cancel a transport operation. */
export async function captureDeadline(operation: () => void | Promise<void>, label: string, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CaptureError(`typing capture ${label} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
