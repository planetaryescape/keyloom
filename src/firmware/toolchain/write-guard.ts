// Which keyboard writes are under way in this process, so whatever stops keyloom (a Ctrl-C, a closed terminal, a server shutting
// down) can see that stopping now would leave a keyboard half written, and wait instead (D-506). The flashers mark the window in
// which an interrupted write strands the keyboard in its bootloader: from the bootloader appearing, or keyloom restarting the
// keyboard into it, until the flash tool or the copy has finished.

let holds = 0;

/** Marks a keyboard write as under way until the returned function is called. Calling it twice releases once. */
export function holdKeyboardWrite(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
  };
}

export const keyboardWriteInProgress = (): boolean => holds > 0;

export const WRITE_IN_PROGRESS_MESSAGE = "keyloom is writing to the keyboard, and stopping now would leave it half written. It stops when the write ends.";
