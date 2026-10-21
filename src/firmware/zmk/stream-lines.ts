export class StreamLineError extends Error {
  override name = "StreamLineError";
}

/** Decodes bounded UTF-8 serial input into newline-terminated protocol lines. */
export class StreamLines {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";
  private lineBytes = 0;

  push(bytes: Uint8Array): string[] {
    for (const byte of bytes) {
      if (byte === 0x0a) this.lineBytes = 0;
      else if (++this.lineBytes > 4096) throw new StreamLineError("serial line exceeds 4096 UTF-8 bytes");
    }

    let decoded: string;
    try {
      decoded = this.decoder.decode(bytes, { stream: true });
    } catch {
      throw new StreamLineError("serial stream contains invalid UTF-8");
    }

    const text = this.pending + decoded;
    const lastNewline = text.lastIndexOf("\n");
    const lines = lastNewline < 0 ? [] : text.slice(0, lastNewline).split("\n");
    this.pending = text.slice(lastNewline + 1);
    return lines;
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
