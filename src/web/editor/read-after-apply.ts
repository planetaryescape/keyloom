/**
 * A change the server wrote is applied whether or not the page can read the new layout back (R6-03). This reads it, and on a failed
 * read hands the error to `notShown` instead of throwing, so no caller reports a written change as not applied, or offers to apply it
 * again on a stale page. Resolves true once the new layout is on screen.
 */
export async function readAfterApply(read: () => Promise<void>, notShown: (error: unknown) => void): Promise<boolean> {
  try {
    await read();
    return true;
  } catch (error) {
    notShown(error);
    return false;
  }
}

/** Update layout: nothing was written when nothing changed, so there is nothing to read back and nothing to call applied. */
export async function readIfChanged(changed: boolean, read: () => Promise<void>, notShown: (error: unknown) => void): Promise<boolean> {
  return changed ? readAfterApply(read, notShown) : true;
}
