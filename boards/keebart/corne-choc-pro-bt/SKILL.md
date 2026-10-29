# Corne Choc Pro BT has 46 positions, including encoder presses

This profile is the six-column Keebart Corne Choc Pro BT with one rotary encoder on each half and no displays. It is not the 42-key nice!nano Corne. The integrated nRF52840 boards use different left and right targets from Keebart's external ZMK module.

Positions 6 and 7 are the left and right encoder presses. Position 20 is the key below the left encoder; 21 is below the right encoder. The three left thumbs are 40–42, outer to inner; the right thumbs are 43–45, inner to outer. Keep the large inner thumb keys available for the person's most frequent actions.

Encoder turns are board defaults on every layer: left volume up/down, right brightness up/down. Presses are ordinary editable bindings. The extra sensor slots in Keebart's hardware definition retain the same controls for each side.

The first flash needs physical bootloader entry on each half: connect it by USB, double-press the underside reset button, then copy the matching half's UF2 to KEEBART. Flash the right half before the left. Never use a nice!nano UF2. The keyloom module is included for subsequent hands-free flashing, but first-flash and reconnect verification must still be observed on hardware.

ZMK Studio is disabled in this recipe so a saved Studio keymap cannot override the layout being built. Bluetooth pairing settings are retained; do not use settings-reset firmware as part of a normal layout update.

Per-key and per-layer colours use the pinned RGB matrix module through keyloom’s existing lighting controls. Toggle and brightness affect the full matrix; hue, saturation, speed and effects affect the fallback effect on layers without assigned colours. The initial master brightness is 60% of the hardware cap of 30%. Idle blanks the LEDs.

The candidate LED order is inferred from Keebart’s wired Corne map, not yet verified on the BT PCB. Do not describe key-to-LED placement as hardware-verified. See `docs/issues/corne-per-key-rgb.md` for provenance and the physical completion check.
