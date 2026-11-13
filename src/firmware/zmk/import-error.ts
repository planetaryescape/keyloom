export class ZmkImportError extends Error {
  override name = "ZmkImportError";
}

/**
 * A keymap whose layers don't have the board's number of keys (R11-09). `found` is that layer's count, so the caller can name a board
 * that fits, such as the foostan Corne for a 42-key keymap dropped on the Keebart Corne's card.
 */
export class ZmkKeyCountError extends ZmkImportError {
  override name = "ZmkKeyCountError";
  constructor(readonly found: number, message: string) {
    super(message);
  }
}
