# Ploopy A+ uses the factory QMK layout

Available in v0.81.0. For a checked CLI path that stops before flashing, follow [volume turns without changing the presses](../../../docs/ploopy-aplus-turns.md).

```sh
keyloom --data-dir /tmp/keyloom-aplus config new 'A+ factory' --blank --board ploopy/aplus
keyloom --data-dir /tmp/keyloom-aplus build 'A+ factory'
```

The board has six buttons and two knob presses. Positions 0–3 run across the top. Positions 4–5 are the lower buttons. Positions 6–7 are the left and right knob presses. The hand and finger hints describe right-hand use. Finger assignments are provisional.

The factory keymap has eight layers. Its custom callbacks retain gesture recognition, drag scrolling, wheel rotation and VIA support. Each knob also supports custom turn actions on each layer.

## Each knob has separate turn and press controls

Select a layer, then click the round knob. Set **Turn behavior** to **Custom turns on this layer**. Choose the clockwise and counterclockwise actions, then apply the change. The press stays in the key card below those controls.

Custom turns support keys, media keys, scrolling and Nothing. They use the highest active layer. Holding the knob pauses its custom turns. Each knob keeps its own mode on each layer. Selecting **Factory scrolling and volume** restores that knob's original behavior on the current layer.

Factory mode retains Ploopy's scrolling, arrow and volume modes. Custom mode replaces those modes for that knob on that layer. It uses the factory low-resolution wheel threshold for each key tap. Unchanged wheels keep their factory processing, including host-specific scrolling.

The CLI and agent use `setSensorBindings`. Sensor 0 is the left knob, and sensor 1 is the right knob. Preserve the other sensor when changing one. A native sensor with source `ploopy-aplus:factory` keeps factory mode. `null` restores both board defaults on that layer. The validator still requires consent before dropping a reachable action.

The wheel adapter checks the pinned factory callback before adding custom turns. It refuses unknown callback changes. Firmware export and reimport retain editable turn pairs. The importer also checks generated wheel code against its saved metadata before removing it. It refuses edited code rather than losing it.

Keep a `keyloom layout export` JSON file for an editable backup. Generated QMK source preserves turn pairs and bindings, but writes numeric layer indexes. Reimport can replace enum-derived layer names with `Layer 0`, `Layer 1` and so on. The [CLI recipe](../../../docs/ploopy-aplus-turns.md#keep-a-json-backup) checks the JSON backup separately.

## Firmware comes from pinned sources

The QMK source is `ploopyco/qmk_firmware`, branch `ploopyco/a+`, commit `ed6bc4231cc0c39f5f4c0ff82f0d5ad5d8ef7e6e`. The target is `ploopyco/aplus/rev2_001`. Its `info.json` uses Hjson syntax.

The build pins `drashna/qmk_modules` at `ac529c8fe24cb66403fdf0b4a308910c705cc64c`. It stages that collection under `modules/drashna` for the acceleration and gesture modules. The recipe also pins the QMK Docker image and required submodules.

USB detection matches vendor `0x5043`, product `0x81db`, and product name `Ploopy A+ Trackball`. A compiled candidate detected the connected device. The validator accepted a navigation-button swap, which built as UF2. Hardware behavior after flashing remains unchecked.

## The display follows Ploopy's mechanical assembly

The flat button contours, case and wrist rest derive from [Aplus-RevA-NoLogo.STL](https://github.com/ploopyco/aplus-trackball/blob/f48741288a3b21ce5a284f54de99fcd757c4ae7f/hardware/mechanicals/Aplus-RevA-NoLogo.STL), commit `f48741288a3b21ce5a284f54de99fcd757c4ae7f`. The mechanical source uses CERN-OHL-S-2.0, reproduced in [MECHANICAL-LICENSE](MECHANICAL-LICENSE). The derived display contours retain that license.

The projection uses 19.05 mm per display unit. With STL coordinates in millimeters, screen coordinates are `(100 - Y) / 19.05` and `(733.0603 - X) / 19.05`. Upward faces supply each button's perimeter. Contours simplify to a 0.25 mm tolerance. Binding order still comes from the generated QMK geometry.

The assembly measures 100 × 110 mm for the body and about 96.94 × 77.74 mm for the wrist rest. The knobs measure about 26.9 mm across. The rendered ball uses the maker's stated 45 mm diameter. The yellow plastic and blue ball follow the owner's supplied photos. Those personal photos are not repository assets.

The wrist rest stays visible to match the complete device in the owner's reference photos.

The editor and key card use the same flat profile, print areas and materials. Fine texture, bevels, socket shading and a reflected highlight give the top view depth. This is a shaded vector view, not an interactive 3D mesh.

## Flashing requires the boot drive

Nothing in this addition flashes the device automatically. To enter its bootloader, unplug USB, hold the bottom-left button, then reconnect USB. Use the button, not the knob. Release it when the `RPI-RP2` drive appears. The board recipe copies the built UF2 to that drive only after an explicit flash request.

The A+ has two status LEDs. It has no per-key RGB layout that keyloom writes. Firmware lighting-control bindings remain available.
