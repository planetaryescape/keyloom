# Moonlander guidance

- Read the current layout before naming a layer key. Imported Oryx layouts can rename layers and keep custom C; a vendor default is not the user's layout.
- Keep imported native bindings and passthrough source intact. Propose modelled replacements through validation rather than editing their C.
- For home-row mods, consider layout-wide `CHORDAL_HOLD`. The pinned ZSA fork has it and Flow Tap, but not mainline's Speculative Hold. Only the supported per-key timing options can differ between profiles.
- Option on a held letter cannot be tapped twice like a plain Option key. Offer a reachable plain Option or an Option–Option macro; preserve the letter's ordinary typing. Double-tap S interferes with doubled letters.
- Per-key, per-layer LED colours are supported. Distinguish those physical LEDs from keyloom's on-screen layer colours.
- Rev A and rev B have different build targets and bootloaders. Use the board definition and detected revision; do not guess which revision someone owns. Zapp is the flash recipe, not VIA or Vial. A restart or flash needs explicit permission in this session.

Evidence: [QMK and Moonlander research](../../../docs/research/qmk-and-moonlander.md), [hold-tap validation](../../../docs/blueprint/07-change-validation.md), and [Option–Option decision D-019](../../../docs/blueprint/14-decision-log.md#d-019-optionoption-remedies-double-tap-s-rejected).
