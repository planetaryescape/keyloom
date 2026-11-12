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

/** The detail when the latest version couldn't be read: nothing was written, and the button reads it again. */
export const LATEST_NOT_SHOWN = "Nothing was changed, and keyloom couldn't show the latest version yet.";
