# Changelog

## [0.13.0](https://github.com/planetaryescape/keyloom/compare/v0.12.0...v0.13.0) (2026-10-15)


### Features

* a key panel beside a board that fills the stage, with one picker and slots for tap and hold ([06d5193](https://github.com/planetaryescape/keyloom/commit/06d5193fb346029d0fdf79cd0ec538ea864a0b9e))
* decisions, spacing guard and non-text contrast tests for the key panel ([4cb1064](https://github.com/planetaryescape/keyloom/commit/4cb10642c163ff497be2572a5e3a477976fe675d))
* parse a typed QMK or ZMK expression into a binding for the editor's Any field ([9f5048b](https://github.com/planetaryescape/keyloom/commit/9f5048bb826224bfc1c45c463da62f61a9ae0961))


### Bug Fixes

* keep the phone header on screen, give the sheet room for the picker, drop the macro word from its cap ([1725afb](https://github.com/planetaryescape/keyloom/commit/1725afb3082a1cc666e4d439729cac83fb7adfee))
* Linux serial ports list in a stable order, and the module's serial prefix check builds under GCC ([693a3e0](https://github.com/planetaryescape/keyloom/commit/693a3e0aa8d1b5e6918ec16eb77ff1baecc36fc0))
* the macro swatch in the summary has no second word either ([af2eccd](https://github.com/planetaryescape/keyloom/commit/af2eccd8026db54ce7b92c475b281e5ffc1df77b))

## [0.12.0](https://github.com/planetaryescape/keyloom/compare/v0.11.0...v0.12.0) (2026-10-15)


### Features

* chat shows the active provider and lists every way to set one up ([0e9f18e](https://github.com/planetaryescape/keyloom/commit/0e9f18e47d52cb77c5b2ab8655d5adb1ae43329f))
* Codex provider with a loopback MCP tool server and a locked-down run (S20) ([c6d23e7](https://github.com/planetaryescape/keyloom/commit/c6d23e7455e57c1d6a8fa41030a6b61a9a6cb3b0))
* neutral stored blocks and conversations pinned to their provider (D-111) ([977a240](https://github.com/planetaryescape/keyloom/commit/977a240eca239541f1e9761734d7818050b6db88))
* OpenRouter provider and provider selection (flag, env, data-dir config) ([1f8c00b](https://github.com/planetaryescape/keyloom/commit/1f8c00b721114c27c0be1a345b0d68d9e37fa352))


### Bug Fixes

* codex tests no longer depend on the machine's Codex login or on event timing, and codex loads lazily ([65e31ed](https://github.com/planetaryescape/keyloom/commit/65e31edcfb0e1b37eb4d72e041587d7b48899a77))

## [0.11.0](https://github.com/planetaryescape/keyloom/compare/v0.10.1...v0.11.0) (2026-10-15)


### Features

* a sentence for people beside every validator rule ([169482d](https://github.com/planetaryescape/keyloom/commit/169482d5eb91423ccc9bd6f0060d30fb96e50e26))
* change any key in the editor, dropping or placing what it replaces ([6c83026](https://github.com/planetaryescape/keyloom/commit/6c83026f8ced11d789f978e6319f8c921a9f1b70))


### Bug Fixes

* a UF2 copy refused with EACCES says how to allow it on macOS ([190dd57](https://github.com/planetaryescape/keyloom/commit/190dd575dcea406b89918949700c1e935921c944))

## [0.10.1](https://github.com/planetaryescape/keyloom/compare/v0.10.0...v0.10.1) (2026-10-15)


### Bug Fixes

* a flash with --wait says that wait from its first instruction ([f242098](https://github.com/planetaryescape/keyloom/commit/f242098a8acfed1c6626e8c14994e15f35e520a1))
* keep the two hands' trays apart where a split board's halves nearly meet ([08ce2ed](https://github.com/planetaryescape/keyloom/commit/08ce2eddb388c147c6408ad21a55bcea4afe5914))
* retry a missed raw HID lookup before asking for the bootloader key, and say what the lookup saw ([31b69b6](https://github.com/planetaryescape/keyloom/commit/31b69b619d899a082629f2cefb43a2aea928c40c))
* write the Corne's ZMK keymap in its four physical rows, not lines of ten ([9529e85](https://github.com/planetaryescape/keyloom/commit/9529e8597b86af8bb83bcc8fa6e9cd6770f84cf1))

## [0.10.0](https://github.com/planetaryescape/keyloom/compare/v0.9.0...v0.10.0) (2026-10-15)


### Features

* keyloom flash --wait gives a key-press flash up to an hour, and the instruction says how long ([21ffe07](https://github.com/planetaryescape/keyloom/commit/21ffe077e3aa3de37fcd08aa7f148f5e34eb1a34))


### Bug Fixes

* give ZMK behaviours kept as written a readable key-cap (Enter/OSL2, OS⇧, magic/L5) ([4613b35](https://github.com/planetaryescape/keyloom/commit/4613b35624431ca72dfe91595456ffa511b3be15))

## [0.9.0](https://github.com/planetaryescape/keyloom/compare/v0.8.0...v0.9.0) (2026-10-15)


### Features

* emulate a layout on ZMK's native_posix_64 build ([e2fe161](https://github.com/planetaryescape/keyloom/commit/e2fe16147de5509d790921f8369e19f56909bc73))
* emulate a QMK layout on QMK's host test harness ([ee448c4](https://github.com/planetaryescape/keyloom/commit/ee448c4a9f3fc744101a9f012aea096d7e4b18ca))
* hands-free flash in keyloom flash, the web dialog and keyloom doctor ([4aaaa42](https://github.com/planetaryescape/keyloom/commit/4aaaa42084b2e6b94292cce9df3cb3a18b70fb79))
* keyloom emulate runs QMK boards on QMK's host test harness, and the ZMK log fixtures are committed ([c2b885f](https://github.com/planetaryescape/keyloom/commit/c2b885f3fb725252f3cb02a67fd39fe62abecd94))
* put a build marker and a bootloader command in ZSA firmware builds ([7a1f885](https://github.com/planetaryescape/keyloom/commit/7a1f885dc7d71b9e99fc2a9d39ea02791eddc04e))
* restart a keyboard into its bootloader over raw HID and verify the flash ([20355e2](https://github.com/planetaryescape/keyloom/commit/20355e2d8707ec70d68e01d1c5eb50e8c052f704))


### Bug Fixes

* don't record a priority again when a remembered one already covers what it names ([b48f7d5](https://github.com/planetaryescape/keyloom/commit/b48f7d5f2c43f9c611891d2e307e16b8fe338ff2))
* keep the validation verdict on one line with the change count under it ([8b8ea86](https://github.com/planetaryescape/keyloom/commit/8b8ea8641a7dec38c924be76b3056680cba6a90d))
* stop make failing on a userspace folder the QMK image doesn't have ([885301c](https://github.com/planetaryescape/keyloom/commit/885301c956936fcebb2f7bd8ffe6d6b48efc69f8))

## [0.8.0](https://github.com/planetaryescape/keyloom/compare/v0.7.0...v0.8.0) (2026-10-15)


### Features

* carry the decision draft on proposal cards and test the agent's memory with a scripted model ([8016bf8](https://github.com/planetaryescape/keyloom/commit/8016bf8d13b7a0ffc697a6aeb3ba796173913135))
* decision lifecycle, outcome tool and tuning guidance for the agent ([ed8f605](https://github.com/planetaryescape/keyloom/commit/ed8f605bbb8000d76030ed73a6e16eee97e52c1f))
* decisions outcome, due and dismiss, and change propose --reason ([67c9196](https://github.com/planetaryescape/keyloom/commit/67c919691e2bb63cee918183b7a6012568085611))
* decisions routes for the web app ([5737365](https://github.com/planetaryescape/keyloom/commit/573736574e9441fd81c3f56c32eaf4a02e6826f1))
* decisions view, reminders in the preview, outcome question card and hold-tap tuning in the web app ([15b9a5e](https://github.com/planetaryescape/keyloom/commit/15b9a5ee8e89fcd1fdf57fa5d79e22d182287d34))
* mark retuned hold-tap keys in a proposal preview ([a6e51e7](https://github.com/planetaryescape/keyloom/commit/a6e51e7148fe97149a46f930a332cc771eef7a99))
* validate decision reminders, retuned keys and hold-tap profile options ([3ee67cf](https://github.com/planetaryescape/keyloom/commit/3ee67cf45059ead0a0647a6ef5866b34fad00a21))
* write choice decisions on apply, supersede on override, follow undo, outcome questions ([c4255f1](https://github.com/planetaryescape/keyloom/commit/c4255f1ef888e1a73d80e6372550a9867bbf1f32))


### Bug Fixes

* keep outcomes for choices that were lived with, and write decision drafts to BK directly ([51265a4](https://github.com/planetaryescape/keyloom/commit/51265a4ba0d3599dd3a7a7df5cfe3a512a54853c))
* keep the decisions adapter inside the module table ([d819e66](https://github.com/planetaryescape/keyloom/commit/d819e66b5fec0708ff2b40d6ed643fc65563e65f))
* name a decision's keys by their full names in the decisions list ([87b9b14](https://github.com/planetaryescape/keyloom/commit/87b9b1411b6484c524aeedd4bfa14b8ed7be2b7f))
* name an editor decision by what was done, and tidy the outcome question card ([15081e7](https://github.com/planetaryescape/keyloom/commit/15081e7797e571f725ec71b9b72bb7f773627622))
* type the key-name lookup by plain string ([cd0f604](https://github.com/planetaryescape/keyloom/commit/cd0f60414f98e19cde00226edd9364cbdd0ffd3c))

## [0.7.0](https://github.com/planetaryescape/keyloom/compare/v0.6.0...v0.7.0) (2026-10-15)


### Features

* mirror and repeat transforms for bulk edits, and a mirror-map check on every board ([4b07ed0](https://github.com/planetaryescape/keyloom/commit/4b07ed0edea8c6b907bcc983df995cef7d530183))
* mirror_keys tool, selection header with key and position numbers, outside_selection warning ([8c53dda](https://github.com/planetaryescape/keyloom/commit/8c53dda64de1d3af15c91479f129b098efd832cd))
* selection bar and repeat last change on selection in the editor ([9b2e993](https://github.com/planetaryescape/keyloom/commit/9b2e993fb8728295e032b2f8c882f7dde7489109))


### Bug Fixes

* shorten the repeat panel's note, test what the model is told about mirrors ([741f4a0](https://github.com/planetaryescape/keyloom/commit/741f4a01c01542844d8c526ca35bd084177e0d09))
* write one r in front of an all-right-hand modifier set (rHyp) ([af86c45](https://github.com/planetaryescape/keyloom/commit/af86c456ca86e2eb70541390de3f2ea28f0d818a))

## [0.6.0](https://github.com/planetaryescape/keyloom/compare/v0.5.0...v0.6.0) (2026-10-15)


### Features

* compare a proposal's alternatives side by side and show remembered priorities as chips ([ebfc092](https://github.com/planetaryescape/keyloom/commit/ebfc0920806fffbce9d406b572d3b6843c64c83b))
* remember stated priorities and warn when a change moves a pinned key ([b6251a1](https://github.com/planetaryescape/keyloom/commit/b6251a1a575aa4617cfcee0b9380baad6db4bbfa))


### Bug Fixes

* don't add a second full stop after the flashed layout's summary ([1a8c6f1](https://github.com/planetaryescape/keyloom/commit/1a8c6f1bf15f5472d87212ea599a5951af1d0c6d))
* keep the agent's option numbers when bullets split a numbered list ([c8511f7](https://github.com/planetaryescape/keyloom/commit/c8511f7b1335078dd0291cec3081d444de8f23e3))
* keep the comparison table inside its border and balance long titles ([8beabfb](https://github.com/planetaryescape/keyloom/commit/8beabfb1d87a1971baf20c22d1d28987f870259b))

## [0.5.0](https://github.com/planetaryescape/keyloom/compare/v0.4.0...v0.5.0) (2026-10-15)


### Features

* add the foostan Corne (ZMK) ([#6](https://github.com/planetaryescape/keyloom/issues/6)) ([8741ad3](https://github.com/planetaryescape/keyloom/commit/8741ad34da56fcb71a3b09d3a672a1167d039a7c))
* board recipes are strict, data-driven build and flash for mainline QMK and upstream ZMK ([78b0a34](https://github.com/planetaryescape/keyloom/commit/78b0a3471dacbc4bd45313bb2ad38a8ef679ac7c))
* contributor guide, board template, board-dev overlay and CI board check ([00965f7](https://github.com/planetaryescape/keyloom/commit/00965f77e3c9d29c9bc280444a9da10cd2df49a0))


### Bug Fixes

* set the board check's cache directory from a step, where the runner context exists ([b490519](https://github.com/planetaryescape/keyloom/commit/b49051962b8006d407d1a43d465d5ba8a486bc9d))

## [0.4.0](https://github.com/planetaryescape/keyloom/compare/v0.3.0...v0.4.0) (2026-10-15)


### Features

* add the moergo/glove80 board, a ZMK importer and a keymap generator ([ae2d2aa](https://github.com/planetaryescape/keyloom/commit/ae2d2aa709d7eef9b7df3d2be78e9da6f55d12c6))
* build the Glove80 firmware in Docker and run it through the same use cases as the Moonlander ([5e3ad7a](https://github.com/planetaryescape/keyloom/commit/5e3ad7ad8b1b5e226eb4cbc29195d7eb55281e33))
* flash a Glove80 by copying the UF2 to each half's boot drive ([503a8c5](https://github.com/planetaryescape/keyloom/commit/503a8c54ff1c975c02b0fe12c3fb8b9579f4b79c))


### Bug Fixes

* don't ask to confirm replacing a native binding the proposal only moves, and name natives by their source ([9e989c1](https://github.com/planetaryescape/keyloom/commit/9e989c12ff4f9332ae2ac4cefc7b0fbc77027eff))
* follow ZMK layer behaviours kept as written, so the Glove80 template's Lower and Magic layers count as reachable ([d084282](https://github.com/planetaryescape/keyloom/commit/d0842821f2406745e7345346e57026e0d070a20a))
* keep legends upright on steeply rotated keys such as the Glove80 thumbs ([64bf6b6](https://github.com/planetaryescape/keyloom/commit/64bf6b666631be30c72a4e81550475a86b87f4a5))
* place rotated keys by their real centre in the text grid so the Glove80 renders ([31bbc42](https://github.com/planetaryescape/keyloom/commit/31bbc4201916d1a048094b8ab3a9157b95848e34))

## [0.3.0](https://github.com/planetaryescape/keyloom/compare/v0.2.0...v0.3.0) (2026-10-15)


### Features

* apply a stored proposal by id with POST /api/change-sets/:id/apply ([e47558a](https://github.com/planetaryescape/keyloom/commit/e47558a48ae4346d7946877bddfd4d4afd8f6282))
* chat panel with streamed replies, key selection, proposal cards and apply ([1f58616](https://github.com/planetaryescape/keyloom/commit/1f5861687b9af639c86a936989e6884ed846fd40))


### Bug Fixes

* keep the chat stream open with SSE keep-alives and land on the first proposal ([70a787c](https://github.com/planetaryescape/keyloom/commit/70a787cb854368000fed80c7b382569928615afe))
* name keys as the editor does in agent replies and diff lines ([9262b09](https://github.com/planetaryescape/keyloom/commit/9262b09caa093cac1de41105ab69caa7ea8930b4))
* use plain groups for gains and costs so cards add no duplicate landmarks ([2a22422](https://github.com/planetaryescape/keyloom/commit/2a22422319cb8b2e9fd09aba4463e969b29daac3))

## [0.2.0](https://github.com/planetaryescape/keyloom/compare/v0.1.0...v0.2.0) (2026-10-15)


### Features

* add change and undo commands to the CLI ([9a19860](https://github.com/planetaryescape/keyloom/commit/9a198602b66a1560f169b9440d6fd63ea896d1e2))
* add check, propose, apply, reject and undo use cases ([73dfa03](https://github.com/planetaryescape/keyloom/commit/73dfa031728d62a6d6847828b5c21b8d0d0da86a))
* add the change, validation and editing contracts for rung 2 ([5d4bd9e](https://github.com/planetaryescape/keyloom/commit/5d4bd9e37350e30ed50dae1512c5dc75189632c3))
* add the rung 2 editor routes, binding editor, undo and build and flash panel ([30e6f29](https://github.com/planetaryescape/keyloom/commit/30e6f29722a5c1e6c837e6ce34afa499e5f9d943))
* apply change ops, canonical function strings and stale-base detection ([8d4188b](https://github.com/planetaryescape/keyloom/commit/8d4188b86697a114d8a3e68e0056970d613a1cb1))
* ask for the board revision when no keyboard is connected and confirm replacing a native key ([38cd11c](https://github.com/planetaryescape/keyloom/commit/38cd11c146e7e540672457c856b1418cf49efe2f))
* back the editor's write routes with the change and firmware use cases ([770bec0](https://github.com/planetaryescape/keyloom/commit/770bec0e8b752cc14356364f47eb9d953dbcf707))
* build and flash QMK firmware from a layout (toolchain runner, pinned checkout, Docker build, zapp wrapper, builds and flashes tables, CLI) ([04efbf0](https://github.com/planetaryescape/keyloom/commit/04efbf016333c181816b4bc7f292422fc9c45756))
* Ctrl-C cancels a build or flash instead of leaving docker or zapp running; gated Docker test; blueprint notes ([a35e82b](https://github.com/planetaryescape/keyloom/commit/a35e82bfa2a2b445cdea09730f28b1f5dbaafe3a))
* generate QMK source from a layout, with a round-trip test against the Oryx fixture ([30e896d](https://github.com/planetaryescape/keyloom/commit/30e896d9108c9d1b8456ccd849e0af0d304aba0d))
* persist change sets and append revisions in one transaction ([f4ac8a6](https://github.com/planetaryescape/keyloom/commit/f4ac8a6cb1ccf0efb8bae8487f60983639c3b93c))
* serve the editor's write routes from keyloom serve ([2445696](https://github.com/planetaryescape/keyloom/commit/244569659c00c858cd7cccb4faabe3b42271fef0))
* validate change ops with the rung 2 error codes ([fce2156](https://github.com/planetaryescape/keyloom/commit/fce215624fe9720561b2dd9945618e1de1adf08a))


### Bug Fixes

* add --version and name the installed tag in install.sh ([dd95431](https://github.com/planetaryescape/keyloom/commit/dd954313dedb440eb1ced7c64e7a8f606580486f))
* clear QMK build objects inside the container so a second build in a row works on sshfs mounts ([903da6b](https://github.com/planetaryescape/keyloom/commit/903da6be1a561d797ce80b950a64900380f5d315))
* create the build lock's parent directory on a machine with no cache yet ([433fcb9](https://github.com/planetaryescape/keyloom/commit/433fcb96038950d1789ccd410ce5cda4e6446880))
* detect USB keyboards on macOS releases that only report SPUSBHostDataType ([df99019](https://github.com/planetaryescape/keyloom/commit/df99019850153825c91b258b683b9a3f7ff73ac0))
* keep choice cards filled on hover, name the key in validation issues, rename the release step list ([f69c61d](https://github.com/planetaryescape/keyloom/commit/f69c61d4b1786e17d9f64c4c336ba338683ed55b))
* look for system_profiler instead of checking the platform, so the USB tests run on Linux CI ([f80f638](https://github.com/planetaryescape/keyloom/commit/f80f6382cbe631554716c9e37eb282438c9943ca))
* print the reset instruction once per flash state ([96ce956](https://github.com/planetaryescape/keyloom/commit/96ce95698d9c0dda359e9a86b277d54767b8399a))
* undoing an undo reads Redo instead of stacking Undo: Undo: ([6b8f1f2](https://github.com/planetaryescape/keyloom/commit/6b8f1f2c870526c77e5a1d6cafa3cc2cf9059fe7))

## 0.1.0 (2026-10-15)


### Features

* add import, layout show, boards and doctor commands ([b7cc879](https://github.com/planetaryescape/keyloom/commit/b7cc87995ad05fc53a363aadc8821151b659d2c2))
* add keyloom serve over the app's layouts ([f71a8cf](https://github.com/planetaryescape/keyloom/commit/f71a8cf47872533db5e776368314236534f899e2))
* add layout and board schemas ([f6566b5](https://github.com/planetaryescape/keyloom/commit/f6566b54976bae23d12b9db2d1b1dac43c8cc270))
* add read-only keyboard viewer on a local server ([20a9031](https://github.com/planetaryescape/keyloom/commit/20a90319314f879c88c246951bace0c006141823))
* add the Moonlander board and board checks ([298c822](https://github.com/planetaryescape/keyloom/commit/298c82251efa3947f53ccfca8375449ca46fc27d))
* generate the keycode table from ZMK and QMK sources ([c2c6aef](https://github.com/planetaryescape/keyloom/commit/c2c6aef17dc03886ea9ae7a2921779458039e9e5))
* import Oryx source into the layout model ([6bcf801](https://github.com/planetaryescape/keyloom/commit/6bcf801063b8b657f5883bf614b3a215ddf22616))
* redesign the layout viewer with keycaps, an inspector and a legend ([97549df](https://github.com/planetaryescape/keyloom/commit/97549df0f6380c689bfdc3e5802651ac72cb4478))
* share keycap legends and key descriptions between terminal and browser ([ddd2765](https://github.com/planetaryescape/keyloom/commit/ddd2765cb04e5bdeb3d986eeeb4ebeabcbc0da81))
* store layouts and revisions in SQLite ([e3b4fcb](https://github.com/planetaryescape/keyloom/commit/e3b4fcbabf81ad3f067a43174bb909910851e143))


### Bug Fixes

* generate keycodes from ZMK's MIT headers, not the CC-BY-NC-SA hid.js ([4da31e3](https://github.com/planetaryescape/keyloom/commit/4da31e3432e64e39c5f76ae5991563ea56c1d417))
* hide legend swatches from screen readers and read each legend note ([aa56caf](https://github.com/planetaryescape/keyloom/commit/aa56caf8ffde818aa1a76b5f60a5546b3159decf))
* keep // inside config.h strings when importing defines ([c8fd7fd](https://github.com/planetaryescape/keyloom/commit/c8fd7fd7078abe55dc16a38f2fba2bd5cb3ce00e))
* keep the idle inspector in the flow on phones ([4e2f849](https://github.com/planetaryescape/keyloom/commit/4e2f84990f67ae6f2050bb1729f0d48fed14b1e5))
