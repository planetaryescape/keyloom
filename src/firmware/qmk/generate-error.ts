/** The layout can't be written as QMK source. The message names the layer and position so it can be shown as is. */
export class GenerateError extends Error {
  override name = "GenerateError";
}
