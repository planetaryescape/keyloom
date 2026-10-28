# A Glove80 `&magic MAGIC 0` key is not read, so its layer is not carried

Status: fixed in 7285c13 (PR 192), released in v0.56.1 (the importer records the layer ref on a kept key whose layer parameter is a `#define` that names a layer; renumbering keeps the name).

Found in stage T (D-451), 2026-10-23, on `feat/copy-translates-codes`.

The MoErgo template writes the magic key as `&magic MAGIC 0`, with `#define MAGIC 2` in the same file. Importing it keeps the key as native code, and the copy can't read it, so the magic key is not carried and its layer has no way in.

Repro:

1. `bun src/cli/main.ts --data-dir <scratch> import test/fixtures/zmk/glove80-template/glove80.keymap --board moergo/glove80 --name glove-template`
2. The stored document has `&magic MAGIC 0` at default-layer position 64, with `label: "magic/L2"` and no `layerRefs`. `src/layout/native-read.ts` returns `unknown` for it.
3. `bun src/cli/main.ts --data-dir <scratch> keyboard put glove-template --on zsa/moonlander` reports position 64 as "it is magic/L2, ZMK code that only works on its own keyboard". The copy proposal for the Moonlander also warns "magic_layer can't be reached: no key switches to it from default_layer" (the proposal's `layer_unreachable` warning, which is in the output of `change propose` on the copied config).

Cause: `src/firmware/zmk/layer-refs.ts` records a layer ref for a number a binding uses. A `#define` name used in a kept binding is not recorded, because the ref is put on the `#define` passthrough (`define:MAGIC`) and not on the binding. The reader needs the ref on the binding (`layerRefs`), so it can't tie `MAGIC` to layer 2.

BK's own Glove80 head is a different case: its magic key stores the number `5` with a ref to `factory-test-layer`. The reader follows that ref, which may not be the magic layer BK meant. That needs checking on the keyboard, not here.

Fix direction: record the layer ref on the binding when a kept binding's layer parameter is a `#define` name, the same way a number is recorded. The fix belongs to the importer (D-360), not the copy.
