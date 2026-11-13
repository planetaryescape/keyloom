// The words for an edit the layout moved on under (another tab, the CLI). Nothing was written, so the person makes it again on the
// latest version, and the page says the latest version is showing only once the read has worked (R6-03).
export const STALE_EDIT = {
  words: "The layout changed while you were editing",
  shown: "Your change was not applied. The latest version is showing, so you can make it again.",
} as const;

export const STALE_UNDO = {
  words: "The layout changed since this page loaded",
  shown: "The latest version is showing now.",
} as const;

/**
 * Show the latest version from a key card whose check met a newer head (R8-13). The read remounts the card on the newer revision, which
 * opens it without its draft, so the card closes first and its draft waits on its key, dashed amber, where opening the key resumes it on
 * the latest version. A key that changed meanwhile drops the draft, and the page says so in its own toast (PR #306 review).
 */
export const STALE_CHECK = {
  words: STALE_UNDO.words,
  shown: "The latest version is showing now. Your draft waits on its key unless that key changed. Open the key to go on with it.",
} as const;

/** The detail when the latest version couldn't be read: nothing was written, and the button reads it again. */
export const LATEST_NOT_SHOWN = "Nothing was changed, and keyloom couldn't show the latest version yet.";
