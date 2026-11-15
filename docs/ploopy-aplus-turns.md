# Give the A+ volume turns without changing its presses

Assign volume to the Ploopy A+'s left knob on its base layer. Keep the right knob, both presses and every other layer unchanged.

Use the installed v0.81.0 CLI or later, a matching repository checkout and a POSIX shell. The factory fixture is public upstream source. This recipe needs no provider credential, Docker, server or connected device.

## Import the factory layout into scratch data

Run these commands from the repository root. Keep this shell open for the remaining steps:

```sh
scratch="$(mktemp -d "${TMPDIR:-/tmp}/keyloom-aplus-turns.XXXXXX")"
kl() { keyloom --data-dir "$scratch" "$@"; }
kl import --board ploopy/aplus --name 'A+ factory' --activities none \
  test/fixtures/qmk/ploopy-aplus-default
kl --format json layout show 'A+ factory'
```

Expect eight layers with eight button or press bindings each. The first layer is `layer-0`. Positions 6 and 7 are the left and right knob presses.

These commands write only the scratch directory. Do not run `serve`, `sync`, `flash` or `config use` as part of this recipe.

## Check the complete pair of turn modes

The A+ uses two sensor entries, one for each knob. The Keebart ZMK recipe uses four entries for its alternative footprints. Keep each board's sensor order.

Write both A+ entries even when changing only the left knob:

```sh
cat > "$scratch/turns.json" <<'JSON'
[
  {
    "op": "setSensorBindings",
    "layerId": "layer-0",
    "sensorBindings": [
      {
        "kind": "rotation",
        "clockwise": { "kind": "key", "code": "AUDIO_VOL_UP" },
        "counterclockwise": { "kind": "key", "code": "AUDIO_VOL_DOWN" }
      },
      { "kind": "native", "source": "ploopy-aplus:factory" }
    ]
  }
]
JSON
kl change check 'A+ factory' --ops "$scratch/turns.json"
```

Expect `ok: true`. This check saves no revision. The right entry retains factory behavior. The operation changes no press binding or other layer.

Use keyloom keycode names in typed actions. Page actions use `PAGE_DOWN` and `PAGE_UP`. Firmware aliases such as ZMK's `PG_DN` and `PG_UP` are not those model values.

## Save the checked scratch change and generate source

Create and inspect a proposal before applying it to the scratch config:

```sh
proposal="$(kl --format ids change propose 'A+ factory' \
  --ops "$scratch/turns.json" \
  --explain 'Volume on the left knob; retain factory turns elsewhere')"
kl change show "$proposal"
kl change apply "$proposal"
kl generate 'A+ factory' --out "$scratch/source"
```

The source folder contains `keymap.c`, `config.h`, `rules.mk` and `keymap.json`. Generation does not build or flash firmware.

If a later reset reports `function_lost`, preserve the action elsewhere or explicitly consent to dropping it with `dropFunction` and a reason. Do not bypass validation.

## Keep a JSON backup

Export the editing model, then restore it as a separate scratch config:

```sh
kl layout export 'A+ factory' --out "$scratch/aplus.json"
kl config new 'A+ restored' --from import "$scratch/aplus.json" --board ploopy/aplus
kl --format json layout show 'A+ restored'
```

The restored layers retain their names, bindings and typed turns. The new config has its own identity and history.

Generated QMK source has a narrower contract. Its checked A+ wheel block can reimport as editable turn pairs, but enum-derived layer names can become generic names. Keep JSON for the editing model and generated source for firmware builds.

## See also

- [A+ board reference](../boards/ploopy/aplus/README.md) for factory/custom modes, pinned sources, geometry and hardware limits.
- [ZMK encoder recipe](encoder-layers.md) for the Keebart's four-entry sensor order.
- [Shipped A+ verification](issues/ploopy-aplus-support.md) for release and physical-acceptance boundaries.
