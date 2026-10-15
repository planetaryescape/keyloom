/** The build did not produce a usable binary; `message` is fit to show a person. */
export class BuildFailure extends Error {
  override name = "BuildFailure";
}
