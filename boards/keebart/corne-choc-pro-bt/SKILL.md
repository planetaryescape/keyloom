# Corne Choc Pro BT has 46 positions, including encoder presses

This profile is the six-column Keebart Corne Choc Pro BT with one rotary encoder on each half and no displays. It is not the 42-key nice!nano Corne. The integrated nRF52840 boards use different left and right targets from Keebart's external ZMK module.

Positions 6 and 7 are the left and right encoder presses. Position 20 is the key below the left encoder; 21 is below the right encoder. The three left thumbs are 40–42, outer to inner; the right thumbs are 43–45, inner to outer. Keep the large inner thumb keys available for the person's most frequent actions.

Encoder turns are board defaults on every layer: left volume up/down, right brightness up/down. Presses are ordinary editable bindings. The extra sensor slots in Keebart's hardware definition retain the same controls for each side.

The first flash needs physical bootloader entry on each half: connect it by USB, double-press the underside reset button, then copy the matching half's UF2 to KEEBART. Flash the right half before the left. Never use a nice!nano UF2. The keyloom module is included for subsequent hands-free flashing, but first-flash and reconnect verification must still be observed on hardware.

ZMK Studio is disabled in this recipe so a saved Studio keymap cannot override the layout being built. Bluetooth pairing settings are retained; do not use settings-reset firmware as part of a normal layout update.

RGB is off at startup to save battery. The board supports ZMK underglow controls, not independently assigned per-key layer colours.
