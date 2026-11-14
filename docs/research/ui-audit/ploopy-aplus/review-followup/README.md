# Computer Use through the Codex CLI passed the final card check

Source: `fix/ploopy-aplus-delivery` at `0bc2ab1b1e6cfb948e5514e4a7bda2183c4bf2a7`.
Candidate: `/tmp/keyloom-aplus-review-candidate/keyloom-darwin-arm64`.
Scratch config: `A+ wheel smoke`, revision `rev_01M7DSQ8JW6YD1WHQ3S3QKV9DQ`.

The Codex CLI loaded the bundled Computer Use plugin through `node_repl` and `@oai/sky`. Dia opened the real scratch editor on port 4489. Playwright and browser DOM automation were not used.

| Control | Observed result | Captures |
| --- | --- | --- |
| Outer top-left button, Key 1 | The Back card matches the physical outline. Its label fits, and its tap region opens the picker. | [Dark](button-dark.png), [light](button-light.png) |
| Left knob, Key 7 | Gesture press stays separate from Volume Up clockwise and Volume Down counterclockwise. | [Dark](left-knob-dark.png), [light](left-knob-light.png) |
| Right knob, Key 8 | Control-layer toggle stays separate from Scroll right clockwise and Scroll left counterclockwise. | [Dark](right-knob-dark.png), [light](right-knob-light.png) |

Both knob cards show their correct physical titles and Custom turns on this layer. Labels fit inside the card previews. The selector labels and press regions remain separate in both themes. The checked screenshots show no overlap or clipped text.

The source window capture measured 6380 × 2614 pixels. Page bounds were x=840, y=185, width=5530, height=2419. These images crop the cards and board from those page captures. The light button image also uses a smaller source image. Browser chrome, unrelated pages and personal reference photos are excluded.

The first CLI attempt captured Dia but hit its user-change guard during tab selection. Opening the exact preview URL directly worked. Later actions refreshed state and resolved the observed control's current index before clicking. The earlier `cgWindowNotFound` error did not recur in these CLI checks. Its cause remains unknown.

The original dark theme was restored. No mode, action or revision changed. No Apply or firmware action ran. The CLI sessions reset `node_repl` after the checks. This run did not repeat phone sizing or hardware checks. Earlier desktop and phone evidence remains in the parent folders.

Local receipts and accessibility text are under `/tmp/keyloom-aplus-cli-computer-use-direct` and `/tmp/keyloom-aplus-cli-computer-use-knobs`. Those temporary files are supporting evidence. The checked screenshots above are the durable record.
