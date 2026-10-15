# 15: Open questions and spikes

## Spikes (phase 0 and per rung; run against BK's real boards and exports)

For each spike, record the command or request, the output (with private data removed), the date and the conclusion in `docs/research/spikes/S<n>.md`. Then update the blueprint document it affects. Results are added here in place under `### S<n> result (<date>)`.

| # | Question | Why it matters | Affects | Blocks |
|---|---|---|---|---|
| S1 | Is BK's Moonlander rev A or rev B? Read the USB PID with `system_profiler SPUSBDataType -json` (`0x1969` is A, `0x1972` is B), or the bootloader's name in bootloader mode | Picks the QMK target and confirms Zapp's path. **Answered 2026-10-15:** rev A. BK's board reports vendor `0x3297`, product `0x1969` ("Moonlander Mark I"). keyloom's round trip of his layout builds for `reva` to the same bytes as his Oryx source (sha256 `ccd90fde…`, 67,268 bytes) | [05](05-firmware-qmk.md) | Rung 2 |
| S2 | Does rev B use a different MCU from rev A? The fork's `revb/keyboard.json` says STM32F303, while the closed mainline PR and Zapp's "alternate MCU" naming suggest otherwise | Whether rev B builds need anything beyond the fork's `revb` target | [05](05-firmware-qmk.md) | Not needed: S1 says rev A |
| S3 | What does an Oryx source export of BK's actual Moonlander layout contain? List every construct in `keymap.c`, `config.h` and `rules.mk`, including tap dances, macros, per-key terms, RGB and `qmk_modules` hooks | The QMK importer is written against this file | [05](05-firmware-qmk.md) | Rung 1 |
| S4 | Is Oryx's GraphQL endpoint usable for private layouts with a session, and is its schema stable over a few weeks? | A later "pull from Oryx" convenience (D-041) | [05](05-firmware-qmk.md) | Nothing in v1 |
| S5 | Does `util/docker_build.sh zsa/moonlander/<rev>:keyloom` work from the pinned `zsa/qmk_firmware` checkout, and how long do the first and later builds take? | The QMK build path (D-040) | [05](05-firmware-qmk.md), [01](01-architecture.md#firmware-toolchains) | Rung 2 |
| S6 | Does the Glove80 Layout Editor's `.keymap` export (a) parse with tree-sitter devicetree after keyloom's preprocessing, and (b) compile unmodified against `moergo-sc/zmk` `v26.09` through the template? **Answered 2026-10-15:** yes, with BK's own config (`bhekanik/glove80-zmk-config` `93b6ac8`, branch `42-key-map`). It imports with seven behaviours kept as written; import, generate, import is identical. Built unmodified with keyloom's pinned toolchain, it is byte-identical to the UF2 BK's own Action built (sha256 `767243265a93…`). keyloom's regenerated keymap builds to different bytes (`label` becomes `display-name`, node order) but behaves identically in the ZMK emulator (D-075) over every key and every home-row hold (170 reports). | The ZMK import (D-037) and confidence in the build path | [06](06-firmware-zmk.md) | Rung 5 |
| S7 | How long do the first and later Glove80 Docker/Nix builds take, and does the Nix store persist between runs? | Whether "build" fits an edit-try loop | [06](06-firmware-zmk.md) | Rung 5 |
| S8 | Does the combined `glove80.uf2` boot correctly on both halves when copied to each boot drive? | The flash path (D-038) | [06](06-firmware-zmk.md) | Rung 5 |
| S9 | Round trip on the Moonlander: import BK's Oryx export, generate with no changes, build, flash. Does the board behave exactly as before, including tap-hold feel, macros, RGB and Oryx-specific modules? | Rung 2's trust. A no-op keyloom flash must not change BK's keyboard. **Partly answered 2026-10-15:** BK's unchanged layout, built by keyloom with its marker (D-070), flashed to his rev A and was verified running over USB; a second build flashed with no keypress (D-072). BK typed on it the same day: "typing on the moonlander works". Answered for typing; a difference in tap-hold feel, macros or RGB that BK notices later reopens it. | [05](05-firmware-qmk.md) | Rung 2 |
| S10 | Do `web-tree-sitter` and the C and devicetree grammars' `.wasm` files load inside a `bun build --compile` binary? | Import has to work in the released binary, not only in dev | [01](01-architecture.md#release) | Rung 1 (C), rung 5 (devicetree) |
| S11 | Zapp's non-interactive behaviour: exact invocation, how it reports waiting for the bootloader, success and failure, and its exit codes | keyloom wraps it and has to report it accurately | [05](05-firmware-qmk.md#flash-uses-zsas-zapp-cli) | Rung 2 |
| S12 | Does the `keyloom-zmk` module build into the MoErgo fork at `ce69e85` for both Glove80 halves, give each half a serial port with keyloom's marker, and reboot it into its bootloader on `stty -f <port> 1200`? Does the 1201-baud relay put the right half in its bootloader, and return it to typing after 3 s when it's on battery? | The ZMK hands-free flash (D-095) | [17](17-keyboard-sync.md) | Rung 12 |
| S13 | Is BK's Corne on nice!nano v2 controllers (`INFO_UF2.TXT` on the boot drive), and does the module work there on ZMK v0.3.0, flashing the two `NICENANO` halves one after the other? | The Corne adapter (D-095) | [17](17-keyboard-sync.md) | Rung 12 (Corne part) |
| S14 | Does the Glove80's left half built with `studio-rpc-usb-uart` and `CONFIG_ZMK_STUDIO=y` connect to zmk.studio, and does the 1200-baud trigger still work on the shared port? | ZMK live writes (D-096) | [17](17-keyboard-sync.md) | Rung 17 |
| S15 | Does `DYNAMIC_KEYMAP_ENABLE` fit in ZSA's fork beside Oryx's modules on the Moonlander, does a set-keycode raw HID command change a key live, and does a reset after flash restore the compiled keymap? | Moonlander live writes (D-097) | [17](17-keyboard-sync.md) | Rung 17 |
| S16 | Can keyloom import BK's Oryx tap dances (TD0, TD1, DF0) into the `tapDance` kind and regenerate them so the QMK emulator gives the same reports, and does the ZMK `&td` with generated hold-taps match QMK's feel for tap, hold, double-tap and tap-then-hold? | Tap dance on both firmwares (D-093) | [16](16-key-editor.md) | Rung 14 |
| S17 | On Linux, does `stty -F` trigger the bootloader for a user in `dialout`, and does ModemManager need a udev rule? | Linux users (Q13) | [17](17-keyboard-sync.md) | Nothing; record before Linux support is claimed |
| S18 | Does anything of MoErgo's (Layout Editor, support tools) break when the Glove80's USB serial no longer starts with `moergo.com:`? | The Glove80 marker (D-095) | [17](17-keyboard-sync.md) | Rung 12 |
| S19 | With an OpenRouter key, does `option-option.eval.test.ts` pass through the Anthropic SDK with `baseURL` and `authToken`, and do the Tool Runner, fallback beta, `cache_control`, `usage.cost` and an out-of-credits error behave? | The OpenRouter provider (D-107) | [19](19-model-providers.md) | Rung 10 |
| S20 | Through a loopback MCP server, does Codex receive `propose_changes`'s full schema, run the validate-and-retry loop, refuse to write files, and can a `permissions` profile stop it reading keyloom's database? What does a four-message conversation cost in plan usage? | The Codex provider (D-108, D-110) | [19](19-model-providers.md) | Rung 10 (Codex part) |

### S3 result (2026-10-15)

BK's layout "Synchronized" (`QxKPz`, revision `zLQ3Md`, `qmkVersion` 25.0) is public on Oryx, and its source zip downloads without a session. The full inventory and conclusions are in [../research/spikes/S3.md](../research/spikes/S3.md). The ones that change the design:

- QMK combos are keycode-based.
- Oryx's passthrough code refers to layer indices, so removing or reordering layers is an error until the generator can rewrite those references.
- `LAYER_STATE_8BIT` caps the layout at 8 layers.
- The build needs ZSA's `zsa/oryx` and `zsa/defaults` modules.

[05](05-firmware-qmk.md) and [07](07-change-validation.md) carry these as rules.

### S5 result (2026-10-15)

Both revisions build from BK's unchanged Oryx source with `docker run … ghcr.io/qmk/qmk_cli@sha256:b7d7fa8f… make zsa/moonlander/<rev>:<keymap>`, in about 100 s each. The binaries aren't byte-identical to Oryx's: keyloom skips the git and version info, and the keymap name differs. Behaviour equivalence is S9. See [../research/spikes/S5.md](../research/spikes/S5.md).

### S11 result, partial (2026-10-15)

Zapp 1.0.2 rejects a non-DFU file before it looks for a device (exit 1). With a valid file it prints `Firmware loaded: …` and waits silently, with no timeout, and only SIGTERM ends it. keyloom wraps it with a 120 s timeout. Success and failure output still need BK's keyboard. See [../research/spikes/S11.md](../research/spikes/S11.md).

### S7 result (2026-10-15)

MoErgo's Dockerfile pre-builds four refs and ran out of space on BK's 99%-full Docker disk. keyloom's single-ref image (`infra/glove80/Dockerfile`) builds in 163 s at 5.22 GB, and firmware builds then take 16–20 s each. See [../research/spikes/S7.md](../research/spikes/S7.md).

### S6 result, partial (2026-10-15)

The Layout Editor export itself is still pending from BK, so (a) and (b) were run on the template's default keymap and a hand-written Layout-Editor-shaped keymap. (a) `tree-sitter-devicetree` 0.15.0 parses both with no error nodes. (b) keymaps keyloom writes from them compile unmodified against `moergo-sc/zmk` `v26.09` through the template's Docker route, 15 s per build. That includes a hold-tap profile, macros, combos, a built-in override and Kconfig settings. What stays open is whether the Layout Editor's own output has anything the parser or the importer doesn't expect. See [../research/spikes/S6.md](../research/spikes/S6.md).

### S8 result, partial (2026-10-15)

The combined `glove80.uf2` holds two images at the same addresses with different family IDs (`0x9807b007` and `0x9808b007`), which is how a UF2 bootloader skips blocks that aren't its own. Not run on a keyboard: nothing was flashed. See [../research/spikes/S8.md](../research/spikes/S8.md).

### S8 result (2026-10-15)

Yes. Flash `fl_01M5067Z2Y2JT3EDYD3JCY0NSC` copied keyloom's combined `glove80.uf2` (build `bld_01M4ZXEWMANN3V3H25Y28EC6JP`, BK's `42-key-map` keymap) to `GLV80RHBOOT` and then to the left half's boot drive with `keyloom flash --wait 15` (v0.10.1). Each bootloader took its own image and rebooted, both halves came back on USB as "Glove80 Right" and "Glove80 Left", and BK typed on the board: "typing works as you can see." An earlier attempt, `fl_01M5066BDXSVVD2CF3ZJT0JMN5`, failed with `EACCES` on the copy because the agent's sandbox blocked writes to `/Volumes`. A flash now explains that error, since macOS raises the same one for an app without Removable Volumes access.

### S19 result (2026-10-15)

Yes, with one change. The existing adapter, pointed at `https://openrouter.ai/api` with `authToken`, passed `option-option.eval.test.ts` on `anthropic/claude-opus-5.5`: the Tool Runner, streaming, adaptive thinking, effort and `cache_control` all worked. OpenRouter rejects the fallback beta's `fallbacks: "default"` (400, expects an array), so the beta is sent to Anthropic only. `usage.cost` arrives on the closing `message_delta` and not in the SDK's final message, so the adapter reads it from the stream event. The out-of-credits path is tested against scripted responses only. See [../research/spikes/S19.md](../research/spikes/S19.md).

### S20 result (2026-10-15)

Yes, with four findings that changed the lockdown. Through a loopback MCP server (the official SDK, bearer token per run, 127.0.0.1), the real Codex received `propose_changes`'s full schema and `option-option` passed on it, with two valid proposals. Codex still sees BK's global instructions unless `HOME` and `CODEX_HOME` are replaced; it lists the ChatGPT account's connected apps unless `features.apps` is off; it can call MCP tools only through code mode, so that host stays on, and code mode has no file, network or `require` access and its `apply_patch` is rejected by the read-only sandbox. The hostile-prompt eval passed. The validate-and-retry loop was tested only against a stand-in, and the plan usage of a conversation can't be read from Codex. See [../research/spikes/S20.md](../research/spikes/S20.md).

### S16 result (2026-10-15)

Yes for QMK, and no for DF0 on purpose. TD0 and TD1 import as tap dances (tap Hyper+Space or Alt+Space, double-tap `[` or `]`), and for ten key scripts each, Oryx's exported `keymap.c` and keyloom's regenerated source send identical reports on QMK's real core. DF0 stays native: its hold is `layer_move(5)`, which no slot action or hold-tap says without changing what it does. ZMK's `&td` with generated hold-taps types the same keys for tap, double-tap, hold and tap-then-hold on the Glove80 and the Corne, but the feel differs in six ways (double-tap fires on the second press, three taps cycle, an empty hold slot holds the key, a hold takes two terms, and others). See [../research/spikes/S16.md](../research/spikes/S16.md).

### S10 result, devicetree half (2026-10-15)

`web-tree-sitter` loads `tree-sitter-devicetree.wasm` inside a `bun build --compile` binary: the compiled `keyloom import --board moergo/glove80` and `generate` ran on the macOS arm64 binary with no extra flags. See [../research/spikes/S10.md](../research/spikes/S10.md).

## Product questions for BK

| # | Question | Status |
|---|---|---|
| Q1 | Which licence? | **Answered 2026-10-15:** MIT |
| Q2 | npm's `keyloom` is taken by an unrelated password CLI. Keep the name and ship only through GitHub releases and `install.sh`, or rename? | **Answered 2026-10-15:** keep keyloom, with no npm package in v1 (D-034) |
| Q3 | Other users: bring their own Anthropic key only, or support other model providers? | **Answered 2026-10-15** by D-106: Anthropic, OpenRouter or Codex |
| Q4 | Should keyloom carry a typing profile from one board to another ("adapt my Moonlander habits to the Glove80")? The assistant raised it; BK never took it up | Open; deferred, not rejected. Not in the roadmap |
| Q5 | Should keyloom ever learn from actual keystrokes (key-frequency stats), or only from what BK says? | Open; blueprint assumes only what BK says in v1 (D-035) |
| Q6 | When should keyloom ask whether a change worked out? | Open; blueprint assumes once, when the layout is next opened at least 7 days after the flash ([08](08-decision-memory.md#tried-outweighs-hypothesised)) |
| Q7 | Layouts in SQLite, or as files in a git repo BK can diff? | Open; blueprint assumes SQLite with `layout export` (D-032) |
| Q8 | After import, does keyloom own the layout, so BK stops editing in Oryx and the Layout Editor, with no write-back? | Open; blueprint assumes yes. Re-importing creates a new layout, not a merge |
| Q9 | Is BK's current Glove80 layout in MoErgo's Layout Editor, or in his own config repo? | Open; blueprint assumes the Layout Editor, so import reads its `.keymap` export (D-037) |
| Q10 | Which firmware is BK's Corne on, and should it be the first board added through the contribution format? | **Answered 2026-10-15:** BK: "the corne runs zmk". It was added as the first contributed board (PR #6). Before that, the blueprint assumed it's the first contributed board. Rung 8's recipes (D-049, D-050) cover a Corne on either firmware with data only |
| Q11 | Which apps need Option–Option, and which shortcuts is Command–Shift for? | Open; rungs 3 and 4 need the real answers for their demos. The agent asks for them during the demo, so the blueprint doesn't assume any |
| Q12 | Is Docker an acceptable hard requirement for building? | Open; blueprint assumes yes ([01](01-architecture.md#firmware-toolchains)) |
| Q13 | v1 tested on macOS only? | Open; blueprint assumes macOS, with Linux expected to work but untested |
| Q14 | Public GitHub repo from rung 1, or private until the car? | **Answered 2026-10-15:** public from rung 1. BK authorised creating `planetaryescape/keyloom` |
| Q15 | Is it acceptable that the generated keycode table carries identifiers, HID usages and short labels taken from QMK's GPL data files (D-047)? | Open; blueprint assumes yes, because these are interoperability facts and no QMK code or prose is copied |
| Q16 | Should auto-sync be on by default once a board has had one verified hands-free flash, so Apply always ends on the keyboard? | Open; built as assumed in rung 13 (on once proven, Pause in the header: D-094, D-162), pending BK's week of use |
| Q17 | For ZMK live writes, is building with `CONFIG_ZMK_STUDIO_LOCKING=n` acceptable, given that any local process could then change the keymap? | Open; blueprint assumes yes, matching D-070's trade-off. Only matters if rung 17 is built |
| Q18 | Would BK give up Oryx and Keymapp on the Moonlander for Vial's live tap dance, combos and tapping term? | Open; blueprint assumes no, and keeps ZSA's fork (D-097) |
| Q19 | Should clicking a key always open its panel, with keys sent to the chat only through "Asking about" chips? | Open; blueprint assumes yes (D-099) |
| Q20 | Should the Codex provider be offered to other users, given that OpenAI's terms for third-party apps using ChatGPT login couldn't be read? | Open; blueprint assumes BK's own machine only until the terms are checked (D-108) |
| Q21 | Should keyloom read API keys from the macOS Keychain itself, or keep taking them from the environment (`op run`, shell profile)? | Open; blueprint assumes the environment only, as today |
| Q22 | OpenRouter for Claude models only, or other models too (which needs a Chat Completions adapter)? | Open; blueprint assumes Claude only (D-107) |
| Q23 | Is Codex acceptable without token streaming and without a cost figure? | Open; blueprint assumes yes, showing whole messages and tokens only (D-108) |
