# 15: Open questions and spikes

## Spikes (phase 0 and per rung; run against BK's real boards and exports)

For each spike, record the command or request, the output (with private data removed), the date and the conclusion in `docs/research/spikes/S<n>.md`. Then update the blueprint document it affects. Results are added here in place under `### S<n> result (<date>)`.

| # | Question | Why it matters | Affects | Blocks |
|---|---|---|---|---|
| S1 | Is BK's Moonlander rev A or rev B? Read the USB PID with `system_profiler SPUSBDataType -json` (`0x1969` is A, `0x1972` is B), or the bootloader's name in bootloader mode | Picks the QMK target and confirms Zapp's path. **Answered 2026-10-15:** rev A. BK's board reports vendor `0x3297`, product `0x1969` ("Moonlander Mark I"). keyloom's round trip of his layout builds for `reva` to the same bytes as his Oryx source (sha256 `ccd90fde…`, 67,268 bytes) **Conflict, not decided (noted 2026-10-17):** the S42 result below says BK's running Moonlander is `revb`, `0x3297:0x1972`, which contradicts this answer. Settling it needs the output of `system_profiler SPUSBDataType -json` from BK's Moonlander (product ID and product string). Until then the rev A claim here and the rev B claim in S42 are both unverified. The evidence is in [../research/spikes/S1.md](../research/spikes/S1.md). | [05](05-firmware-qmk.md) | Rung 2 |
| S2 | Does rev B use a different MCU from rev A? The fork's `revb/keyboard.json` says STM32F303, while the closed mainline PR and Zapp's "alternate MCU" naming suggest otherwise | Whether rev B builds need anything beyond the fork's `revb` target | [05](05-firmware-qmk.md) | Not needed: S1 says rev A |
| S3 | What does an Oryx source export of BK's actual Moonlander layout contain? List every construct in `keymap.c`, `config.h` and `rules.mk`, including tap dances, macros, per-key terms, RGB and `qmk_modules` hooks | The QMK importer is written against this file | [05](05-firmware-qmk.md) | Rung 1 |
| S4 | Is Oryx's GraphQL endpoint usable for private layouts with a session, and is its schema stable over a few weeks? | A later "pull from Oryx" convenience (D-041) | [05](05-firmware-qmk.md) | Nothing in v1 |
| S5 | Does `util/docker_build.sh zsa/moonlander/<rev>:keyloom` work from the pinned `zsa/qmk_firmware` checkout, and how long do the first and later builds take? | The QMK build path (D-040) | [05](05-firmware-qmk.md), [01](01-architecture.md#firmware-toolchains) | Rung 2 |
| S6 | Does the Glove80 Layout Editor's `.keymap` export (a) parse with tree-sitter devicetree after keyloom's preprocessing, and (b) compile unmodified against `moergo-sc/zmk` `v26.09` through the template? **Answered 2026-10-15:** yes, with BK's own config (`bhekanik/glove80-zmk-config` `93b6ac8`, branch `42-key-map`). It imports with seven behaviours kept as written; import, generate, import is identical. Built unmodified with keyloom's pinned toolchain, it is byte-identical to the UF2 BK's own Action built (sha256 `767243265a93…`). keyloom's regenerated keymap builds to different bytes (`label` becomes `display-name`, node order) but behaves identically in the ZMK emulator (D-075) over every key and every home-row hold (170 reports). | The ZMK import (D-037) and confidence in the build path | [06](06-firmware-zmk.md) | Rung 5 |
| S7 | How long do the first and later Glove80 Docker/Nix builds take, and does the Nix store persist between runs? | Whether "build" fits an edit-try loop | [06](06-firmware-zmk.md) | Rung 5 |
| S8 | Does the combined `glove80.uf2` boot correctly on both halves when copied to each boot drive? | The flash path (D-038) | [06](06-firmware-zmk.md) | Rung 5 |
| S9 | Round trip on the Moonlander: import BK's Oryx export, generate with no changes, build, flash. Does the board behave exactly as before, including tap-hold feel, macros, RGB and Oryx-specific modules? | Rung 2's trust. A no-op keyloom flash must not change BK's keyboard. **Partly answered 2026-10-15:** BK's unchanged layout, built by keyloom with its marker (D-070), flashed to his rev A and was verified running over USB; a second build flashed with no keypress (D-072). BK typed on it the same day: "typing on the moonlander works". Answered for typing; a difference in tap-hold feel, macros or RGB that BK notices later reopens it. | [05](05-firmware-qmk.md) | Rung 2 |
| S10 | Do `web-tree-sitter` and the C and devicetree grammars' `.wasm` files load inside a `bun build --compile` binary? | Import has to work in the released binary, not only in dev **Answered 2026-10-15:** yes for both grammars. The C half: the compiled macOS arm64 binary ran `import`, `layout show`, `boards list` and `doctor` from an unrelated directory with the repo's `node_modules/`, `boards/` and `src/` hidden, with no extra flags ([../research/spikes/S10.md](../research/spikes/S10.md)). The devicetree half is in S10's result below. Linux x64 was built but not run. | [01](01-architecture.md#release) | Rung 1 (C), rung 5 (devicetree) |
| S11 | Zapp's non-interactive behaviour: exact invocation, how it reports waiting for the bootloader, success and failure, and its exit codes | keyloom wraps it and has to report it accurately **Partly answered 2026-10-15:** invocation, the wait with no timeout, and the file check are recorded ([S11.md](../research/spikes/S11.md)). The success path was exercised when S9's flashes went through Zapp and were verified; the text Zapp prints on success and on a mid-flash failure, and whether it refuses a mismatched DFU suffix, are still not recorded. | [05](05-firmware-qmk.md#flash-uses-zsas-zapp-cli) | Rung 2 |
| S12 | Does the `keyloom-zmk` module build into the MoErgo fork at `ce69e85` for both Glove80 halves, give each half a serial port with keyloom's marker, and reboot it into its bootloader on `stty -f <port> 1200`? Does the 1201-baud relay put the right half in its bootloader, and return it to typing after 3 s when it's on battery? | The ZMK hands-free flash (D-095) **Partly answered 2026-10-16:** the module builds and both halves restart at 1200 baud; one flash of both halves was verified. The relay, battery behaviour and two fault-free flashes in a row were not observed (result below). | [17](17-keyboard-sync.md) | Rung 12 |
| S13 | Is BK's Corne on nice!nano v2 controllers (`INFO_UF2.TXT` on the boot drive), and does the module work there on ZMK v0.3.0, flashing the two `NICENANO` halves one after the other? | The Corne adapter (D-095) | [17](17-keyboard-sync.md) | Rung 12 (Corne part) |
| S14 | Does the Glove80's left half built with `studio-rpc-usb-uart` and `CONFIG_ZMK_STUDIO=y` connect to zmk.studio, and does the 1200-baud trigger still work on the shared port? | ZMK live writes (D-096) | [17](17-keyboard-sync.md) | Rung 17 |
| S15 | Does `DYNAMIC_KEYMAP_ENABLE` fit in ZSA's fork beside Oryx's modules on the Moonlander, does a set-keycode raw HID command change a key live, and does a reset after flash restore the compiled keymap? | Moonlander live writes (D-097) | [17](17-keyboard-sync.md) | Rung 17 |
| S16 | Can keyloom import BK's Oryx tap dances (TD0, TD1, DF0) into the `tapDance` kind and regenerate them so the QMK emulator gives the same reports, and does the ZMK `&td` with generated hold-taps match QMK's feel for tap, hold, double-tap and tap-then-hold? | Tap dance on both firmwares (D-093) | [16](16-key-editor.md) | Rung 14 |
| S17 | On Linux, does `stty -F` trigger the bootloader for a user in `dialout`, and does ModemManager need a udev rule? | Linux users (Q13) | [17](17-keyboard-sync.md) | Nothing; record before Linux support is claimed |
| S18 | Does anything of MoErgo's (Layout Editor, support tools) break when the Glove80's USB serial no longer starts with `moergo.com:`? | The Glove80 marker (D-095) | [17](17-keyboard-sync.md) | Rung 12 |
| S19 | With an OpenRouter key, does `option-option.eval.test.ts` pass through the Anthropic SDK with `baseURL` and `authToken`, and do the Tool Runner, fallback beta, `cache_control`, `usage.cost` and an out-of-credits error behave? | The OpenRouter provider (D-107) | [19](19-model-providers.md) | Rung 10 |
| S20 | Through a loopback MCP server, does Codex receive `propose_changes`'s full schema, run the validate-and-retry loop, refuse to write files, and can a `permissions` profile stop it reading keyloom's database? What does a four-message conversation cost in plan usage? | The Codex provider (D-108, D-110) | [19](19-model-providers.md) | Rung 10 (Codex part) |
| S21 | Can MoErgo's ZMK fork at `ce69e85` give each Glove80 key its own colour on each layer, the way the Moonlander's ledmap does? | Whether the Glove80 gets lighting (D-194, D-225) | [20](20-cross-board.md) | Rung 19 |
| S30 | kanata 1.12.0 on BK's MacBook built-in keyboard only, with driver 6.5.0: remapped built-in, untouched external boards, permissions understood, exit chord works, TCP reload with wait returns ok | kanata as the MacBook target (D-231) | [21](21-macbook-keyboard.md) | Rung 20 |
| S31 | kanata alongside Karabiner-Elements, with Karabiner ignoring the built-in: output arrives once, Karabiner still works elsewhere | Coexistence (D-231) | [21](21-macbook-keyboard.md) | Rung 20 |
| S32 | What kanata sees for fn/globe, the F-row, Esc, Touch ID and arrows on BK's MacBook | The board's key list | [21](21-macbook-keyboard.md) | Rung 20 |
| S33 | kanata's simulator against keyloom's QMK emulator for home-row-mod scripts: same results, or documented per option. **Answered 2026-10-18:** 144 of 150 pairs agree, the 6 others are two kanata semantics, and one translation bug (`CHORDAL_HOLD` alone) was fixed (result below) | Hold-tap feel on the MacBook (D-231, D-390) | [21](21-macbook-keyboard.md) | Rung 20 |
| S34 | Option–Option through kanata reaches the app BK needs it for | BK's first problem (D-025) on the MacBook | [21](21-macbook-keyboard.md) | Rung 20 |
| S35 | Importing BK's existing Karabiner rules (Space layer, home-row mods, six combos, Hyper) round-trips through keyloom's recognisers | D-232 | [21](21-macbook-keyboard.md) | Rung 20 |
| S36 | The 77-key ANSI geometry and position order on BK's MacBook, by pressing every key under `kanata -d` | The board's geometry | [21](21-macbook-keyboard.md) | Rung 20 |
| S40 | The Corne's committed `fingers` against the column-from-home-row rule: which is wrong? **Answered 2026-10-16:** the committed table was one column off and was fixed in rung 19 (D-227); the rule was right, and `test/boards/derive/heuristics.test.ts` reproduces it: 132 of 132 on the Moonlander and Glove80 and 36 of 36 on the Corne (result below) | Finger heuristics for new boards (D-236) | [22](22-new-keyboard.md) | Rung 21 |
| S41 | Can QMK hands-free flashing (D-070) extend beyond ZSA boards, e.g. through Vial's jump or a generic raw-HID packet? | Hands-free on new QMK boards | [22](22-new-keyboard.md) | Nothing; record before claiming it |
| S42 | Detection on BK's three boards: does keyloom name each from USB alone, and what does it ask when it can't? **Part answered 2026-10-16:** the Glove80, on the real bus; the Moonlander and Corne were not plugged in (result below) See the conflict with S1 on the Moonlander's revision. | D-236 | [22](22-new-keyboard.md) | Rung 21 |
| S43 | Does a derived board's default keymap build from the pinned tree, and are the submodule lists, build images and (for ZMK) hardware-model-v2 controller names the generator writes right? **Answered 2026-10-17:** five boards build; the one correction was `lib/lufa` for every ChibiOS board (result below) | Derived boards build (D-333, D-368) | [22](22-new-keyboard.md) | Rung 21 part 2 |
| S50 | Does a keyloom raw-HID key-event stream (position, press/release, timer) fit beside Oryx's modules on the Moonlander, keep up at fast typing without dropping events, and stop on timeout or disconnect? | Lab capture on QMK (D-281) | [24](24-typing-lab.md) | Rung 22 |
| S51 | Does the keyloom-zmk module stream position events from the Glove80's central for both halves in order, and what is the split latency? | Lab capture on ZMK (D-281) | [24](24-typing-lab.md) | Rung 22 |
| S52 | Can kanata's debug output give a usable event trace on the MacBook? | Lab on the MacBook | [24](24-typing-lab.md) | Nothing yet |
| S53 | Does replaying a real recorded trace through the QMK and ZMK emulators reproduce what BK's keyboard actually sent (same misfires)? | Trust in suggestions (D-282) | [24](24-typing-lab.md) | Rung 22 |

### S3 result (2026-10-15)

BK's layout "Synchronized" (`QxKPz`, revision `zLQ3Md`, `qmkVersion` 25.0) is public on Oryx, and its source zip downloads without a session. The full inventory and conclusions are in [../research/spikes/S3.md](../research/spikes/S3.md). The ones that change the design:

- QMK combos are keycode-based.
- Oryx's passthrough code refers to layer indices. D-360 has the generator rewrite the references the importer can prove; a layout stored before that keeps the error until its firmware is imported again.
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

### S40 and S42 results (2026-10-16, rung 21 part 1)

**S40, finger heuristics.** Run on `origin/main` at `f0ac50d` plus the rung's changes, by `test/boards/derive/heuristics.test.ts`, deriving each of BK's three boards from its firmware source file and comparing with the committed `board.json`:

| Rule | Moonlander | Glove80 | Corne | Total |
|---|---|---|---|---|
| Hands (widest x-gap) | 72/72 | 80/80 | 42/42 | 194/194 |
| Thumbs (small column, or more than 1.2 below) | 8/8 | 12/12 | 6/6 | 26/26, no false thumbs |
| Fingers (apex column is the middle finger) | 64/64 | 68/68 | 36/36 | 168/168 (132/132 without the Corne) |
| Rows (key linked to the key level with it) | 5/5 | 6/6 | 3/3 | all, thumbs apart |
| Mirror pairs | 36/36 | 40/40 | 21/21 | all |

Hands, thumbs and fingers are the research's rules unchanged. Rows and mirror pairs are new in this part, and the first version of the rows rule, clustering raw key heights, merged the Glove80's six rows into one; linking each key to the one level with it in the next column fixed that, and the half-unit drop of the Glove80's pinky columns needs the "level with the key above" rule. One caveat: the committed Moonlander files two thumb keys (59, 60) under `lower`; the rule calls them thumbs, as the finger table does.

**S42, detection.** `keyloom keyboard detect` on BK's machine (macOS, Darwin 27), with `--data-dir` pointing at an empty scratch directory:

```
Glove80 Left   0x16c0:0x27db  v0x0305  MoErgo     your Glove80 (moergo/glove80)
Glove80 Right  0x16c0:0x27d9  v0x0305  MoErgo     your Glove80 (moergo/glove80)
```

- The Glove80: both halves are named from USB alone. The index gives `zmk:glove80` at 95% for the left half (product string "Glove80 Left" and the board's own ID), and the board is already keyloom's, so detection stops there. The ID `0x16c0:0x27db` is also one of 11 V-USB IDs QMK boards share, which is why the list drops candidates that only share an ID once one fits.
- The Moonlander: not plugged in during the run. By the index alone, `0x3297:0x1969` names `zsa/moonlander` uniquely (a test). BK's running Moonlander is `revb`, `0x3297:0x1972`, which upstream QMK's data does not list (a ZSA fork ID, as the research found), so it is recognised by the board definition's `detect`, not by the index.
- The Corne: not plugged in. With a fake bus, `Corne` over ZMK's default ID gives `zmk:corne` at 80%, and keyloom's own Corne is then recognised as known. The right half's product string is still unobserved (spike 4). The QMK Corne is a list: `crkbd/rev1` and `crkbd/r2g` share every ID.
- What it asks when it can't: a list of candidates with the reason each fits, a ZMK keyboard whose string names nothing as `unknown` with `--search`, and for a shared or placeholder ID a list that is never reduced to one.

### S43 result (2026-10-17, rung 21 part 2)

Four derived QMK boards and a derived ZMK Corne build from the pinned trees in Docker, with one correction to the generator: every ChibiOS board needs `lib/lufa` as well. The QMK image is `ghcr.io/qmk/qmk_cli@sha256:b7d7fa8f…` and the ZMK one `zmkfirmware/zmk-build-arm@sha256:edb1c953…`, both as `pins.ts` has them. Each board was written by `keyloom keyboard add` and built by `keyloom build` through `agent-work`, on a blank config from `keyloom keyboard put`; nothing was flashed. Details, times and the failing log line are in [../research/spikes/S43.md](../research/spikes/S43.md).

| Board | Bootloader | Submodules | Result |
|---|---|---|---|
| `planck/rev4` | atmel-dfu | `lib/lufa` | `.hex`, 60,780 bytes, 31 s |
| `crkbd/rev1` | caterina | `lib/lufa` | `.hex`, 57,458 bytes, 36 s |
| `ferris/0_2/base` | stm32-dfu | as first written, without `lib/lufa` | failed: `lib/lufa/LUFA/Drivers/USB/Class/Common/HIDClassCommon.h: No such file or directory` |
| `ferris/0_2/base` | stm32-dfu | with `lib/lufa` | `.bin`, 28,184 bytes, 47 s |
| `crkbd/rev4_1/standard` | rp2040 | with `lib/lufa` | `.uf2`, 119,296 bytes, 80 s |
| ZMK `corne` on `nice_nano//zmk` | uf2-drives | none (west) | `left.uf2` and `right.uf2`, 617 s with the image already pulled and ZMK fetched by west |

The ZMK build used the generator's output unchanged: `west` reported `Board: nice_nano, Revision: 2.0.0, qualifiers: nrf52840/zmk`, so the hardware-model-v2 name is right for the pinned ZMK. The RP2040 board was built only with `lib/lufa`; whether it also builds without it was not tried.

### S35 result (2026-10-16)

Yes. A synthetic Karabiner file with BK's patterns imports as a Space-hold layer, hold-taps (home-row mods and Hyper), combos and key remaps; a switched-off rule and one keyloom can't read are listed. BK's own file was imported once, read-only, with the same result. The file was read and never written. See [../research/spikes/S35.md](../research/spikes/S35.md).

### S33 result (2026-10-18)

The same 15 home-row-mod scenarios, with 10 QMK option sets, went through keyloom's QMK emulator (BK's Moonlander layout, QMK's real core in Docker) and through kanata's simulator (the MacBook layout keyloom generates from the translated profile). The release has no simulator, so `kanata_simulated_input` was built from `v1.12.0` (`02242ef`) in `~/.cache/keyloom-s33`, through `agent-work`, and never touched a keyboard. 144 of 150 pairs give the same reports within 10 ms. The 6 that don't are two kanata semantics: `tap-repress-ms` counts from the first press where QMK's `QUICK_TAP_TERM` counts from the release, and kanata keeps a tapped key down until a following hold-tap key resolves. One translation bug: QMK `CHORDAL_HOLD` alone was `tap-hold-opposite-hand`, which holds the moment an opposite-hand key goes down; it is now `tap-hold-tap-keys` over the key's own hand (D-390). The test is `KEYLOOM_KANATA_SIM=<binary> bun test test/firmware/kanata/sim.test.ts`, with no Docker. Details and the table are in [../research/spikes/S33.md](../research/spikes/S33.md).

### S30, S31, S32 and S36: runbooks written, not run (2026-10-16)

[S30](../research/spikes/S30.md) and [S31](../research/spikes/S31.md) need BK at the keyboard and an administrator password. [S32](../research/spikes/S32.md) and [S36](../research/spikes/S36.md) need him to press keys under `kanata -d`. The MacBook board's geometry says `verified: false` until S36, and the F-row and fn names are assumptions until S32.

### S21 result (2026-10-15)

No. At `ce69e85` the Glove80's underglow fills one buffer with one effect, and the only per-LED colours are fixed status LEDs on the left half, with a magenta layer indicator. A key's own colour on a layer exists only in the open community pull request `moergo-sc/zmk#36`, which is on another base and unmerged. The Glove80 therefore gets no lighting model; the board says why and the agent says it plainly. See [../research/spikes/S21.md](../research/spikes/S21.md).

### S19 result (2026-10-15)

Yes, with one change. The existing adapter, pointed at `https://openrouter.ai/api` with `authToken`, passed `option-option.eval.test.ts` on `anthropic/claude-opus-5.5`: the Tool Runner, streaming, adaptive thinking, effort and `cache_control` all worked. OpenRouter rejects the fallback beta's `fallbacks: "default"` (400, expects an array), so the beta is sent to Anthropic only. `usage.cost` arrives on the closing `message_delta` and not in the SDK's final message, so the adapter reads it from the stream event. The out-of-credits path is tested against scripted responses only. See [../research/spikes/S19.md](../research/spikes/S19.md).

### S20 result (2026-10-15)

Yes, with four findings that changed the lockdown. Through a loopback MCP server (the official SDK, bearer token per run, 127.0.0.1), the real Codex received `propose_changes`'s full schema and `option-option` passed on it, with two valid proposals. Codex still sees BK's global instructions unless `HOME` and `CODEX_HOME` are replaced; it lists the ChatGPT account's connected apps unless `features.apps` is off; it can call MCP tools only through code mode, so that host stays on, and code mode has no file, network or `require` access and its `apply_patch` is rejected by the read-only sandbox. The hostile-prompt eval passed. The validate-and-retry loop was tested only against a stand-in, and the plan usage of a conversation can't be read from Codex. See [../research/spikes/S20.md](../research/spikes/S20.md).

### S16 result (2026-10-15)

Yes for QMK, and no for DF0 on purpose. TD0 and TD1 import as tap dances (tap Hyper+Space or Alt+Space, double-tap `[` or `]`), and for ten key scripts each, Oryx's exported `keymap.c` and keyloom's regenerated source send identical reports on QMK's real core. DF0 stays native: its hold is `layer_move(5)`, which no slot action or hold-tap says without changing what it does. ZMK's `&td` with generated hold-taps types the same keys for tap, double-tap, hold and tap-then-hold on the Glove80 and the Corne, but the feel differs in six ways (double-tap fires on the second press, three taps cycle, an empty hold slot holds the key, a hold takes two terms, and others). See [../research/spikes/S16.md](../research/spikes/S16.md).

### S12 result, partly run (2026-10-16)

Read from keyloom's logs of three flashes of BK's Glove80 on 2026-10-16 (no one watched the halves), plus the USB bus and `keyloom sync status` on 2026-10-17. Full account in [../research/spikes/S12.md](../research/spikes/S12.md).

- **Observed:** the module is in the firmware (both halves report `keyloom/<build key>-<L|R>:GLV80-<chip ID>`). Closing each half's serial port at 1200 baud put it in its bootloader with no keypress, five times out of five (`flash-fl_01M53CV63C0VKB6T0NA58E1NTV.log`, `flash-fl_01M53DJ27J6QHMJWYEJSARZB66.log`, `flash-fl_01M53EDXRDJ2QFJYNYDNR62NH7.log` in `~/.local/share/keyloom/logs/`). The third flash wrote both halves and verified both on build `bld_01M53EDCCAK3RHBAFNJPGEVV5Y` (37.3 s from Apply to verified). Today both halves report that build and the Glove80 is `in_sync`.
- **Faults the runs found, now fixed:** verification failed a half that had come back on USB before its serial port (`47de622`, v0.34.6); a write ended in `ENXIO` after the half took the file and rebooted (`acbfa07`, v0.34.7); macOS refused the first write to a fresh boot drive with `EACCES` (`84d0b29`, v0.34.3, retried).
- **Not observed:** two fault-free hands-free flashes in a row (the one complete flash needed an `EACCES` retry on each half); the 1201-baud relay and a right half on battery; typing and Bluetooth after the flash; the Corne (S13).
- **Rung 12's done-when is therefore not met.** It needs one more clean Glove80 flash, and the Corne.

### S10 result, devicetree half (2026-10-15)

`web-tree-sitter` loads `tree-sitter-devicetree.wasm` inside a `bun build --compile` binary: the compiled `keyloom import --board moergo/glove80` and `generate` ran on the macOS arm64 binary with no extra flags. See [../research/spikes/S10.md](../research/spikes/S10.md).

## Product questions for BK

| # | Question | Status |
|---|---|---|
| Q1 | Which licence? | **Answered 2026-10-15:** MIT. **Changed 2026-10-16:** AGPL-3.0-or-later (D-342) |
| Q2 | npm's `keyloom` is taken by an unrelated password CLI. Keep the name and ship only through GitHub releases and `install.sh`, or rename? | **Answered 2026-10-15:** keep keyloom, with no npm package in v1 (D-034) |
| Q3 | Other users: bring their own Anthropic key only, or support other model providers? | **Answered 2026-10-15** by D-106: Anthropic, OpenRouter or Codex |
| Q4 | Should keyloom carry a typing profile from one board to another ("adapt my Moonlander habits to the Glove80")? The assistant raised it; BK never took it up | **Answered 2026-10-15** by D-220, narrowed to copying a named thing: BK: "it should be possible for me to say copy this thing from my other keyboard and apply it here". Rung 19 |
| Q5 | Should keyloom ever learn from actual keystrokes (key-frequency stats), or only from what BK says? | **Answered 2026-10-16** by D-280: yes, in an opt-in typing session BK starts |
| Q6 | When should keyloom ask whether a change worked out? | Built as assumed: asked once, a week after the first successful flash that carried the decision, never again once asked (`src/memory/choices.ts:113-131`, `OUTCOME_QUESTION_DELAY_MS`). Open until BK says the timing suits him ([08](08-decision-memory.md#tried-outweighs-hypothesised)) |
| Q7 | Layouts in SQLite, or as files in a git repo BK can diff? | Open; blueprint assumes SQLite with `layout export` (D-032) |
| Q8 | After import, does keyloom own the layout, so BK stops editing in Oryx and the Layout Editor, with no write-back? | Open; blueprint assumes yes. Re-importing creates a new layout, not a merge |
| Q9 | Is BK's current Glove80 layout in MoErgo's Layout Editor, or in his own config repo? | **Answered 2026-10-15:** neither. BK's Glove80 layout is in his own config repo, `bhekanik/glove80-zmk-config` at `93b6ac8`, branch `42-key-map` (S6 row above). Import reads its `.keymap`, which is the format the Layout Editor exports (D-037) |
| Q10 | Which firmware is BK's Corne on, and should it be the first board added through the contribution format? | **Answered 2026-10-15:** BK: "the corne runs zmk". It was added as the first contributed board (PR #6). Before that, the blueprint assumed it's the first contributed board. Rung 8's recipes (D-049, D-050) cover a Corne on either firmware with data only |
| Q11 | Which apps need Option–Option, and which shortcuts is Command–Shift for? | Open; rungs 3 and 4 need the real answers for their demos. The agent asks for them during the demo, so the blueprint doesn't assume any |
| Q12 | Is Docker an acceptable hard requirement for building? | Open; blueprint assumes yes ([01](01-architecture.md#firmware-toolchains)) |
| Q13 | v1 tested on macOS only? | Open; blueprint assumes macOS, with Linux expected to work but untested |
| Q14 | Public GitHub repo from rung 1, or private until the car? | **Answered 2026-10-15:** public from rung 1. BK authorised creating `planetaryescape/keyloom` |
| Q15 | Is it acceptable that the generated keycode table carries identifiers, HID usages and short labels taken from QMK's GPL data files (D-047)? | Open; blueprint assumes yes, because these are interoperability facts and no QMK code or prose is copied |
| Q16 | Should auto-sync be on by default once a board has had one verified hands-free flash, so Apply always ends on the keyboard? | Built as assumed in rung 13 (v0.14.0): on once a hands-free flash is verified, Pause in the header (D-094, D-162; `src/app/sync-state.ts`). On 2026-10-17 `keyloom sync status` shows auto-sync on and proven for the Glove80 and the MacBook. Open until BK's week of use says it suits him |
| Q17 | For ZMK live writes, is building with `CONFIG_ZMK_STUDIO_LOCKING=n` acceptable, given that any local process could then change the keymap? | Open; blueprint assumes yes, matching D-070's trade-off. Only matters if rung 17 is built |
| Q18 | Would BK give up Oryx and Keymapp on the Moonlander for Vial's live tap dance, combos and tapping term? | Open; blueprint assumes no, and keeps ZSA's fork (D-097) |
| Q19 | Should clicking a key always open its panel, with keys sent to the chat only through "Asking about" chips? | Open; blueprint assumes yes (D-099) |
| Q20 | Should the Codex provider be offered to other users, given that OpenAI's terms for third-party apps using ChatGPT login couldn't be read? | Open; blueprint assumes BK's own machine only until the terms are checked (D-108) |
| Q21 | Should keyloom read API keys from the macOS Keychain itself, or keep taking them from the environment (`op run`, shell profile)? | Open; blueprint assumes the environment only, as today |
| Q22 | OpenRouter for Claude models only, or other models too (which needs a Chat Completions adapter)? | Open; blueprint assumes Claude only (D-107) |
| Q23 | Is Codex acceptable without token streaming and without a cost figure? | Open; blueprint assumes yes, showing whole messages and tokens only (D-108) |
| Q24 | Would BK build the Glove80 against the community fork behind `moergo-sc/zmk#36` to get per-key, per-layer colours, given it is unmerged and on a different base from MoErgo's v26.09? | Open; blueprint assumes no, and the Glove80 has no lighting (D-225, S21) |
| Q25 | 3D or 2.5D for the board on screen? (concept, 23) | Open; blueprint assumes 2.5D: DOM caps keep the 11 px legend floor, the front-printed hold legend, phones, accessibility and the contrast tests; 3D on desktop only would mean two renderers (D-260) |
| Q26 | Should the case colourway follow the room (black in the dark theme, white in the light), or always be the colour of the board BK owns? | Open; blueprint assumes it follows the room, with a setting to pin it to the owned colourway later (D-262; the pin isn't built) |
| Q27 | BK's Moonlander layer names don't match their contents ("Navigation" holds the F-keys). Should keyloom suggest names from what a layer holds ("mostly arrows")? | Open; blueprint assumes no suggestions; layers keep BK's names |
| Q28 | Symbols and Mouse share one LED colour in BK's layout. Should keyloom flag layers that share a colour? | Open; blueprint assumes it leaves them as he set them |
| Q29 | Should the halves part for every key card, or only when the card would otherwise cover the key? | Built as assumed (D-275, v0.23.0): the halves part only when the card cannot sit beside the board (`src/web/card/card-seat.ts`). Open until BK confirms the feel |

### S50 result, build half only (2026-10-16)

The stream (D-284) is in keyloom's hands-free Moonlander build and compiles beside Oryx's modules: reva 68,140 bytes against 67,268 plain, revb 70,380, with `__wrap_action_exec` called from `matrix_task` (`nm` and `objdump` in [../research/spikes/S50.md](../research/spikes/S50.md)). The C passes its host-compiled tests for batching, the position table, and each way of stopping. Nothing has run on a keyboard: whether it keeps up at fast typing without dropping events, and whether the macOS reader receives the reports, wait for the runbook in S50.md with BK.

### S51 result, build half only (2026-10-16)

The stream (D-285) is in the keyloom-zmk module and links into the hands-free Glove80 and Corne builds (the Corne's central image only). The C passes its host-compiled tests. Nothing has run on a keyboard: the order across the split, the split latency and the stop behaviours wait for the runbook in [../research/spikes/S51.md](../research/spikes/S51.md) with BK.

### S53 result, emulator half (2026-10-16)

A synthetic typing sent over each stream's wire format and replayed through QMK's real core and ZMK's real build reproduces the firmware's reports exactly (30 events and 30 reports on each), and a recording built to misfire is classified and fixed on both real cores. Two firmware behaviours the replays had to allow for are in D-286. The half that needs a real keyboard is the runbook in [../research/spikes/S53.md](../research/spikes/S53.md).

