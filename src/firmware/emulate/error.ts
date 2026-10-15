/** An emulator couldn't produce a result: it couldn't build, crashed, or printed something it can't be read from. The message says what to do. */
export class EmulationError extends Error {
  override name = "EmulationError";
}
