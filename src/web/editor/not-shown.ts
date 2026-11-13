/**
 * "Applied, not shown" as a quiet line in the editor (R7-06). The toast that says it closes after a few seconds, and the board then
 * showed the old revision with no mark. The line stays while the page still shows the revision it showed when the read failed: any read
 * that works shows a newer revision (the write moved the head) or another config, and the line goes.
 */
export const NOT_SHOWN_LINE = { words: "Not showing the latest version.", button: "Show it" } as const;

/** Whether the line shows: `markedOn` is the revision on screen when a read after a write failed, or null. */
export const notShownLine = (markedOn: string | null, showing: string): boolean => markedOn !== null && markedOn === showing;
