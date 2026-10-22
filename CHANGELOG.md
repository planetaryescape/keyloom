# Changelog

## [0.52.0](https://github.com/planetaryescape/keyloom/compare/v0.51.0...v0.52.0) (2026-10-22)


### Features

* add a native Windows device helper candidate ([ca0f279](https://github.com/planetaryescape/keyloom/commit/ca0f279d603ba8dbef8be4f60239ec8c0740e004))

## [0.51.0](https://github.com/planetaryescape/keyloom/compare/v0.50.0...v0.51.0) (2026-10-22)


### Features

* publish a Windows x64 release with a PowerShell installer ([8b030a9](https://github.com/planetaryescape/keyloom/commit/8b030a91b95331a8512f2eb78d1e3cbd47396508))


### Bug Fixes

* tell a Glove80 half that didn't come back to rewrite it from its bootloader ([0f98a9b](https://github.com/planetaryescape/keyloom/commit/0f98a9b6702fbfbf6a3ec207556adf844020c605))

## [0.50.0](https://github.com/planetaryescape/keyloom/compare/v0.49.0...v0.50.0) (2026-10-22)


### Features

* add a native Linux device helper candidate ([a050189](https://github.com/planetaryescape/keyloom/commit/a050189f6695ba923339db8fb7b99a2ec649fd55))

## [0.49.0](https://github.com/planetaryescape/keyloom/compare/v0.48.1...v0.49.0) (2026-10-22)


### Features

* make the Rust device helper the default on Apple Silicon Macs ([131e496](https://github.com/planetaryescape/keyloom/commit/131e496866dde346396cb62cf6bf5af37b4f9128))

## [0.48.1](https://github.com/planetaryescape/keyloom/compare/v0.48.0...v0.48.1) (2026-10-22)


### Bug Fixes

* native macOS device helper finds a real Glove80 and reports unplugs as disconnected ([2ccca84](https://github.com/planetaryescape/keyloom/commit/2ccca847ca3584e3b467af8019a136794b048ea3))
* raise the kanata daemon's open-file limit ([c1325ca](https://github.com/planetaryescape/keyloom/commit/c1325ca9a3dc5e91d8c839fb006f211d36e141ca))

## [0.48.0](https://github.com/planetaryescape/keyloom/compare/v0.47.0...v0.48.0) (2026-10-21)


### Features

* own the macOS serial port directly in the native serial candidate ([2537547](https://github.com/planetaryescape/keyloom/commit/2537547d8c252c29c9279058c4747322a6bf5cd1))

## [0.47.0](https://github.com/planetaryescape/keyloom/compare/v0.46.1...v0.47.0) (2026-10-21)


### Features

* add gated macOS native HID capture candidate ([da99297](https://github.com/planetaryescape/keyloom/commit/da9929778d36222daf84347f1234bbb3e6402044))
* record a Glove80 through the Rust helper in a synthetic serial candidate ([449a4e2](https://github.com/planetaryescape/keyloom/commit/449a4e2fcd4cdf4ac8a82a1ca17ff4083fed969e))


### Bug Fixes

* record broken ZMK recordings as incomplete ([3bf16e4](https://github.com/planetaryescape/keyloom/commit/3bf16e4f65fb914287d36f96284f134470b8c2ce))

## [0.46.1](https://github.com/planetaryescape/keyloom/compare/v0.46.0...v0.46.1) (2026-10-20)


### Bug Fixes

* register the helper signing keychain before codesign ([3142d77](https://github.com/planetaryescape/keyloom/commit/3142d77bebb80064944367a192efe73146c3e586))

## [0.46.0](https://github.com/planetaryescape/keyloom/compare/v0.45.0...v0.46.0) (2026-10-20)


### Features

* verify installed device-helper diagnostics ([316f4be](https://github.com/planetaryescape/keyloom/commit/316f4bec7fc9e0e7283b7d85fba94fa03fbe48fd))

## [0.45.0](https://github.com/planetaryescape/keyloom/compare/v0.44.0...v0.45.0) (2026-10-20)


### Features

* implement interactive questions and typed artifacts for rung 27 ([70eb66e](https://github.com/planetaryescape/keyloom/commit/70eb66ec391017d76b1117fac233c5c39727a026))

## [0.44.0](https://github.com/planetaryescape/keyloom/compare/v0.43.1...v0.44.0) (2026-10-20)


### Features

* close blueprint implementation and verification gaps ([d03dbfc](https://github.com/planetaryescape/keyloom/commit/d03dbfcdc7d31ef75b010f10bb1147599357cd5f))

## [0.43.1](https://github.com/planetaryescape/keyloom/compare/v0.43.0...v0.43.1) (2026-10-18)


### Bug Fixes

* distinguish layer colours and restore chat controls ([#131](https://github.com/planetaryescape/keyloom/issues/131)) ([46a04ba](https://github.com/planetaryescape/keyloom/commit/46a04ba842491a2a243f90bf4f1fa520f70eb7e2))

## [0.43.0](https://github.com/planetaryescape/keyloom/compare/v0.42.1...v0.43.0) (2026-10-18)


### Features

* preserve agent work across reconnects ([7a98f81](https://github.com/planetaryescape/keyloom/commit/7a98f8189d08e6566c95cd0d152c2e3dd012f490))

## [0.42.1](https://github.com/planetaryescape/keyloom/compare/v0.42.0...v0.42.1) (2026-10-18)


### Bug Fixes

* focus the chat composer when it opens ([b5b90c4](https://github.com/planetaryescape/keyloom/commit/b5b90c4ca6b600d51b604e40667b6b72ac279ada))

## [0.42.0](https://github.com/planetaryescape/keyloom/compare/v0.41.1...v0.42.0) (2026-10-18)


### Features

* show agent work and keep sidebars exclusive ([33d5f98](https://github.com/planetaryescape/keyloom/commit/33d5f9833db6b7ed7170f4a02c251b4f1aced470))

## [0.41.1](https://github.com/planetaryescape/keyloom/compare/v0.41.0...v0.41.1) (2026-10-18)


### Bug Fixes

* review drops a restated check by its layers and keeps one fix per problem ([#121](https://github.com/planetaryescape/keyloom/issues/121)) ([4b230c9](https://github.com/planetaryescape/keyloom/commit/4b230c9b57d777f27fa526cbb226d06b49976108))

## [0.41.0](https://github.com/planetaryescape/keyloom/compare/v0.40.1...v0.41.0) (2026-10-18)


### Features

* no accent stripes or sparkles, and the case and keycaps are coloured separately ([#118](https://github.com/planetaryescape/keyloom/issues/118)) ([72370d0](https://github.com/planetaryescape/keyloom/commit/72370d0494497ae4bdd6036106fcec9d3f6c1aab))

## [0.40.1](https://github.com/planetaryescape/keyloom/compare/v0.40.0...v0.40.1) (2026-10-18)


### Bug Fixes

* menus open above the stage again, so their items can be clicked ([#115](https://github.com/planetaryescape/keyloom/issues/115)) ([b9d88dd](https://github.com/planetaryescape/keyloom/commit/b9d88dd834e37b293f3892ff0e4f55da550f8fbf))

## [0.40.0](https://github.com/planetaryescape/keyloom/compare/v0.39.0...v0.40.0) (2026-10-18)


### Features

* conditional layers (tri-layer) ([#111](https://github.com/planetaryescape/keyloom/issues/111)) ([f3d5942](https://github.com/planetaryescape/keyloom/commit/f3d5942790502dee9067810b0dee7fb119670f1e))

## [0.39.0](https://github.com/planetaryescape/keyloom/compare/v0.38.2...v0.39.0) (2026-10-17)


### Features

* pin the drawn board to its colourway ([#109](https://github.com/planetaryescape/keyloom/issues/109)) ([073a356](https://github.com/planetaryescape/keyloom/commit/073a356575e8a7db7e8c02c85e93b376f0d4e560))


### Bug Fixes

* drop a leftover conflict marker and test for them ([#112](https://github.com/planetaryescape/keyloom/issues/112)) ([95e6160](https://github.com/planetaryescape/keyloom/commit/95e616029f3e48eb1517c1479caf8c8954cea2d5))

## [0.38.2](https://github.com/planetaryescape/keyloom/compare/v0.38.1...v0.38.2) (2026-10-17)


### Bug Fixes

* put onto the MacBook keyboard, act on defaults, and add ask_user ([#107](https://github.com/planetaryescape/keyloom/issues/107)) ([ee42248](https://github.com/planetaryescape/keyloom/commit/ee422486232d5fc03151435a741604f13239caa6))
* QMK CHORDAL_HOLD translates to a same-hand tap on kanata (S33 differential test) ([#108](https://github.com/planetaryescape/keyloom/issues/108)) ([93fe89d](https://github.com/planetaryescape/keyloom/commit/93fe89df2210e8a27567856941c74c6f0cfe6538))

## [0.38.1](https://github.com/planetaryescape/keyloom/compare/v0.38.0...v0.38.1) (2026-10-17)


### Bug Fixes

* reliability: Colima stale reads and four flaky tests ([#104](https://github.com/planetaryescape/keyloom/issues/104)) ([b39d32d](https://github.com/planetaryescape/keyloom/commit/b39d32d2f77a82b28af7a84674e9d5066f5c186c))

## [0.38.0](https://github.com/planetaryescape/keyloom/compare/v0.37.0...v0.38.0) (2026-10-17)


### Features

* flash derived QMK boards through dfu-programmer, dfu-util and avrdude, and record the smoke build ([#100](https://github.com/planetaryescape/keyloom/issues/100)) ([fec6a8e](https://github.com/planetaryescape/keyloom/commit/fec6a8e358c91250b03d0d050391a10b923d045e))


### Bug Fixes

* an imported QMK keymap's custom keycodes survive into the generated keymap ([#101](https://github.com/planetaryescape/keyloom/issues/101)) ([fbc0d46](https://github.com/planetaryescape/keyloom/commit/fbc0d467b4bdb599e26933e977699486a7d3c8b1))
* read the layer numbers in stored layouts' kept code at startup ([#102](https://github.com/planetaryescape/keyloom/issues/102)) ([6f64a5c](https://github.com/planetaryescape/keyloom/commit/6f64a5cf3b857f68719e98392457a5914e627881))

## [0.37.0](https://github.com/planetaryescape/keyloom/compare/v0.36.1...v0.37.0) (2026-10-17)


### Features

* blank configs start from the firmware default keymap, configs from a file, and a put_config agent tool ([#95](https://github.com/planetaryescape/keyloom/issues/95)) ([25db61c](https://github.com/planetaryescape/keyloom/commit/25db61c6fe7ac74ad06f605a8fdeb796489bba8c))
* keyloom desktop app (Tauri shell, menu-bar sync, one server per data dir) ([c32c064](https://github.com/planetaryescape/keyloom/commit/c32c0644e1b4b1ec05a53e5d8c382ac9debd9934))
* the QMK importer reads enum layer names, and a test pins that a put never starts a sync ([#97](https://github.com/planetaryescape/keyloom/issues/97)) ([73f864c](https://github.com/planetaryescape/keyloom/commit/73f864c888cd544e87746bac56d6d7712561136c))


### Bug Fixes

* renumber layers that preserved code names, so reorder and delete work ([730a625](https://github.com/planetaryescape/keyloom/commit/730a625cc50f681788cfdaaabd41d2c8ca7c581f))

## [0.36.1](https://github.com/planetaryescape/keyloom/compare/v0.36.0...v0.36.1) (2026-10-17)


### Bug Fixes

* close the gaps the add-keyboard tests found ([#88](https://github.com/planetaryescape/keyloom/issues/88)) ([7bb9e26](https://github.com/planetaryescape/keyloom/commit/7bb9e26b3313c6fd68eb14d079be19f47745b73a))
* review trigger label, agent repeating checks, unlinked proposals, provider wording ([#90](https://github.com/planetaryescape/keyloom/issues/90)) ([676fd77](https://github.com/planetaryescape/keyloom/commit/676fd77e833d15dc874660b1141b3b8f59adf983))

## [0.36.0](https://github.com/planetaryescape/keyloom/compare/v0.35.1...v0.36.0) (2026-10-16)


### Features

* board review screens ([75a095c](https://github.com/planetaryescape/keyloom/commit/75a095cf4343db20dd5abe2a7847a4759b0669c7))

## [0.35.1](https://github.com/planetaryescape/keyloom/compare/v0.35.0...v0.35.1) (2026-10-16)


### Bug Fixes

* switching boards crossfades instead of flashing a loading screen ([#85](https://github.com/planetaryescape/keyloom/issues/85)) ([41fdb37](https://github.com/planetaryescape/keyloom/commit/41fdb37ac6a8ace6e0fdd66e2229204e77554c7a))

## [0.35.0](https://github.com/planetaryescape/keyloom/compare/v0.34.8...v0.35.0) (2026-10-16)


### Features

* proactive board review engine ([bdc1e4f](https://github.com/planetaryescape/keyloom/commit/bdc1e4ff92e9b16450760df0748675946abde490))


### Bug Fixes

* draw the Glove80 from photos, two bodies with thumb modules ([9ad7ddc](https://github.com/planetaryescape/keyloom/commit/9ad7ddc81f352dc6edb2bfd8c20a381c57aa0c4c))
* the board's legend choice uses the same room as each cap's check ([#84](https://github.com/planetaryescape/keyloom/issues/84)) ([2f4104f](https://github.com/planetaryescape/keyloom/commit/2f4104f3394ef396d584ca60db5cd1cc48bd7aa5))

## [0.34.8](https://github.com/planetaryescape/keyloom/compare/v0.34.7...v0.34.8) (2026-10-16)


### Bug Fixes

* the layer strip shrinks its tabs before it scrolls ([cb1af87](https://github.com/planetaryescape/keyloom/commit/cb1af87a60b147103fbfe5c5c58903539f28a726))

## [0.34.7](https://github.com/planetaryescape/keyloom/compare/v0.34.6...v0.34.7) (2026-10-16)


### Bug Fixes

* a device-gone write error waits for the boot drive to unmount before failing ([acbfa07](https://github.com/planetaryescape/keyloom/commit/acbfa07ca8330b7ffd0144b26c3fcca401096951))

## [0.34.6](https://github.com/planetaryescape/keyloom/compare/v0.34.5...v0.34.6) (2026-10-16)


### Bug Fixes

* verify a ZMK half by its USB serial while its serial port is still coming up ([47de622](https://github.com/planetaryescape/keyloom/commit/47de6225d3d7804d85584b10ce5779e12616deb5))

## [0.34.5](https://github.com/planetaryescape/keyloom/compare/v0.34.4...v0.34.5) (2026-10-16)


### Bug Fixes

* ⌘K opens in the side column, never as a bar over the layer strip ([e72f59f](https://github.com/planetaryescape/keyloom/commit/e72f59f95dfd536f0ac6354f55094edfaf5920be))

## [0.34.4](https://github.com/planetaryescape/keyloom/compare/v0.34.3...v0.34.4) (2026-10-16)


### Bug Fixes

* clip the key card so a focused picker can't scroll it ([47aa315](https://github.com/planetaryescape/keyloom/commit/47aa315959c180f893f526e06d3ff9b9b3dcfeb9))

## [0.34.3](https://github.com/planetaryescape/keyloom/compare/v0.34.2...v0.34.3) (2026-10-16)


### Bug Fixes

* retry a UF2 write a freshly mounted boot drive refuses ([84d0b29](https://github.com/planetaryescape/keyloom/commit/84d0b297681c80117f6c23142b0ed7a3ec552868))
* the key card glides to a new height instead of jumping a frame ([c983736](https://github.com/planetaryescape/keyloom/commit/c983736a579166afff96b26ad5892edf2feb997d))

## [0.34.2](https://github.com/planetaryescape/keyloom/compare/v0.34.1...v0.34.2) (2026-10-16)


### Bug Fixes

* the key card keeps its seat when a picker makes it taller ([60bc825](https://github.com/planetaryescape/keyloom/commit/60bc825bd84cd04139970562f9f141e01890ffde))

## [0.34.1](https://github.com/planetaryescape/keyloom/compare/v0.34.0...v0.34.1) (2026-10-16)


### Bug Fixes

* actions visible at rest and layer names in the put panel ([5bdeaa1](https://github.com/planetaryescape/keyloom/commit/5bdeaa10a5ae1e204140f22210231f3368a6e899))
* whole focus ring on the picker search, wrapped categories, no AI sparkle ([effde11](https://github.com/planetaryescape/keyloom/commit/effde11c107ae85b560aa97d6e86ce0a1fbab23f))

## [0.34.0](https://github.com/planetaryescape/keyloom/compare/v0.33.0...v0.34.0) (2026-10-16)


### Features

* new keyboard screens (rung 21 part 2) ([0f1c3f2](https://github.com/planetaryescape/keyloom/commit/0f1c3f2b2ad51984dc964c2cbb1182c82a4b20b8))

## [0.33.0](https://github.com/planetaryescape/keyloom/compare/v0.32.1...v0.33.0) (2026-10-16)


### Features

* connect a new keyboard and put my config on it (rung 21 part 1) ([bb86f07](https://github.com/planetaryescape/keyloom/commit/bb86f07ceca650b8aa0880fa1557d13c46c17a7e))

## [0.32.1](https://github.com/planetaryescape/keyloom/compare/v0.32.0...v0.32.1) (2026-10-16)


### Bug Fixes

* name the double-tap and tap-then-hold slots under the key ([84eb62f](https://github.com/planetaryescape/keyloom/commit/84eb62ffa744238e03d9c83068d865615eb9b1ab))

## [0.32.0](https://github.com/planetaryescape/keyloom/compare/v0.31.1...v0.32.0) (2026-10-16)


### Features

* drafts, ⌘K and the thread carry across the journey ([cda6a33](https://github.com/planetaryescape/keyloom/commit/cda6a3399566ebe0fe330a7a4b55e2b218090020))

## [0.31.1](https://github.com/planetaryescape/keyloom/compare/v0.31.0...v0.31.1) (2026-10-16)


### Bug Fixes

* configs polish and the blank danger buttons ([37ca870](https://github.com/planetaryescape/keyloom/commit/37ca870312789b6c4590967f14b99aad01a6f9c5))

## [0.31.0](https://github.com/planetaryescape/keyloom/compare/v0.30.1...v0.31.0) (2026-10-16)


### Features

* configs and versions screens ([fcdf4e5](https://github.com/planetaryescape/keyloom/commit/fcdf4e543e64191e3e4bbe33128314aea4900bb3))

## [0.30.1](https://github.com/planetaryescape/keyloom/compare/v0.30.0...v0.30.1) (2026-10-16)


### Bug Fixes

* lab suggestions retune every key that shares a QMK tap and hold ([8ff5be9](https://github.com/planetaryescape/keyloom/commit/8ff5be91755eabd5e4fb5a1432ccdbffa91aa7cc))

## [0.30.0](https://github.com/planetaryescape/keyloom/compare/v0.29.0...v0.30.0) (2026-10-16)


### Features

* typing lab screens and routes ([6449901](https://github.com/planetaryescape/keyloom/commit/6449901fb1632f1faeac79e19ef45d834fbb534f))

## [0.29.0](https://github.com/planetaryescape/keyloom/compare/v0.28.0...v0.29.0) (2026-10-16)


### Features

* P5 phone and polish under the light ([02d0e08](https://github.com/planetaryescape/keyloom/commit/02d0e08d38039707107643965e6ca450e6ff25da))


### Bug Fixes

* report flash states in order and before the flash finishes ([bccdaee](https://github.com/planetaryescape/keyloom/commit/bccdaee08a2c5809d44cf121a692085b669d971e))

## [0.28.0](https://github.com/planetaryescape/keyloom/compare/v0.27.0...v0.28.0) (2026-10-16)


### Features

* P4 screens under the light ([0e7c382](https://github.com/planetaryescape/keyloom/commit/0e7c382fdecfd76ad9dfec3608125c659073dca5))

## [0.27.0](https://github.com/planetaryescape/keyloom/compare/v0.26.0...v0.27.0) (2026-10-16)


### Features

* configs and versions engine (rung 23 part 1) ([d634884](https://github.com/planetaryescape/keyloom/commit/d63488417b9d0ddba6a15486e1b7c574831fe0ba))
* typing lab capture and analysis engine (rung 22 part 1) ([994911d](https://github.com/planetaryescape/keyloom/commit/994911dcaf7f7aa4d78c00ab0595704bba8af3ee))

## [0.26.0](https://github.com/planetaryescape/keyloom/compare/v0.25.0...v0.26.0) (2026-10-16)


### Features

* read conversations in a panel beside the board, and put combos one click away ([dab840f](https://github.com/planetaryescape/keyloom/commit/dab840f66721c098168f2ffc0ea780224fea55d3))

## [0.25.0](https://github.com/planetaryescape/keyloom/compare/v0.24.0...v0.25.0) (2026-10-16)


### Features

* name keys by what they print and where they sit, never by number ([597ce13](https://github.com/planetaryescape/keyloom/commit/597ce13caecdf3eb9ed75edebeba3b3ca47107c6))
* open the chat as a command bar whose proposals preview on the caps ([c38bf8e](https://github.com/planetaryescape/keyloom/commit/c38bf8e4595bad03d7236c47f5c931d6f3163ab2))


### Bug Fixes

* keep the board readable under the command bar and let Apply land ([ef99160](https://github.com/planetaryescape/keyloom/commit/ef9916026a586924753b27925ce053e93283b878))

## [0.24.0](https://github.com/planetaryescape/keyloom/compare/v0.23.0...v0.24.0) (2026-10-16)


### Features

* draw BK's four boards from photographs of the real objects ([950466d](https://github.com/planetaryescape/keyloom/commit/950466d33571dc38b5645d1ac2eff78fef547646))

## [0.23.0](https://github.com/planetaryescape/keyloom/compare/v0.22.1...v0.23.0) (2026-10-16)


### Features

* edit a key on a card beside it, with the key as its hero ([3509dcc](https://github.com/planetaryescape/keyloom/commit/3509dcc52b214cf8debdde63801b695838c1691b))


### Bug Fixes

* keep the key card's picker in view and the legend floor when parted ([40cf2f7](https://github.com/planetaryescape/keyloom/commit/40cf2f7ddde6bc7eb68d53ba55d4400e46a61d0d))
* part the halves for the key card and quiet its middle, from the P2 review ([ee0f84e](https://github.com/planetaryescape/keyloom/commit/ee0f84e4df23f22eb1b414bc91e1ef237cd89b2e))

## [0.22.1](https://github.com/planetaryescape/keyloom/compare/v0.22.0...v0.22.1) (2026-10-16)


### Bug Fixes

* never let the board run under the layer strip ([427a8d5](https://github.com/planetaryescape/keyloom/commit/427a8d57a42e90f4200c0c9cba0790821946db73))

## [0.22.0](https://github.com/planetaryescape/keyloom/compare/v0.21.0...v0.22.0) (2026-10-16)


### Features

* draw each board under its light ([a4a5d37](https://github.com/planetaryescape/keyloom/commit/a4a5d378d57753c33259c9656101c9ae2a4fff7f))


### Bug Fixes

* finish P1's review: front symbols per board, combo dots, phone strip ([4aed08e](https://github.com/planetaryescape/keyloom/commit/4aed08ebf25aa1333df9d30a4aae0fe332cbc201))
* print keys in words and calm the board, from the P1 design review ([25cce92](https://github.com/planetaryescape/keyloom/commit/25cce92976f289eb092674035d5ddf7d1c0f70ad))

## [0.21.0](https://github.com/planetaryescape/keyloom/compare/v0.20.1...v0.21.0) (2026-10-15)


### Features

* apply to kanata with verify, the setup doctor, Disable remapping and sync states ([5a2107f](https://github.com/planetaryescape/keyloom/commit/5a2107f2677741a7dcddbd73bf4ebfb30702dea4))
* generate keyloom.kbd and safe.kbd from a MacBook layout, with validator rules ([be1ab81](https://github.com/planetaryescape/keyloom/commit/be1ab81f2ed4a4214ad55232a022d3b65114a6a3))
* import Karabiner rules as the MacBook's starting layout ([4e5f7a9](https://github.com/planetaryescape/keyloom/commit/4e5f7a9f705546db78f58f37b9d0aa46e01fe745))
* kanata firmware family, the MacBook board and kanata key names ([1c33c1b](https://github.com/planetaryescape/keyloom/commit/1c33c1b2f9aaa8bbbe96d3ec1a79c59c2c5ef443))
* map a QMK or ZMK layout onto the MacBook with placement proposals ([8710d10](https://github.com/planetaryescape/keyloom/commit/8710d1005f3e59ab2cfeb726f700216bb492aadd))

## [0.20.1](https://github.com/planetaryescape/keyloom/compare/v0.20.0...v0.20.1) (2026-10-15)


### Bug Fixes

* draw the Moonlander's thumb clusters and red keys like the real board ([fe28971](https://github.com/planetaryescape/keyloom/commit/fe28971c7d255d90fed01befd4c1d6dcf48791f7))

## [0.20.0](https://github.com/planetaryescape/keyloom/compare/v0.19.1...v0.20.0) (2026-10-15)


### Features

* the agent sees every layout and copies colours, behaviours and combos across boards ([e863588](https://github.com/planetaryescape/keyloom/commit/e863588d402fe65af51a72d613fd37017ce56f99))

## [0.19.1](https://github.com/planetaryescape/keyloom/compare/v0.19.0...v0.19.1) (2026-10-15)


### Bug Fixes

* a macro key prints a short form of its name instead of its slot number ([bfeecc4](https://github.com/planetaryescape/keyloom/commit/bfeecc4333308dc40053eccd5e4beb3d412515c9))
* a trailing layer no custom code names can be removed on layouts with layer numbers in passthrough ([bc31723](https://github.com/planetaryescape/keyloom/commit/bc317230f735e9cb27ad9933b894ac321c198199))
* a ZMK macro wait step pauses once instead of setting the wait for every later step ([0fc0af6](https://github.com/planetaryescape/keyloom/commit/0fc0af636f375d8b8d0fba383501f075947b4ab0))
* combo labels move off cap legends, and fade any they cannot avoid ([a1e5460](https://github.com/planetaryescape/keyloom/commit/a1e5460eb55c5b4798d659941d64f3f1c1ab418f))
* go-back labels no longer stack Back to, Redo and Undo prefixes ([c8a59bf](https://github.com/planetaryescape/keyloom/commit/c8a59bf2e93450ab159010e7b376cb2e74ff025a))
* keep keyloom's system prompt out of Codex's command line when the run has its own CODEX_HOME ([996b79c](https://github.com/planetaryescape/keyloom/commit/996b79c6d24a926a1f0e92dda6bc76430191e26b))
* the draft note hangs under the undo buttons so the layer tabs keep their width ([898dec6](https://github.com/planetaryescape/keyloom/commit/898dec65d8c8f1c3ac0740434c9a99be068420c6))
* write the files a container mounts under a temporary name and rename them into place ([a6522c5](https://github.com/planetaryescape/keyloom/commit/a6522c5444c09382bbcc86a5bcdd6fd2e65ee9d8))

## [0.19.0](https://github.com/planetaryescape/keyloom/compare/v0.18.0...v0.19.0) (2026-10-15)


### Features

* settings page and per-layer and per-key LED colours, with Oryx's ledmap read in and regenerated identically ([ae2399e](https://github.com/planetaryescape/keyloom/commit/ae2399ee10e4625eb0fba090080cbc03c8293eb9))

## [0.18.0](https://github.com/planetaryescape/keyloom/compare/v0.17.0...v0.18.0) (2026-10-15)


### Features

* a library pane for macros, tap dances and timing profiles ([704984b](https://github.com/planetaryescape/keyloom/commit/704984b8d553082871068954667630efdffb6608))
* double-tap and tap-then-hold slots, the Macro tab and tap dance timing in the key panel ([bcb35c7](https://github.com/planetaryescape/keyloom/commit/bcb35c7943cc53f82f4717c124d03df58b1335b3))
* macro builder follows the steps live, with a shared-macro choice, and the panel layout fixes ([9704276](https://github.com/planetaryescape/keyloom/commit/9704276e7a2768706778a4cb4f50784bb6fb85c4))
* tap dance caps, slot-to-ops mapping, macro builder and the password warning ([3feb347](https://github.com/planetaryescape/keyloom/commit/3feb347af66d766aa85ccff9d131c3906f8abe7f))
* tap dance reuse and extra slots in the picker, a visible shared-item choice, and decision D-159 ([87d6160](https://github.com/planetaryescape/keyloom/commit/87d61606dbec8f0b7341180e353ec2b552df6a68))

## [0.17.0](https://github.com/planetaryescape/keyloom/compare/v0.16.0...v0.17.0) (2026-10-15)


### Features

* combos from a selection, layer tabs, swap, drag, copy, paste and quick assign in the web app ([0789765](https://github.com/planetaryescape/keyloom/commit/0789765be2912929ce59d3d38753dba717ce784b))
* layer style, duplicate and move ops, and new layers that warn instead of fail when out of reach ([54f16b7](https://github.com/planetaryescape/keyloom/commit/54f16b76ec8d3ad8411bc101e5d83f96291c10b6))

## [0.16.0](https://github.com/planetaryescape/keyloom/compare/v0.15.0...v0.16.0) (2026-10-15)


### Features

* go back to any revision, import by upload and choose the provider from the web ([0d9aac7](https://github.com/planetaryescape/keyloom/commit/0d9aac7ae8538092883f2815d1c163d0635beb53))
* history panel, import screen, provider picker, phone sheet, skeleton and shortcuts in the web app ([7ef9323](https://github.com/planetaryescape/keyloom/commit/7ef9323bb383a8f5bbcdb1c8d99cec1771e35e70))


### Bug Fixes

* sheet full height stops at the header, warning wraps on a phone, Escape closes History, tests for go-back refusals ([04c2509](https://github.com/planetaryescape/keyloom/commit/04c25095510737cebe6fde9d50b768383b47523d))

## [0.15.0](https://github.com/planetaryescape/keyloom/compare/v0.14.0...v0.15.0) (2026-10-15)


### Features

* tap dance model, QMK and ZMK generators, and the Oryx tap dance importer ([c2106e3](https://github.com/planetaryescape/keyloom/commit/c2106e3be647e6817cfdc4f2c37d834a967903a0))
* tap dance validation, text steps and docs; fix the QMK emulator clock ([d6ace6c](https://github.com/planetaryescape/keyloom/commit/d6ace6c3b2bebd33f900110fbdbe7486d453ab6b))


### Bug Fixes

* read C labels from maps and drop an unused export ([5a6cee1](https://github.com/planetaryescape/keyloom/commit/5a6cee1be4bc3352ec16093c2fbe93729bf57cfb))
* tap dance kind in the new key panel, legend and where-else ([f09d809](https://github.com/planetaryescape/keyloom/commit/f09d809a0d6770ed655b058a93465ebd7fca15ce))

## [0.14.0](https://github.com/planetaryescape/keyloom/compare/v0.13.0...v0.14.0) (2026-10-15)


### Features

* a sync engine, sync and autosync commands, and the events stream ([81f29d5](https://github.com/planetaryescape/keyloom/commit/81f29d51a8e2166fc04b01ee08c39a142cc2894c))
* flashes report hands-free proof, QMK keeps its last good image, syncs get tables ([bc111ad](https://github.com/planetaryescape/keyloom/commit/bc111ad8f9c7055e272d05fbf25dfe76316d81bd))
* the header shows where each keyboard stands, with Sync now, Pause and an auto-sync switch ([d700ed5](https://github.com/planetaryescape/keyloom/commit/d700ed507139ebf403013252824c7a6d96957aa3))


### Bug Fixes

* the sync engine never ends the server, a one-shot sync syncs once, and serve passes fakes through ([3a4e6fd](https://github.com/planetaryescape/keyloom/commit/3a4e6fd1a288aa44576e5af9fcd2cbb4011338bd))

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
