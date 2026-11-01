# Put mouse turns on Base and keep media on Numbers

Use the Keebart Corne's knobs for horizontal and vertical pointer movement on Base,
with volume and brightness turns on Numbers. Keep mute and play/pause on the
Numbers presses, and use left/right clicks on Base.

**Availability:** requires the D-469 encoder implementation; v0.65.0 does not
include it. Check your installed version's changelog, or run from this clone.
Source generation and a real build for both halves passed;
physical pointer behavior has not been tested. This recipe uses synthetic data
and does not flash a keyboard.

## Start with a scratch config

From the repository root, with Bun installed, create a scratch directory and
import the two-layer test fixture. Keep this shell open for the remaining steps.
No provider credential or Docker is needed until the optional build.

```sh
scratch="$(mktemp -d "${TMPDIR:-/tmp}/keyloom-encoders.XXXXXX")"
kl() { bun src/cli/main.ts --data-dir "$scratch" "$@"; }
kl import test/fixtures/zmk/encoder-layers.keymap \
  --board keebart/corne-choc-pro-bt --name Encoders
kl --format json layout show Encoders
```

The import reports two layers and 46 keys per layer. Base is `base`; Numbers is
`numbers`, reached by holding Base position 40. Positions 6 and 7 are the encoder
presses. Missing `sensorBindings` means the board's defaults still apply.

## Check the change before saving it

Write the five operations, then validate them without saving anything:

```sh
bun -e '
const mouse = direction => ({ kind: "native", firmware: "zmk",
  source: `&mmv MOVE_${direction}`, label: `Mouse ${direction.toLowerCase()}` });
const pair = (cw, ccw) => ({ kind: "rotation", clockwise: mouse(cw), counterclockwise: mouse(ccw) });
const press = (layerId, position, binding) => ({ op: "setBinding", at: { layerId, position }, binding });
console.log(JSON.stringify([
  { op: "setSensorBindings", layerId: "base", sensorBindings: [
    pair("RIGHT", "LEFT"), pair("RIGHT", "LEFT"),
    pair("DOWN", "UP"), pair("DOWN", "UP")
  ] },
  press("numbers", 6, { kind: "key", code: "AUDIO_MUTE" }),
  press("numbers", 7, { kind: "key", code: "MEDIA_PLAY_PAUSE" }),
  press("base", 6, { kind: "native", firmware: "zmk", source: "&mkp LCLK", label: "Left click" }),
  press("base", 7, { kind: "native", firmware: "zmk", source: "&mkp RCLK", label: "Right click" })
], null, 2));
' > "$scratch/ops.json"
kl change check Encoders --ops "$scratch/ops.json"
```

Expect `ok: true` in JSON output, with no validation errors. Numbers keeps its
default volume/brightness turns because the change only replaces Base's turns.
Its presses preserve mute and play/pause before Base's presses become clicks.

The array has **four sensor entries for two knobs**: each knob has two alternative
firmware footprints. Keep each pair identical. The UI does this for you, but a CLI
or agent proposal must supply the whole layer array in firmware order.

If validation reports `function_lost`, relocate the affected media function to a
reachable key or layer, then check again. Use `dropFunction` only when you intend
to remove that function, with a reason; do not bypass validation.

## Save, inspect and apply the scratch proposal

Save the checked proposal, inspect it, then apply it to the scratch config:

```sh
proposal="$(kl --format ids change propose Encoders --ops "$scratch/ops.json" \
  --explain 'Mouse on Base; keep media on Numbers')"
kl change show "$proposal"
kl change apply "$proposal"
kl generate Encoders --out "$scratch/source"
kl layout export Encoders --out "$scratch/encoders.json"
```

You get a new revision, `corne_choc_pro.keymap`, `corne_choc_pro.conf` and a
portable JSON layout. The keymap has different `sensor-bindings` on Base and
Numbers, and the config enables `CONFIG_ZMK_POINTING=y`. Nothing reaches hardware
through these commands. Do not run `sync`, `flash` or `config use` as part of this
recipe.

Keep the JSON export for editable backups. Generated custom rotation helpers can
reimport from `.keymap` as opaque sensor calls; their source is preserved, but
their clockwise/counterclockwise editing model is not reconstructed. The JSON
export retains those typed pairs.

## Edit the same controls in the app

Open the scratch app:

```sh
kl serve --no-open
```

Open its printed URL, select Encoders and Base, then click the left or right
encoder press. Set **Clockwise turn** and **Counterclockwise turn** above the press
slots. Choose keys, mouse movement, scrolling or Nothing. Edit the press below;
the Any picker accepts `&mkp LCLK` and `&mkp RCLK`.

Turns and presses share **Apply** and **Discard**. Switch to Numbers after applying
to check its turns stayed unchanged. **Use board defaults on this layer** stages a
turn reset; Apply commits it. Closing a card preserves its draft, but an intervening
edit to the key or layer's sensor bindings invalidates it rather than overwriting
newer work. Keep tests on this scratch config: Apply on a real auto-synced config
can build and flash it.

## Build without flashing

Start your existing Docker runtime, then check and build:

```sh
docker info
kl build Encoders
```

The result should report `status: "succeeded"` and an artifact path for a ZIP
containing `left.uf2` and `right.uf2`. On BK's machine, agents must submit this
heavy command through `agent-work run --` rather than running competing builds.
Stop after the build unless a hardware flash has been explicitly authorized.

The [build receipt](screenshots/encoder-layers/README.md) records the successful
two-half compile. It proves the generated configuration builds, not that the
pointer moves correctly on a physical keyboard. Scroll controls are implemented
but were not part of that pointer/media build fixture.

See [the ZMK implementation](blueprint/06-firmware-zmk.md#per-layer-encoder-turns)
for the timing and import boundaries, and [the CLI reference](blueprint/10-cli.md)
for the checked-proposal commands.
