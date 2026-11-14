# Ploopy A+ support includes matching physical controls

Status: implemented through `b3c0091b0ebc9e327459bf3ffabe79b9158c3519`. Delivery continues on `fix/ploopy-aplus-delivery` in [PR 353](https://github.com/planetaryescape/keyloom/pull/353). Unreleased. Hardware behavior after flashing remains unchecked.

BK's right-hand A+ needs its own board definition, factory firmware and editor geometry. Earlier drawings had wrong proportions, clipped labels and a generic square key card.

The implementation adds `ploopy/aplus`, USB detection, a pinned QMK recipe and factory import. It preserves gesture, wheel and VIA source through edits. External QMK modules use independent commit pins and trusted source staging. The [board reference](../../boards/ploopy/aplus/README.md) owns the source pins, position order and boot instructions.

The display uses the maker's CAD contours, yellow plastic and a blue ball. Board controls and key cards share their outlines, proportions, materials and safe print areas. The [visual evidence](../research/ui-audit/ploopy-aplus/README.md) includes desktop and phone captures in both themes.

## CLI and firmware checks pass

The candidate detected the connected A+. `boards check boards/ploopy/aplus` returned `ok: true` with no issues. A scratch factory config imported eight layers. The validator accepted a swap of base positions 0 and 1. That swap produced UF2 build `bld_01M7DKJ6D44AVAYSYRBDSX95EC`, with 122880 bytes.

The local build receipt is `/tmp/keyloom-aplus-firmware-build.log`. The firmware log is `/tmp/keyloom-aplus-cli-check/logs/build-bld_01M7DKJ6D44AVAYSYRBDSX95EC.log`. These local files are temporary evidence.

The broader focused run passed 316 tests across 23 files. The final board, picker, slot, dance and contrast run passed 70 tests. TypeScript and dependency checks passed. The only whitespace findings are in the verbatim upstream `keymap.c` fixture.

## The preview stays separate from installed keyloom

The current compiled candidate is `/tmp/keyloom-aplus-wheels-candidate/keyloom-darwin-arm64`. It reports the base version `0.80.6`. Its A+ changes are local and unreleased.

The preview serves scratch data from `/tmp/keyloom-aplus-wheels-cli-check` on port 4489. The config is `A+ wheel smoke`. The previous preview stopped before this fix. The installed app and CLI remain unchanged. We did not flash a keyboard.

To restart the preview:

```sh
/tmp/keyloom-aplus-wheels-candidate/keyloom-darwin-arm64 \
  --data-dir /tmp/keyloom-aplus-wheels-cli-check serve --port 4489
```

Open the authenticated URL printed by that command. Its token changes after a restart.

## Both knobs now have per-layer turn controls

The card offers factory or custom turn mode. Custom mode exposes clockwise and counterclockwise actions before the press. Left and right knob titles follow physical position, independently of the assigned hand. The adapter preserves factory behavior for every untouched knob and layer. Export and reimport retain editable pairs.

The validator accepted volume turns on the left knob, horizontal scrolling on the right, and Page Down/Up on the Control-layer right knob. CLI apply saved revision `rev_01M7DS9ZZCAANS97YQK296RADN`. Build `bld_01M7DSA0S83RTTXS68CN2R7K35` produced a 123392-byte UF2. The [wheel evidence](../research/ui-audit/ploopy-aplus/wheels/README.md) records the artifact digest and portable receipt.

Computer Use exposed a save blocker for a lost turn action with no key slot. The fix offers an explicit drop choice. Browser Apply saved `rev_01M7DSMDN12T793F8FP0AT1AW9`. The CLI returned the new turn, unchanged counterclockwise action, other knob and Control layer. Browser Undo restored the built assignments at `rev_01M7DSQ8JW6YD1WHQ3S3QKV9DQ`.

The broader run passed 842 tests, skipped 19 Docker-gated cases and failed none. After the save-flow fix, 51 focused tests passed. TypeScript, dependency checks and the changed-line anti-slop check pass. React Doctor reports two nonblocking warnings in `EncoderTurns`: function complexity and an array lookup over at most two sensor indexes.

## Full delivery checks pass locally

The full suite on delivery candidate `8ecde0199c684c666ea0fda48920325a263334f2` passed 5058 tests with 246 gated skips and zero failures. It ran 5304 tests across 518 files. The final copy change replaces the A+'s typing-key instruction with “Click a button or knob to edit it.” TypeScript passes after that change. No other implementation gap emerged from the audit.

Next action: follow PR 353's CI and review, then finish the repository handoff. The PR carries all four implementation and evidence commits from the original local branch. We closed Computer Use. The preview server stays running on port 4489 for review. Hardware acceptance requires an explicit flash request, then checks of both turn directions, all buttons, gestures and drag scrolling. Physical clockwise orientation remains unchecked. Publishing and installed-copy updates remain separate release work.
