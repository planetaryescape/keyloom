# Ploopy A+ support includes matching physical controls

Status: implemented through `15130ca8ff4fd55d73895e7aba72ae0a9731db99`. All eight CI jobs passed and all six review threads are resolved in [PR 353](https://github.com/planetaryescape/keyloom/pull/353). BK authorized shipping on 15 November 2026. Release and installed-copy verification remain pending. Hardware behavior after flashing remains unchecked.

BK's right-hand A+ needs its own board definition, factory firmware and editor geometry. Earlier drawings had wrong proportions, clipped labels and a generic square key card.

The implementation adds `ploopy/aplus`, USB detection, a pinned QMK recipe and factory import. It preserves gesture, wheel and VIA source through edits. External QMK modules use independent commit pins and trusted source staging. The [board reference](../../boards/ploopy/aplus/README.md) owns the source pins, position order and boot instructions.

The display uses the maker's CAD contours, yellow plastic and a blue ball. Board controls and key cards share their outlines, proportions, materials and safe print areas. The [visual evidence](../research/ui-audit/ploopy-aplus/README.md) includes desktop and phone captures in both themes.

## CLI and firmware checks pass

The candidate detected the connected A+. `boards check boards/ploopy/aplus` returned `ok: true` with no issues. A scratch factory config imported eight layers. The validator accepted a swap of base positions 0 and 1. That swap produced UF2 build `bld_01M7DKJ6D44AVAYSYRBDSX95EC`, with 122880 bytes.

The local build receipt is `/tmp/keyloom-aplus-firmware-build.log`. The firmware log is `/tmp/keyloom-aplus-cli-check/logs/build-bld_01M7DKJ6D44AVAYSYRBDSX95EC.log`. These local files are temporary evidence.

The broader focused run passed 316 tests across 23 files. The final board, picker, slot, dance and contrast run passed 70 tests. TypeScript and dependency checks passed. The only whitespace findings are in the verbatim upstream `keymap.c` fixture.

## The review preview stopped before shipping

The current compiled candidate is `/tmp/keyloom-aplus-final-review-candidate/keyloom-darwin-arm64`. It reports the base version `0.80.6`. Its A+ changes are unreleased.

The final review preview served `/tmp/keyloom-aplus-review` on port 4489. It restored the earlier edited `A+ factory` config after a separate wheel-test config omitted six button assignments. A comparison with the earlier revision reported no button differences after recovery. Keep wheel-test configs on a separate port. The review server stopped at BK's request on 15 November 2026. Its data remains intact. We did not flash a keyboard.

To restart the preview:

```sh
/tmp/keyloom-aplus-final-review-candidate/keyloom-darwin-arm64 \
  --data-dir /tmp/keyloom-aplus-review serve --port 4489 --no-open
```

Open the authenticated URL printed by that command. Its token changes after a restart.

## Both knobs now have per-layer turn controls

The card offers factory or custom turn mode. Custom mode exposes clockwise and counterclockwise actions before the press. Left and right knob titles follow physical position, independently of the assigned hand. The adapter preserves factory behavior for every untouched knob and layer. Export and reimport retain editable pairs.

The validator accepted volume turns on the left knob, horizontal scrolling on the right, and Page Down/Up on the Control-layer right knob. CLI apply saved revision `rev_01M7DS9ZZCAANS97YQK296RADN`. Build `bld_01M7DSA0S83RTTXS68CN2R7K35` produced a 123392-byte UF2. The [wheel evidence](../research/ui-audit/ploopy-aplus/wheels/README.md) records the artifact digest and portable receipt.

Computer Use exposed a save blocker for a lost turn action with no key slot. The fix offers an explicit drop choice. Browser Apply saved `rev_01M7DSMDN12T793F8FP0AT1AW9`. The CLI returned the new turn, unchanged counterclockwise action, other knob and Control layer. Browser Undo restored the built assignments at `rev_01M7DSQ8JW6YD1WHQ3S3QKV9DQ`.

The broader run passed 842 tests, skipped 19 Docker-gated cases and failed none. After the save-flow fix, 51 focused tests passed. TypeScript, dependency checks and the changed-line anti-slop check pass. React Doctor reports two nonblocking warnings in `EncoderTurns`: function complexity and an array lookup over at most two sensor indexes.

## Full delivery checks pass locally

The full suite on delivery candidate `8ecde0199c684c666ea0fda48920325a263334f2` passed 5058 tests with 246 gated skips and zero failures. It ran 5304 tests across 518 files. The final copy change replaces the A+'s typing-key instruction with “Click a button or knob to edit it.” TypeScript passes after that change. No other implementation gap emerged from the audit.

## Review found three defects

All ten PR checks passed on `1191a426ab0e8e66b32e9b727d1cc48df3dcb39c`. The four review findings have these dispositions:

- Fixed: a failed companion download returns a no-default reason and stops lookup. It cannot silently select a JSON default with fewer features. A missing C default can still use an available JSON default.
- Fixed: declarations that use generated custom keycodes follow the enum. Later declarations keep their order. Regression tests compile both `custom_keycodes` and a renamed `actions` enum with the host C compiler.
- Fixed: flat key cards share one safe-height budget across tap, hold and corners. Short controls retain a positive tap area.
- Rejected: removing the wrist rest conflicts with BK's request to match the complete device in his photos. The board reference records this choice.

The broader follow-up run passed 524 tests with 19 gated skips and no failures across 43 files. The final board and card regressions passed nine tests, including a valid JSON fallback. TypeScript and dependency checks passed. Logs are `/tmp/keyloom-aplus-review-focused.log`, `/tmp/keyloom-aplus-review-final-regressions.log`, `/tmp/keyloom-aplus-review-typecheck.log` and `/tmp/keyloom-aplus-review-dependencies.log`.

The compiled follow-up candidate generated all four firmware source files from scratch revision `rev_01M7DSQ8JW6YD1WHQ3S3QKV9DQ`. Output is `/tmp/keyloom-aplus-review-generated`. It serves the same scratch config on port 4489. The earlier preview stopped normally.

All eight CI jobs passed on `0bc2ab1b`. Both automated review checks completed with neutral results. All four review threads are resolved. CodeRabbit and Baz acknowledged the three functional fixes.

The [fresh visual check](../research/ui-audit/ploopy-aplus/review-followup/README.md) passed through the Codex CLI's Computer Use plugin. It captured the Back card and both knob cards in light and dark themes. Labels fit, the tap picker opens, and both turn directions stay separate from each press. No mode, action or revision changed. The earlier `cgWindowNotFound` error did not recur through this CLI path. The CLI sessions closed after the checks.

## The second review found two edge cases

The C dependency scan counted keycode names inside comments and literals. The fix recognizes identifier tokens after C line splicing. It skips comments, strings, character and numeric literals, and include paths. Eight host-compiled regressions cover incidental names before an enum that depends on a typedef. The compiled CLI also imported and generated the original comment reproduction. That generated source passed the host C compiler.

The proportional corner band could be shorter than its label. D-609 keeps readable text and the physical outline. A short cap offers its extra slot controls below the cap. Roomy caps retain their existing regions. The [component evidence](../research/ui-audit/ploopy-aplus/corner-labels/README.md) records both themes and three working slot clicks.

The broader QMK, board and card run passed 373 tests with 19 gated skips and no failures. The final web, documentation and C-import run passed 1338 tests with no failures. TypeScript and dependency checks passed. Logs are `/tmp/keyloom-aplus-token-corner-focused.log`, `/tmp/keyloom-aplus-token-corner-final-tests.log`, `/tmp/keyloom-aplus-token-corner-types-complete.log` and `/tmp/keyloom-aplus-token-corner-dependencies.log`.

Next action: merge PR 353, merge the updated release-please PR after its exact-head CI passes, then verify publication and both installed copies. The review server is stopped. Hardware acceptance requires an explicit flash request, then checks of both turn directions, all buttons, gestures and drag scrolling. Physical clockwise orientation remains unchecked. Shipping authorization does not authorize flashing.

## The shipping review found three more regressions

All ten PR checks passed on `f95ca9a1852d03d0c26c8b01b011e5fb34f1f7af`. The new review findings reproduced before their fixes:

- Include directives with block comments could move a typedef after its dependent enum. Both single-line and multiline comment cases now pass import, generation and host compilation.
- Retained aliases followed globals that used them. Definitions now precede those declarations. A new import-and-generate regression compiles the result with the host C compiler.
- A short flat cap could hide empty corner actions when it moved its controls below the cap. Present actions now retain their buttons, ghost labels and accessible names. An absent ghost label uses `Nothing`.

The compiled CLI imported and generated a combined include-comment and alias reproduction in scratch data. Its generated source passed the host C compiler. Evidence is `/tmp/keyloom-aplus-last-review-cli-generated`.

The real component fixture passed ten rendered cases. Computer Use through the Codex CLI opened both empty corner controls in case 9 and confirmed the corresponding action status. Both themes retained their accessible names. Screenshot processing failed, so this run does not add a screenshot-based clipping check. Evidence is `/tmp/keyloom-aplus-empty-corner-cua-fixed`. Computer Use and the temporary fixture server are closed. The earlier screenshots remain evidence for the unchanged cap geometry and styles.

The full follow-up suite passed 5081 tests, skipped 246 gated cases and failed none across 519 files. TypeScript passed. The dependency check exited successfully with its TypeScript 7 compatibility warning. React Doctor reported no issues. Changed-line lint flags the existing board and component `shape` names in test code. Those names retain the schema's public contract. Logs are `/tmp/keyloom-aplus-final-followup-full-tests.log`, `/tmp/keyloom-aplus-final-followup-types.log`, `/tmp/keyloom-aplus-final-followup-deps.log`, `/tmp/keyloom-aplus-final-followup-react.log` and `/tmp/keyloom-aplus-final-followup-slop.log`.

The compiled candidate also generated the preserved `A+ factory` config at `rev_01M7DREPP95RXBW3EW28STCC5Q`, with all four expected source files. Output is `/tmp/keyloom-aplus-last-review-aplus-generated`. It did not start a server or flash a device.
