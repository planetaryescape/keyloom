# Both A+ knobs expose separate turn actions

Checked on 14 November 2026 with Computer Use in Dia. Source: `fix/ploopy-aplus-wheel-controls` at `b3c0091b0ebc9e327459bf3ffabe79b9158c3519`. Base: `origin/main` at `3d0b79d425e24ef5e9cc9ef0718dfc4d21f8ef6c`.

The compiled candidate serves the scratch `A+ wheel smoke` config. Browser Apply changed only that scratch config. No sync or flash ran.

| Capture | Viewport | Observed result |
|---|---|---|
| [Desktop dark](desktop-dark.png) | 1440 × 900 | Left knob has factory/custom mode and separate volume directions. The press keeps its circular cap. |
| [Desktop light](desktop-light.png) | 1440 × 900 | Labels and native select controls fit the card. |
| [Phone dark](phone-dark.png) | 390 × 844 | Both turn directions fit in the expanded sheet. |
| [Phone light](phone-light.png) | 390 × 844 | Mode, both directions and the separate press fit without horizontal clipping. |

The captures use device pixel ratio 2. Desktop files are 2880 × 1800 pixels. Phone files are 780 × 1688 pixels. Up Arrow on the phone sheet handle expands the existing sheet.

## The saved change survives a separate CLI read

In the browser, clockwise changed from Volume Up to Page Down. The editor required an explicit drop choice for Volume Up. Apply saved revision `rev_01M7DSMDN12T793F8FP0AT1AW9`. A CLI read showed Page Down, unchanged Volume Down, unchanged right-knob scrolling and unchanged Control-layer turns. Browser Undo restored both volume directions at `rev_01M7DSQ8JW6YD1WHQ3S3QKV9DQ`.

The earlier CLI change used the shared check, propose and apply path. Revision `rev_01M7DS9ZZCAANS97YQK296RADN` built as `bld_01M7DSA0S83RTTXS68CN2R7K35`. The UF2 has 123392 bytes and SHA-256 `7defe45a05ee233c3fb73b60daa2a721eb8f00cdbef9a3f4e2c305f21780a07b`.

The [verification receipt](verification.json) records these values. The local firmware log is `/tmp/keyloom-aplus-wheels-cli-check/logs/build-bld_01M7DSA0S83RTTXS68CN2R7K35.log`.

## C behavior and preservation checks pass

The native C harness checks positive and negative turn dispatch, multiple ticks, layer changes, factory fall-through, held knobs and deadzone filtering. Source tests check editable export/reimport, factory restoration and refusal of changed callbacks or generated helpers. The broader run passed 842 tests with 19 gated skips. A later 51-test run covers the loss-confirmation fix and legend changes. Seven documentation checks also passed.

Physical wheel direction and behavior after flashing remain unchecked. The six problem badges come from the factory layout's existing reachability warnings. This test did not remove those layers or change their navigation.

The [support handover](../../../../issues/ploopy-aplus-support.md) owns the current preview command and next action.
