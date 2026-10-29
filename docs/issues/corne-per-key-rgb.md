# Corne per-key colours need hardware position verification

Status: implementation and firmware verification in progress on `feat/corne-per-key-rgb`.

The Corne Choc Pro BT previously admitted only global RGB controls. Its recipe now pins `gudzpoz/zmk-rgb-matrix` at `3166a4ec6801a5726f12a53e82cff92323116025` (MIT) beside ZMK v0.3.0 and the existing Keebart hardware module. Keyloom's existing key-colour picker, layer lighting settings and `setLayerLighting` operation feed this adapter.

## Choose a colour and build it

Select a key, open **Key LED colour** in its card, and pick a colour. Use **Settings → Keyboard LED lighting** for a whole layer. Individual key colours override that layer's colour. Apply, then build and sync the Corne. Colours are compiled into firmware; editing them requires a build and flash.

The CLI takes the same operation. For a config with a `base` layer, save this as `colours.json`:

```json
[{"op":"setLayerLighting","layerId":"base","lighting":{"layer":[131,220,150],"keys":{"42":[213,255,255]}}}]
```

```sh
keyloom change check <config> --ops colours.json
keyloom change propose <config> --ops colours.json --explain 'Colour the base layer and one thumb'
keyloom change apply <change-set-id>
keyloom build <config>
```

HSV channels range from 0 to 255. An empty lighting object deliberately blacks out a layer; `null` removes its override and shows the selected effect. Toggle and brightness controls affect all output. Hue, saturation, speed and effect controls affect the fallback effect; compiled per-key colours remain as chosen in the editor.

## The BT LED order is still unverified

Keebart's BT hardware definition declares 23 LEDs per half but no key-to-LED map. The candidate map comes from the manufacturer's **wired** Corne Choc Pro, `Keebart/vial-qmk-corne-choc-pro@4649f864f15ba9f540ee83d66b50cb9fcd4f7e59`, `keyboards/keebart/corne_choc_pro/standard/keyboard.json`, matching matrix coordinates to the 46-position layout in `info.json`. This is an explicit inference across hardware variants, not proof of the BT wiring.

Before calling the profile hardware-verified, display different colours on the inner thumbs, middle thumbs, outer columns and encoder positions on each half and confirm which physical LEDs light. Correct `lighting.ledPositions` if necessary. Compilation and USB build markers cannot verify LED placement or the wireless layer transitions.

## Compatibility and power are part of the adapter

The first compile against Zephyr 3.5 failed because the module uses `DT_CHILD_NUM_STATUS_OKAY`, introduced after that version. The keyloom module supplies its equivalent using the existing enabled-child iterator, only for RGB-matrix builds. The header also adapts device-declaration termination and variadic token concatenation used by the module's effects. A linker snippet supplies the old toolchain's four-byte iterable-section alignment. Composite binding devices initialize at application priority 80, after LED drivers and before ZMK's keymap and scanner at 90, so macros and hold-taps can depend on RGB behaviours. The declaration macro is adapted from Zephyr `dacab4875df72109b96cc8977547a0dc04875bcd`, with attribution and `LICENSE.zephyr` shipped in the embedded module. ZMK and Zephyr stay pinned.

The next compile exposed the missing priority-aware settings API. RGB module commit `1605305c3804f09f441ec5c4bad7c336ae734eee` puts settings restoration and condition startup in its last-priority commit callback. Zephyr 3.5 commits static handlers first, then dynamic handlers in registration order (`subsys/settings/src/settings.c`). The compatibility header registers the RGB handler at application priority 99, after ZMK's Bluetooth settings handlers, and asserts both the requested `INT_MAX` priority and earlier Bluetooth initialization. This preserves the ordering requirement rather than silently discarding it.

Disabling stock underglow also removes its implicit SPI default. The Corne recipe therefore explicitly enables SPI and the WS2812 driver. A small power adapter follows the RGB engine's active/idle/off state and repaints after the switched LED rail settles. This also recovers from the old firmware's saved external-power-off state. Maximum brightness is 30%; the initial master level is 60% of that cap. Idle blanks the LEDs, and the external-power driver still participates in deep sleep.

Each build target explicitly supplies `KEYLOOM_RGB_LEFT` to devicetree preprocessing. Kconfig role flags cannot select the half there because devicetree is processed before Kconfig; inspecting the first compiled device tree exposed that mistake. Missing per-half flags are a compile error.

The generated RGB block includes HSV metadata. Re-import trusts it only when regenerating the entire block produces identical source. Edited source or a changed LED map is refused with an instruction to use the original keyloom layout export; hand edits are never silently discarded.

Native emulation removes the checked generated RGB block and neutralizes lighting controls before compiling for its hardware-free target. The real firmware retains the matrix module.

## Software checks pass; hardware acceptance remains

The installed local CLI validates the board, checks the colour operations, and generates the per-key source from a scratch config. The browser opens the key-colour picker with all eleven swatches and renders both rotary encoders. Type checking passes. Dependency checks report no violations, with the existing TypeScript 7 compatibility warning.

The broad test run had 3,311 passes, 230 skips and three failures: the documentation field list, a module snapshot read while its header was changing, and an intermittent flash-instruction assertion. All three pass on focused reruns after the final edits; the new lighting and emulation coverage also passes. Both UF2 targets compile and pass Zephyr's initialization-order checker. Inspection of each compiled devicetree confirms all 23 intended LED positions for that half. This verifies selection of the candidate map, not the physical wiring.

## Verification to finish

- Flash only the authorized Corne halves and verify their build markers.
- Physically confirm colour placement, idle/wake, split layer synchronization and the easier encoder access.

Private layouts, firmware logs and renders remain outside the public repository.
