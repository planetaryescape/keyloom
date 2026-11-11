// What follows an Apply that the server accepted (R5-08): refreshing the board, lighting the changed keys. A failure there is the page's,
// not the Apply's, so it never reaches the card as "Apply failed"; `notShown` says the change is applied and offers to show it.

/** Runs `followUp` and reports its failure to `notShown`; resolves true when the new layout is on screen. Never rejects. */
export async function followApply(followUp: () => Promise<void>, notShown: (error: unknown) => void): Promise<boolean> {
  try {
    await followUp();
    return true;
  } catch (error) {
    notShown(error);
    return false;
  }
}
