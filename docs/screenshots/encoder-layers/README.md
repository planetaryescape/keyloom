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
test. Pins and the decision are in D-469.

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
