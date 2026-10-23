# A Print Screen key carries onto the MacBook, then stops its kanata config from generating

Status: open. Found during stage T's verification, 2026-10-23. Checked on origin/main `f1ba5e6`.

`PRINT_SCREEN` has no kanata name in the key table: `kanataName("PRINT_SCREEN")` is `undefined`, and `keyName("PRINT_SCREEN")` (`src/layout/kanata/names.ts:10`) throws "PRINT_SCREEN has no kanata key name on macOS, so kanata can't send it".

A copy doesn't catch it. `keyboard put` of the MoErgo Glove80 template (`test/fixtures/zmk/glove80-template/glove80.keymap`, which has one Print Screen key) onto `apple/macbook-ansi` succeeds, and its JSON report doesn't name Print Screen among the keys not carried. The stage T worker reported that generating the MacBook config for such a layout then fails on this key. I didn't rerun generation, because a kanata generate on this machine could touch BK's running kanata.

Two questions settle the fix:
- Does kanata on macOS have a name for this key? Check kanata's key list at the pinned SHA that `scripts/gen-keycodes.ts` reads.
- If it doesn't, should the copy's kanata check (`kanataRefusal` in `src/layout/transfer.ts`) skip the key with this reason, as it does for other keys kanata can't write?
