# Layer numbers in kept code: what is left after D-360 and D-378

Move left, Move right and Delete used to be refused on BK's Moonlander and Glove80 because passthrough code names layers by number (`passthrough_layer_index`, D-024). D-360 fixes that for a layout imported from now on: the importer records which numbers in the kept code and kept keys are layer numbers, and generation writes them for the layers' current order. On the Moonlander fixture that is Oryx's `#define DUAL_FUNC_0 LT(5, KC_4)` and the two `layer_move(5)`; on the Glove80 template it is the `LAYER_*` defines that `layer_td`'s `&mo LOWER` and `&magic MAGIC 0` read. Both are proved in the emulator (`test/firmware/qmk/emulate.docker.test.ts`, `test/firmware/zmk/emulate-docker.test.ts`): after a move, the layer key opens the same layer's keys.

Deleting a layer the code or a kept key names is still refused, now naming that key or line. A line that uses a layer number in a way that can't be rewritten (arithmetic, a bitmask, `get_highest_layer(…) > 2`, a name no `#define` resolves) refuses a renumber and says which line.

What is left:

- Layouts stored before the numbers were read are read at startup (D-378, `src/app/layer-ref-backfill.ts`), as one revision each. A define that only the modelled keys use (the template's `DEFAULT`, `FACTORY_TEST`) has no kept code to renumber, so it is left as written; the keys are written by number and nothing reads it. A layout whose board is missing or whose head moved during the read is left alone and tried at the next start.
- Only the positions listed in [07](../blueprint/07-change-validation.md#layer-numbers-in-kept-code) are read. A layer behaviour that is not in the lists and not a kept hold-tap holding with `&mo`-style behaviours is not seen, and its number is left alone. That is a silent miss; adding the name to the table in `src/firmware/zmk/layer-refs.ts` or `src/firmware/qmk/layer-refs.ts` fixes it.
