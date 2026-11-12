// R6-16: Swap, Copy and Paste say why they are off in a line, not only in a tooltip, and Paste with nothing copied stays pressable.
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { KEY_MOVES_BLOCKED, KeyMoves, keyMovesNote } from "../../src/web/panel/KeyMoves.tsx";

const moves = (blockedReason: string | null, copied: string | null) =>
  renderToStaticMarkup(<KeyMoves swapping={false} onSwap={() => {}} onCopy={() => {}} copied={copied} pasteTargets={1} onPaste={() => {}} blockedReason={blockedReason} />);

test("a key with a draft gets a line that says why the moves are off", () => {
  expect(keyMovesNote(KEY_MOVES_BLOCKED)).toBe("Swap, Copy and Paste are off: apply or discard this key's change first.");
  expect(keyMovesNote(null)).toBeNull();
  expect(moves(KEY_MOVES_BLOCKED, "Esc").match(/disabled=""/g)).toHaveLength(3);
});

test("Paste with nothing copied stays pressable, so pressing it can say to copy a key first", () => {
  expect(moves(null, null)).not.toContain('disabled=""');
});
