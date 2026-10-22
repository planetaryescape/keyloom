// What every flasher reports, so the app and the web editor treat Zapp and UF2 drives alike.
export type FlashState = "waiting_for_bootloader" | "writing" | "succeeded" | "failed";

/**
 * What a flasher adds to a state change beyond the instruction: `needsHand` when the person has to do something because
 * keyloom could not, and `verifying` while the flasher waits for the keyboard to come back. Keyboard sync (17) reads both.
 */
export type FlashNote = { needsHand?: true; verifying?: true; recovering?: true };

export type FlashResult = {
  state: "succeeded" | "failed";
  error: string | null;
  output: string[];
  /** True when keyloom restarted every part of the keyboard itself and the flash was verified: the proof that auto-sync can reach this board (D-160). */
  handsFree?: boolean;
};
