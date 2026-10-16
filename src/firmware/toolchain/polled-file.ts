// A device node read and written without blocking, polled every few milliseconds. Raw HID on Linux (/dev/hidrawN) and USB serial
// ports (/dev/cu.usbmodemN, /dev/ttyACMn) are both plain files to read from, and a non-blocking descriptor polled on a timer can be
// closed at any moment: a blocked read in a thread pool cannot be cancelled, and would keep a closed port busy. The same code reads a
// FIFO, which is how it is tested without a device.
import { closeSync, constants, openSync, readSync, writeSync } from "node:fs";

export type PolledFile = {
  /** Writes all of `bytes`, waiting briefly for a full buffer. Throws when the device refuses or has gone. */
  write(bytes: Uint8Array): void;
  close(): void;
};

export type PolledOptions = {
  /** The most one read returns. A raw HID read returns one report, so this is the report size. */
  chunkSize: number;
  pollMs?: number;
  /** The device went away or a read failed for another reason; polling has stopped. */
  onError?: (error: Error) => void;
};

const WRITE_PATIENCE_MS = 200;

export function openPolled(path: string, onData: (chunk: Uint8Array) => void, options: PolledOptions): PolledFile {
  // O_NOCTTY: a serial port opened by a terminal-less process must not become its controlling terminal.
  const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK | (constants.O_NOCTTY ?? 0));
  const buffer = Buffer.alloc(options.chunkSize);
  let closed = false;

  const poll = setInterval(() => {
    // Drain what is there now, but not forever: a stream that never pauses must still let the event loop run.
    for (let i = 0; i < 64 && !closed; i++) {
      let n: number;
      try {
        n = readSync(fd, buffer);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EAGAIN") return;
        stop();
        options.onError?.(err as Error);
        return;
      }
      if (n === 0) return;
      onData(Uint8Array.from(buffer.subarray(0, n)));
    }
  }, options.pollMs ?? 2);

  function stop(): void {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    closeSync(fd);
  }

  return {
    write(bytes) {
      if (closed) throw new Error(`${path} is closed`);
      let done = 0;
      const until = Date.now() + WRITE_PATIENCE_MS;
      while (done < bytes.length) {
        try {
          done += writeSync(fd, bytes, done);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EAGAIN" || Date.now() > until) throw err;
        }
      }
    },
    close: stop,
  };
}
