# Encoder layers and lookup failures

Synthetic Corne fixture, served with `bun scripts/dev-encoders.ts 4493`. No model,
personal layout, keyboard access or flash. Captures use the real React editor.

Check both desktop (1440×900) and phone (390×844), light and dark:

- The encoder's key card shows clockwise/counterclockwise actions for the selected
  layer. Both alternate footprints change together; the other knob and layer stay
  unchanged. Turns and presses share Apply and the preserved-draft lifecycle.
- The failed-lookup reply leads with its outcome, not its tool log. The failure
  count stays explicit; its disclosure gives reasons and a retry path. Successful
  steps and working notes start closed. No unreported-cost footer or repeated
  current-layout caption takes space.

## Verification

- `test/firmware/zmk/encoder-layers.test.ts`: real change parser/validator,
  layer-specific generation/import, mouse presses, count/native rejection,
  legacy-default function loss, duplication and stale conflicts.
- `test/agent/encoder-layers.test.ts`: deterministic provider reads, finds, checks,
  proposes and applies a complete mouse/media change; no paid model.
- Compiled scratch CLI: import the synthetic fixture, propose/apply
  `setSensorBindings` plus relocated media presses, then generate firmware.
- Documentation closeout: the runnable blocks through export in
  [the encoder recipe](../../encoder-layers.md) were executed verbatim against
  fresh scratch data. Check/propose/apply/generate/export all passed. No docs-site
  configuration, deployment workflow or package script exists in this checkout.
- The first real firmware attempt was blocked because Docker was not running.
  On retry, `agent-work run -- keyloom --data-dir <scratch> build Encoders`
  succeeded for both halves, with no compile fixes. Device behavior and physical
  pointer motion remain untested; no keyboard was flashed.
- Full suite: 3,472 passed, 231 skipped, zero failed. Type checking passed and
  dependency-cruiser reported no module violations. It also warned that its
  TypeScript transpiler does not support the installed compiler version, so that
  check may miss TypeScript dependencies. Later focused editor/chat/contrast
  checks passed as well.
- Browser: edited and saved both left-knob footprints without changing the right
  knob or Numbers, discarded a fresh turn draft, opened failure reasons, and
  checked the controls at desktop and phone sizes in both themes. The phone
  sheet scrolls to the press and expands with its keyboard-operable grabber.

Generation uses ZMK's existing per-layer dispatch. Its ordinary 5 ms sensor tap
ends before the default 16 ms mouse tick; dedicated constant-speed encoder input
devices use a 5 ms tick and 20 ms tap without retuning ordinary mouse keys. This
has now compiled for both halves, but that is not a replacement for a hardware
test. Pins and the decision are in D-471.

## Firmware build receipt

- Build: `bld_01M6ACXF8GWXY7Z9DYMP59X0H8`, synthetic config revision
  `rev_01M6ABD1REZMCFKS2DASMMZKRT`, about 211 seconds.
- Targets: `corne_choc_pro_left`, `corne_choc_pro_right`; board and module pins
  unchanged. Base has horizontal/vertical mouse turns and left/right clicks;
  Numbers retains volume/brightness turns and mute/play-pause presses.
- The final central devicetree has distinct `sensor-bindings` tables for the two
  layers. Its Kconfig enables `ZMK_POINTING`, `ZMK_BEHAVIOR_INPUT_TWO_AXIS` and
  `ZMK_BEHAVIOR_SENSOR_ROTATE`.
- Bundle: 330,955 bytes, SHA-256
  `1c972f48a79aa9c8850d5f1317d127a0056d03625d919fd5b5c7e3cb2fac1255`.
- `left.uf2`: 483,840 bytes, 945 blocks, SHA-256
  `d42a951a9db97c24ba180203a90ed5fd450f150efc49916a0a018fdbb805fcf4`.
- `right.uf2`: 389,632 bytes, 761 blocks, SHA-256
  `2865bf55ec8e5203dd5e76e462f56963f83bda10edde876f53ba5158e85fa8e0`.
- Both files pass `inspectUf2` and `uf2Problem(..., "single")`, each with one
  application image of family `0xada52840`, not the bootloader family.
- The fixture covers movement and clicks, not scrolling or every admitted mouse
  action. No physical pointer or scroll behavior is established by this build.
- Non-fatal warnings include Zephyr device-level/GPREGRET deprecations,
  duplicate SoC unit addresses, the board's underglow brightness setting while
  RGB matrix disables underglow, and USB being disabled on the split peripheral.
  These were not treated as evidence of a pointer failure or silently changed.

## Published release and installation checks

The encoder/chat changes merged as `0a280600` and shipped in
[v0.67.0](https://github.com/planetaryescape/keyloom/releases/tag/v0.67.0), release
commit `a8b9fe99`. The release candidate passed dispatched CI at exact head
`45b55978`: 3,523 passed, 248 skipped, zero failed across 382 test files.
[Publishing workflow 41266685719](https://github.com/planetaryescape/keyloom/actions/runs/41266685719)
passed, including the native binaries and desktop bundle.

The official installer produced a scratch CLI reporting `0.67.0`. The published
binary passed the recipe's import/check/propose/apply/generate/export journey and
a JSON reimport retained the typed sensor pairs. All four CLI entries in
`SHA256SUMS` matched GitHub's asset digests. The desktop checksum and updater
manifest also matched this version.

A separate installation inspection on 2026-11-01 found the v0.67.0 app already on
disk. Its six files matched the checksum-verified final desktop ZIP, and strict
signature verification and Gatekeeper assessment passed. The archive SHA-256 was
`1d651e01d446e2d042feeafe47fd13fe1fc8de7065c6deb6e784ea6ba2ba124b`.
The installed app was not overwritten or restarted. Its existing processes
predated the final artifact, so activation and a new live app journey were not
established.

The standalone CLI and final desktop sidecar hashes differed because desktop
packaging signs the copied executable. The relevant byte comparison is against
the final desktop archive, not the standalone CLI checksum. Use
[the desktop verification recipe](../../verify-desktop-install.md) to repeat the
checks without starting the real app or touching a keyboard. No new flash,
physical pointer test or embedded-helper extraction test is claimed here.

The five shell blocks in the new desktop verification recipe were later run
unchanged on 2026-11-01 at 19:47 UTC. The app, bundled CLI and live server startup
record then reported `0.68.0`; its same-tag desktop archive checksum, installed
file comparison, signature and Gatekeeper checks passed. This is a separate
later observation. No app was installed, restarted or exercised through its UI
by that documentation check.
