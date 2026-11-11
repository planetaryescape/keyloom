// What every flasher reports, so the app and the web editor treat Zapp and UF2 drives alike.
export type FlashState = "waiting_for_bootloader" | "writing" | "succeeded" | "failed";

/**
 * What a flasher adds to a state change beyond the instruction: `needsHand` when the person has to do something because
 * keyloom could not, and `verifying` while the flasher waits for the keyboard to come back. Keyboard sync (17) reads both.
 */
export type FlashNote = {
  needsHand?: true; verifying?: true; recovering?: true;
  /** Why keyloom couldn't restart the keyboard itself, when the person can fix it with a permission (D-501). */
  problem?: FlashPermissionCode;
};

/** A macOS permission a flash was refused for, which the UI turns into an Open System Settings button (D-501). */
export type FlashPermissionCode = "permission_files_and_folders" | "permission_input_monitoring";

export type FlashResult = {
  state: "succeeded" | "failed";
  error: string | null;
  output: string[];
  /** Why it failed, as a code the UI acts on, when the person can fix it (D-501). */
  errorCode?: FlashPermissionCode;
  /** True when keyloom restarted every part of the keyboard itself and the flash was verified: the proof that auto-sync can reach this board (D-160). */
  handsFree?: boolean;
};
