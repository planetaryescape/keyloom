export class StreamLineError extends Error {
  override name = "StreamLineError";
}

export type StreamLinesResult = { lines: string[]; error?: StreamLineError };

/** Decodes bounded UTF-8 serial input into newline-terminated protocol lines. */
export class StreamLines {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";
  private lineBytes = 0;

  push(bytes: Uint8Array): StreamLinesResult {
    const lines: string[] = [];
    let segmentStart = 0;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== 0x0a) {
        if (++this.lineBytes > 4096) return { lines, error: new StreamLineError("serial line exceeds 4096 UTF-8 bytes") };
        continue;
      }

      const decoded = this.decode(bytes.subarray(segmentStart, i + 1));
      if (decoded instanceof StreamLineError) return { lines, error: decoded };
      lines.push(`${this.pending}${decoded.slice(0, -1)}`);
      this.pending = "";
      this.lineBytes = 0;
      segmentStart = i + 1;
    }

    if (segmentStart < bytes.length) {
      const decoded = this.decode(bytes.subarray(segmentStart));
      if (decoded instanceof StreamLineError) return { lines, error: decoded };
      this.pending += decoded;
    }
    return { lines };
  }

  private decode(bytes: Uint8Array): string | StreamLineError {
    try {
      return this.decoder.decode(bytes, { stream: true });
    } catch {
      return new StreamLineError("serial stream contains invalid UTF-8");
    }
  }

  finish(): void {
    let final: string;
    try {
      final = this.decoder.decode();
    } catch {
      throw new StreamLineError("serial stream ended with incomplete UTF-8");
    }
    if (final !== "" || this.pending !== "") throw new StreamLineError("serial stream ended with an incomplete line");
  }
}
