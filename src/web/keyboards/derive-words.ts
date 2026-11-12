// What the new-keyboard steps say when keyloom can't add a keyboard (R5-06), from the server's code (DeriveErrorCode, KeyboardAddCode).
// The server's own sentence is the CLI's and names flags such as --controller, so the page never shows it for these codes.

export type DeriveProblem = {
  text: string;
  /** keyloom can't add this keyboard until someone teaches it: the page offers the contribution guide and another keyboard, not Try again. */
  blocked: boolean;
};

/** Plain words for a code, or null for a code that isn't one of these, which the caller says in its own way. */
export function deriveProblem(code: string | null | undefined, name: string): DeriveProblem | null {
  switch (code) {
    case "controller_unknown":
      return {
        text: `keyloom doesn't know a controller for the ${name} yet. It's a shield, so a separate controller board runs it, and keyloom knows none that fits it and that it can flash. Until one is added, keyloom can't add this keyboard.`,
        blocked: true,
      };
    case "boot_drive_unknown":
      return {
        text: `keyloom doesn't know the boot drive of the ${name}'s controller yet, so it can't write the steps to flash it. Until that is added, keyloom can't add this keyboard.`,
        blocked: true,
      };
    case "layout_macro_missing":
      return { text: `keyloom doesn't know which layout the ${name}'s keymaps are written for yet, so it can't add this keyboard.`, blocked: true };
    case "no_key_positions":
      return {
        text: `The ${name}'s firmware files don't give the position of each key, so keyloom can't draw it. Until someone adds its drawing, keyloom can't add this keyboard.`,
        blocked: true,
      };
    case "layout_unreadable":
      // The file is at a fixed commit, so reading it again gives the same answer (R6-14).
      return {
        text: `keyloom can't read the ${name}'s layout file from its firmware, so it can't draw it. Until keyloom learns to read it, keyloom can't add this keyboard.`,
        blocked: true,
      };
    case "board_check_failed":
      // The check reads the same pinned files, so Add with the same answers fails it again (R7-11).
      return {
        text: `keyloom drew the ${name}, but the board it made fails the checks every keyboard in keyloom must pass, so keyloom can't add it yet.`,
        blocked: true,
      };
    case "firmware_unreachable":
      return { text: `keyloom couldn't get the ${name}'s layout from GitHub. Check that this computer is online, then try again.`, blocked: false };
    case "home_row_out_of_range":
      return { text: "That row isn't on this layout. Pick the home row again.", blocked: false };
    default:
      return null;
  }
}
