// Printing a reply as it streams, with its typed references written as names (D-468). A marker can arrive in two deltas, so an open
// `{` holds the text back until its `}` arrives, and a backtick that may still open a code span holds the same way; the hold is capped,
// and a brace or backtick that never closes goes out as the person would have typed it. A marker inside backticks stays as the model
// wrote it, because a code span is code. Pure, so the cases (a split marker, a split code span, a cap, an unclosed brace, a stray brace
// before a real marker) are tested without a model.
import { type Reference, markerAt } from "../app/index.ts";

/** How much text one ambiguous `{` or backtick may hold back. Past this it was never a marker or a code span, so it goes out as it came. */
export const HOLD_CAP = 64;

export class ReplyStream {
  private held = "";
  private readonly words: (reference: Reference) => string;

  /** `words` writes a marker as the name the terminal can print. */
  constructor(words: (reference: Reference) => string) {
    this.words = words;
  }

  /** Hands over a delta and returns the text that can be printed now. */
  push(delta: string): string {
    this.held += delta;
    return this.drain(false);
  }

  /** The rest of the reply, once no more deltas are coming. */
  flush(): string {
    return this.drain(true);
  }

  // Scans what is held: words go out, a closed marker goes out as its name, and a brace or backtick that may still become a marker or a
  // code span waits. `end` is the last of the reply, so anything still open is printed rather than kept for text that will never arrive.
  private drain(end: boolean): string {
    const text = this.held;
    let out = "";
    let plain = 0;
    let i = 0;
    while (i < text.length) {
      if (text[i] === "`") {
        const close = text.indexOf("`", i + 1);
        // A code span is code: what it holds is printed as typed, and never read as a marker. A span can be split across deltas, so one
        // whose closing backtick has not arrived yet is held, exactly as an open brace is.
        if (close > i + 1) i = close + 1;
        else if (!end && text.length - i < HOLD_CAP) break;
        else i += 1;
        continue;
      }
      if (text[i] !== "{") {
        i += 1;
        continue;
      }
      const marker = markerAt(text, i);
      if (marker !== null) {
        out += text.slice(plain, i) + this.words(marker.reference);
        i += marker.length;
        plain = i;
        continue;
      }
      // Not a marker. A marker never holds another `{`, so a brace with one after it is text — and so is a brace whose group already
      // closed. Advancing by one keeps a real marker that follows from being swallowed by a stray brace before it.
      if (text.indexOf("{", i + 1) >= 0 || text.indexOf("}", i + 1) >= 0) {
        i += 1;
        continue;
      }
      // Nothing after it can settle the question yet: hold, unless it has grown past the cap or the reply has ended.
      if (end || text.length - i >= HOLD_CAP) {
        i += 1;
        continue;
      }
      break;
    }
    out += text.slice(plain, i);
    this.held = text.slice(i);
    return out;
  }
}
