# 15: Open questions and spikes

## Spikes (phase 0 and per rung; run against BK's real boards and exports)

For each spike, record the command or request, the output (with private data removed), the date and the conclusion in `docs/research/spikes/S<n>.md`. Then update the blueprint document it affects. Results are added here in place under `### S<n> result (<date>)`.

| # | Question | Why it matters | Affects | Blocks |
|---|---|---|---|---|
| S1 | Is BK's Moonlander rev A or rev B? Read the USB PID with `system_profiler SPUSBDataType -json` (`0x1969` is A, `0x1972` is B), or the bootloader's name in bootloader mode | Picks the QMK target and confirms Zapp's path | [05](05-firmware-qmk.md) | Rung 2 |
| S2 | Does rev B use a different MCU from rev A? The fork's `revb/keyboard.json` says STM32F303, while the closed mainline PR and Zapp's "alternate MCU" naming suggest otherwise | Whether rev B builds need anything beyond the fork's `revb` target | [05](05-firmware-qmk.md) | Rung 2, if S1 says rev B |
| S3 | What does an Oryx source export of BK's actual Moonlander layout contain? List every construct in `keymap.c`, `config.h` and `rules.mk`, including tap dances, macros, per-key terms, RGB and `qmk_modules` hooks | The QMK importer is written against this file | [05](05-firmware-qmk.md) | Rung 1 |
| S4 | Is Oryx's GraphQL endpoint usable for private layouts with a session, and is its schema stable over a few weeks? | A later "pull from Oryx" convenience (D-041) | [05](05-firmware-qmk.md) | Nothing in v1 |
| S5 | Does `util/docker_build.sh zsa/moonlander/<rev>:keyloom` work from the pinned `zsa/qmk_firmware` checkout, and how long do the first and later builds take? | The QMK build path (D-040) | [05](05-firmware-qmk.md), [01](01-architecture.md#firmware-toolchains) | Rung 2 |
| S6 | Does the Glove80 Layout Editor's `.keymap` export (a) parse with tree-sitter devicetree after keyloom's preprocessing, and (b) compile unmodified against `moergo-sc/zmk` `v26.09` through the template? | The ZMK import (D-037) and confidence in the build path | [06](06-firmware-zmk.md) | Rung 5 |
| S7 | How long do the first and later Glove80 Docker/Nix builds take, and does the Nix store persist between runs? | Whether "build" fits an edit-try loop | [06](06-firmware-zmk.md) | Rung 5 |
| S8 | Does the combined `glove80.uf2` boot correctly on both halves when copied to each boot drive? | The flash path (D-038) | [06](06-firmware-zmk.md) | Rung 5 |
| S9 | Round trip on the Moonlander: import BK's Oryx export, generate with no changes, build, flash. Does the board behave exactly as before, including tap-hold feel, macros, RGB and Oryx-specific modules? | Rung 2's trust. A no-op keyloom flash must not change BK's keyboard | [05](05-firmware-qmk.md) | Rung 2 |
| S10 | Do `web-tree-sitter` and the C and devicetree grammars' `.wasm` files load inside a `bun build --compile` binary? | Import has to work in the released binary, not only in dev | [01](01-architecture.md#release) | Rung 1 (C), rung 5 (devicetree) |
| S11 | Zapp's non-interactive behaviour: exact invocation, how it reports waiting for the bootloader, success and failure, and its exit codes | keyloom wraps it and has to report it accurately | [05](05-firmware-qmk.md#flash-uses-zsas-zapp-cli) | Rung 2 |

### S3 result (2026-10-15)

BK's layout "Synchronized" (`QxKPz`, revision `zLQ3Md`, `qmkVersion` 25.0) is public on Oryx, and its source zip downloads without a session. The full inventory and conclusions are in [../research/spikes/S3.md](../research/spikes/S3.md). The ones that change the design:

- QMK combos are keycode-based.
- Oryx's passthrough code refers to layer indices, so removing or reordering layers is an error until the generator can rewrite those references.
- `LAYER_STATE_8BIT` caps the layout at 8 layers.
- The build needs ZSA's `zsa/oryx` and `zsa/defaults` modules.

[05](05-firmware-qmk.md) and [07](07-change-validation.md) carry these as rules.

### S5 result (2026-10-15)

Both revisions build from BK's unchanged Oryx source with `docker run … ghcr.io/qmk/qmk_cli@sha256:b7d7fa8f… make zsa/moonlander/<rev>:<keymap>`, in about 100 s each. The binaries aren't byte-identical to Oryx's: keyloom skips the git and version info, and the keymap name differs. Behaviour equivalence is S9. See [../research/spikes/S5.md](../research/spikes/S5.md).

## Product questions for BK

| # | Question | Status |
|---|---|---|
| Q1 | Which licence? | **Answered 2026-10-15:** MIT |
| Q2 | npm's `keyloom` is taken by an unrelated password CLI. Keep the name and ship only through GitHub releases and `install.sh`, or rename? | **Answered 2026-10-15:** keep keyloom, with no npm package in v1 (D-034) |
| Q3 | Other users: bring their own Anthropic key only, or support other model providers? | Open; blueprint assumes their own Anthropic key only (D-031) |
| Q4 | Should keyloom carry a typing profile from one board to another ("adapt my Moonlander habits to the Glove80")? The assistant raised it; BK never took it up | Open; deferred, not rejected. Not in the roadmap |
| Q5 | Should keyloom ever learn from actual keystrokes (key-frequency stats), or only from what BK says? | Open; blueprint assumes only what BK says in v1 (D-035) |
| Q6 | When should keyloom ask whether a change worked out? | Open; blueprint assumes once, when the layout is next opened at least 7 days after the flash ([08](08-decision-memory.md#tried-outweighs-hypothesised)) |
| Q7 | Layouts in SQLite, or as files in a git repo BK can diff? | Open; blueprint assumes SQLite with `layout export` (D-032) |
| Q8 | After import, does keyloom own the layout, so BK stops editing in Oryx and the Layout Editor, with no write-back? | Open; blueprint assumes yes. Re-importing creates a new layout, not a merge |
| Q9 | Is BK's current Glove80 layout in MoErgo's Layout Editor, or in his own config repo? | Open; blueprint assumes the Layout Editor, so import reads its `.keymap` export (D-037) |
| Q10 | Which firmware is BK's Corne on, and should it be the first board added through the contribution format? | Open; blueprint assumes it's the first contributed board, after the car |
| Q11 | Which apps need Option–Option, and which shortcuts is Command–Shift for? | Open; rungs 3 and 4 need the real answers for their demos. The agent asks for them during the demo, so the blueprint doesn't assume any |
| Q12 | Is Docker an acceptable hard requirement for building? | Open; blueprint assumes yes ([01](01-architecture.md#firmware-toolchains)) |
| Q13 | v1 tested on macOS only? | Open; blueprint assumes macOS, with Linux expected to work but untested |
| Q14 | Public GitHub repo from rung 1, or private until the car? | **Answered 2026-10-15:** public from rung 1. BK authorised creating `planetaryescape/keyloom` |
