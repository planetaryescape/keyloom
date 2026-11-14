# The A+ board and key card share their physical controls

Checked on 14 November 2026 in Dia through Computer Use. The compiled candidate uses `feat/ploopy-adept-aplus` at `2aee18144986a4d0434d7734a64f0eafac98dc87`, based on `origin/main` at `b38c0d4a4baff6e23958990dac2f47aa0c839599`.

The preview uses a scratch factory config. No Apply, sync or flash ran against a device.

## The captures cover desktop and phone views

All captures use device pixel ratio 2. Desktop files measure 2880 × 1800 pixels for a 1440 × 900 viewport. Phone files measure 780 × 1688 pixels for a 390 × 844 viewport.

| Capture | Observed result |
|---|---|
| [Desktop light](desktop-light.png) | The case, wrist rest, six buttons and two knobs fit in the stage. |
| [Desktop dark](desktop-dark.png) | Yellow plastic and the blue ball retain their colors. All eight labels fit. |
| [Desktop dark card](desktop-dark-card.png) | The Back card uses the selected button's contour, proportions and finish. |
| [Phone light](phone-light.png) | All eight controls and their labels fit across the viewport. |
| [Phone dark](phone-dark.png) | The same geometry and colors fit in the dark room. |
| [Phone light rotary card](phone-light-rotary-card.png) | The Gesture card keeps the knob circular. |
| [Phone dark picker](phone-dark-picker.png) | The compact knob stays circular. Its focus ring is round, and search remains visible. |

The two light phone captures precede the final commit. Their shown controls did not change afterward. The final commit restores existing gradients for boards without physical materials and rounds the rotary picker's focus ring.

## Labels and keyboard navigation pass focused checks

A read-only Console measurement found no label outside its `.cap-print` rectangle at 1440 × 900 and 390 × 844. The check measured text ranges for each visible tap and front label. A geometric test also samples every print rectangle against its button contour.

Keyboard-only navigation reached the board through Tab. Right Arrow selected Forward, Enter opened its card, and Escape closed it. Focus returned to Forward. Pointer checks opened Back, Gesture and the Gesture picker.

The display uses contours from the maker's mechanical assembly. The [board reference](../../../../boards/ploopy/aplus/README.md) records the dimensions, projection and license. Personal reference photos are not repository assets. This check establishes the rendered controls and label fit. Physical input mapping after flashing remains unchecked.

The [support handover](../../../issues/ploopy-aplus-support.md) records firmware checks and the next action.
