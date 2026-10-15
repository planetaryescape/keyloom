# Changelog

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
