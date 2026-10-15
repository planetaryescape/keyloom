# Layouts imported before rung 14 keep their Oryx tap dances native

A layout stored by v0.12.0 or earlier has `TD(DANCE_n)` keys as `native` bindings and the tap dance code in passthrough. It loads and edits as before, but keyloom refuses to add a tap dance to it (`tap_dance_native_conflict`), because the kept code already owns `DANCE_n` and `tap_dance_actions[]`. Importing the Oryx source again reads TD0 and TD1 as tap dances, but a re-import is a new layout, so BK's decisions and revisions stay behind (Q8 in `docs/blueprint/15-open-questions.md`).

An upgrade on read would fix it: `importTapDances` in `src/firmware/qmk/import-tap-dance.ts` already takes `{ anchor, source }` chunks, which is the shape of a stored layout's passthrough, and it only converts code the generator writes back identically. It belongs in `src/app` (persistence can't import firmware), applied wherever a head is read for a change, and it would write the upgraded document as a new revision so the history shows when it happened. Left out of rung 14 part 1 because it touches every read path and wants BK's say on whether a layout may be rewritten without him asking.

Seen in `evidence/rung14/demo-migration.log` (the rung 2 run's database).
