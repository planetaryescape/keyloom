export class ZmkImportError extends Error {
  override name = "ZmkImportError";
}

/**
 * A keymap whose layers all have one number of keys, and not the board's (R11-09). `found` is that number, the keymap's own, so the caller
 * can name a board that fits, such as the foostan Corne for a 42-key keymap dropped on the Keebart Corne's card. Layers that disagree are
 * a plain ZmkImportError: no board fits them.
 */
export class ZmkKeyCountError extends ZmkImportError {
  override name = "ZmkKeyCountError";
  constructor(readonly found: number, message: string) {
    super(message);
  }
}
