# A copy onto a Glove80 drops its RGB keys, because no board records lighting controls

Status: open. Found in stage T (D-451), 2026-10-23, on `feat/copy-translates-codes`.

keyloom admits a lighting key (QMK `RGB_*`, ZMK `&rgb_ug …`) only where it has evidence that the firmware has the feature. The evidence is either a per-key LED table in the board's `board.json` (`lighting.ledPositions`, D-190) or a lighting key already somewhere in the layout. The Glove80 has underglow controls but no per-key table. A copy onto it starts from the board's blank start, which holds no lighting key, so nothing proves the controls exist.

Repro: put a Moonlander layout that has RGB keys onto `moergo/glove80`. 19 of the 22 keys not carried are RGB controls, each refused with "keyloom can't tell that the Glove80's firmware has lighting controls, because nothing in this config uses them".

An imported Glove80 config is not affected: its own `&rgb_ug` keys are the evidence, so they can be moved and swapped (test "a layout that already holds a lighting control can move or swap it on a board with no per-key lighting (L1)").

The fix needs a board fact, such as an optional lighting-controls field in `board.json` that `src/boards/schema.ts` accepts and the Glove80 sets. Until then the refusal says what keyloom doesn't know, rather than claiming the board lacks the feature.
