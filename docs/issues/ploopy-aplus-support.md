# Ploopy A+ support includes matching physical controls

Status: implemented in `2aee18144986a4d0434d7734a64f0eafac98dc87` on `feat/ploopy-adept-aplus`. Unreleased. Hardware behavior after flashing remains unchecked.

BK's right-hand A+ needs its own board definition, factory firmware and editor geometry. Earlier drawings had wrong proportions, clipped labels and a generic square key card.

The implementation adds `ploopy/aplus`, USB detection, a pinned QMK recipe and factory import. It preserves gesture, wheel and VIA source through edits. External QMK modules use independent commit pins and trusted source staging. The [board reference](../../boards/ploopy/aplus/README.md) owns the source pins, position order and boot instructions.

The display uses the maker's CAD contours, yellow plastic and a blue ball. Board controls and key cards share their outlines, proportions, materials and safe print areas. The [visual evidence](../research/ui-audit/ploopy-aplus/README.md) includes desktop and phone captures in both themes.

## CLI and firmware checks pass

The candidate detected the connected A+. `boards check boards/ploopy/aplus` returned `ok: true` with no issues. A scratch factory config imported eight layers. The validator accepted a swap of base positions 0 and 1. That swap produced UF2 build `bld_01M7DKJ6D44AVAYSYRBDSX95EC`, with 122880 bytes.

The local build receipt is `/tmp/keyloom-aplus-firmware-build.log`. The firmware log is `/tmp/keyloom-aplus-cli-check/logs/build-bld_01M7DKJ6D44AVAYSYRBDSX95EC.log`. These local files are temporary evidence.

The broader focused run passed 316 tests across 23 files. The final board, picker, slot, dance and contrast run passed 70 tests. TypeScript and dependency checks passed. The only whitespace findings are in the verbatim upstream `keymap.c` fixture.

## The preview stays separate from installed keyloom

The final compiled candidate is `/tmp/keyloom-aplus-candidate-final/keyloom-darwin-arm64`. It reports the base version `0.80.6`. Its A+ changes are local and unreleased.

The preview serves scratch data from `/tmp/keyloom-aplus-review` on port 4489. The separate CLI check uses `/tmp/keyloom-aplus-cli-check`. The installed app and CLI remain unchanged. We did not flash a keyboard.

To restart the preview:

```sh
/tmp/keyloom-aplus-candidate-final/keyloom-darwin-arm64 \
  --data-dir /tmp/keyloom-aplus-review serve --port 4489
```

Open the authenticated URL printed by that command. Its token changes after a restart.

Next action: review the matching board and key card in the local preview. Hardware acceptance requires an explicit flash request, then checks of all buttons, both knob presses, wheel rotation, gestures and drag scrolling. Publishing and installed-copy updates remain separate release work.
