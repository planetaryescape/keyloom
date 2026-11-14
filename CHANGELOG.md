# Changelog

## [0.80.5](https://github.com/planetaryescape/keyloom/compare/v0.80.4...v0.80.5) (2026-11-14)


### Performance Improvements

* keep firmware sources and compiler output inside Docker ([#342](https://github.com/planetaryescape/keyloom/issues/342)) ([884b45e](https://github.com/planetaryescape/keyloom/commit/884b45ee96bb0951d72994ab4f8938aa27e3a31f))

## [0.80.4](https://github.com/planetaryescape/keyloom/compare/v0.80.3...v0.80.4) (2026-11-14)


### Bug Fixes

* sign and notarize final standalone macOS CLI ([5fdc99e](https://github.com/planetaryescape/keyloom/commit/5fdc99eb354689afbf3cc7c49360b2f892f4dc85))

## [0.80.3](https://github.com/planetaryescape/keyloom/compare/v0.80.2...v0.80.3) (2026-11-14)


### Bug Fixes

* keep reconnect notices readable on phones ([#338](https://github.com/planetaryescape/keyloom/issues/338)) ([cd2ebba](https://github.com/planetaryescape/keyloom/commit/cd2ebba529e155ae576da6b2ef6eba6c11661a79))
* patch transitive security dependencies ([76561aa](https://github.com/planetaryescape/keyloom/commit/76561aa16f1035aa72d191ecf200ae5a15ec8640))
* patch transitive security dependencies ([#339](https://github.com/planetaryescape/keyloom/issues/339)) ([7f64664](https://github.com/planetaryescape/keyloom/commit/7f6466484495547208dfd33d2aa803497be62dd8))
* upgrade test DOM past security advisories ([1413fe2](https://github.com/planetaryescape/keyloom/commit/1413fe2915db1fb194bb6e731257fdaf69152b2d))

## [0.80.2](https://github.com/planetaryescape/keyloom/compare/v0.80.1...v0.80.2) (2026-11-13)


### Bug Fixes

* keep compact key labels and picker previews readable ([6e47877](https://github.com/planetaryescape/keyloom/commit/6e478777f400ca776700a7f02131ec99a51d859c))
* keep compact key labels and picker previews readable ([b9bc361](https://github.com/planetaryescape/keyloom/commit/b9bc36132916d8fd2486b0c5f23eee67359197d0))
* keep source details clear of key prints and search ([13c04a9](https://github.com/planetaryescape/keyloom/commit/13c04a933f8c11b17845de7d3f135fae6f317e52))

## [0.80.1](https://github.com/planetaryescape/keyloom/compare/v0.80.0...v0.80.1) (2026-11-13)


### Bug Fixes

* fit key-card labels and calm flash approval ([4fff2c5](https://github.com/planetaryescape/keyloom/commit/4fff2c57aee7e356495e88eed4d0ff2000303525))
* keep unbounded key-card labels within their action regions ([29efd57](https://github.com/planetaryescape/keyloom/commit/29efd57fc539c2792dcd5c0862bcb7668530b23c))

## [0.80.0](https://github.com/planetaryescape/keyloom/compare/v0.79.2...v0.80.0) (2026-11-13)


### Features

* edit one-shot modifiers from the key card and picker ([054d416](https://github.com/planetaryescape/keyloom/commit/054d416922af8c65f70a6e993a0a1ae6da45667d))
* edit one-shot modifiers from the key card and picker ([aaa623a](https://github.com/planetaryescape/keyloom/commit/aaa623af98dfbe9601d188acf110f97916c48df4))


### Bug Fixes

* bound tool validation with patched Zod and limited errors ([718d3a6](https://github.com/planetaryescape/keyloom/commit/718d3a6aeaa1d13892e2cc1e20c138aa4a91a6ff))
* bound ZIP source inflation before importing keymaps ([d7708e3](https://github.com/planetaryescape/keyloom/commit/d7708e3ef5df5ee527f274f9fc7e24324e6eb3d7))
* configure the Glove80 cache without a mutable installer ([a753630](https://github.com/planetaryescape/keyloom/commit/a7536302b14a88268b53b8fe3e1aac3c7a3b99eb))
* contain QMK host writes within the build workspace ([e7e7d7a](https://github.com/planetaryescape/keyloom/commit/e7e7d7a02d130333bb85954c651d81a45345360b))
* create Nix configuration directory in the pinned image ([a4a8cdd](https://github.com/planetaryescape/keyloom/commit/a4a8cdd363f13f12b6265a49cd85516a8e116f06))
* harden firmware generation and build input boundaries ([700cf23](https://github.com/planetaryescape/keyloom/commit/700cf2345b24bbdeaaae2e477512859868f560c0))
* isolate each container in a unique build workspace ([c4c9098](https://github.com/planetaryescape/keyloom/commit/c4c9098542da2b6b3b7fef805d39fdb06f15df9f))
* isolate firmware sources and lock west dependencies ([#331](https://github.com/planetaryescape/keyloom/issues/331)) ([16c4ad8](https://github.com/planetaryescape/keyloom/commit/16c4ad8feb86bdf42321dfd6ea9eb922c43f2053))
* isolate trusted firmware sources from build workspaces ([0d30b9c](https://github.com/planetaryescape/keyloom/commit/0d30b9c46c7d54cec2498dbb86b7c5eceddbcc66))
* keep Zephyr capability cache inside the container ([90201a0](https://github.com/planetaryescape/keyloom/commit/90201a025d9c8874d5b647f6bb81d54fea3c6423))
* lock transitive west inputs and mount sources read-only ([97db880](https://github.com/planetaryescape/keyloom/commit/97db88017b198dc11d84d7ab15ef9a8302f6acec))
* preserve kept tap dances when picking one-shot modifiers ([9f6b83e](https://github.com/planetaryescape/keyloom/commit/9f6b83e48b4cc9c539b2d646e3415bb02a7037c5))
* publish firmware snapshots after submodules complete ([85b0253](https://github.com/planetaryescape/keyloom/commit/85b025394ca0c87c27d1e4fed0f4ed8a47bbb725))
* reject new firmware source in setting changes ([89261f7](https://github.com/planetaryescape/keyloom/commit/89261f777f22e987ce06d4029b216f02e65399a8))
* reject source directives in conditional layer IDs ([b6dbbb7](https://github.com/planetaryescape/keyloom/commit/b6dbbb76330d57ba38240aed3ac353114d8b9abb))
* select pinned Zephyr package without source writes ([54c2675](https://github.com/planetaryescape/keyloom/commit/54c26758118161436222a47b98d2b0ace5ea73fd))
* verify sidecar checksums before desktop packaging ([3499376](https://github.com/planetaryescape/keyloom/commit/3499376af34d1c9348f9f6477df5d6a48a59efe6))

## [0.79.2](https://github.com/planetaryescape/keyloom/compare/v0.79.1...v0.79.2) (2026-11-13)


### Bug Fixes

* no dead ends round 13: a failed kanata start, its wait, and Download Zapp after a cancel ([886ef02](https://github.com/planetaryescape/keyloom/commit/886ef02d77815bdecaa989f6263c823cb890a749))
* offer the way on after a failed kanata start, say what a setup press waits for, and keep Download Zapp beside Install ([08b6c82](https://github.com/planetaryescape/keyloom/commit/08b6c82a529c9dff28dc4bcad09ef67783f395b3))

## [0.79.1](https://github.com/planetaryescape/keyloom/compare/v0.79.0...v0.79.1) (2026-11-13)


### Bug Fixes

* close round 12's dead ends (Download Zapp after a failed Homebrew install, and six polish items) ([fc35f16](https://github.com/planetaryescape/keyloom/commit/fc35f16e478de4cf92f223983292fc92a9842246))
* offer Download Zapp after a failed Homebrew install, and close round 12's other dead ends ([f1b5dac](https://github.com/planetaryescape/keyloom/commit/f1b5dace2cfbd054996ada2c73f7ff2bd0a64cae))
* say where a Zapp from its page goes after a failed install, and never tell anyone to overwrite Homebrew's kanata ([ead2e63](https://github.com/planetaryescape/keyloom/commit/ead2e6380cd586ab3ff7a427616a8703f604d8ab))

## [0.79.0](https://github.com/planetaryescape/keyloom/compare/v0.78.2...v0.79.0) (2026-11-13)


### Features

* get kanata and Zapp from their pinned releases on a Mac without Homebrew ([3473b0e](https://github.com/planetaryescape/keyloom/commit/3473b0e2d82ae3db92f7d0fc0bdc9d71141a5c68))
* get kanata and Zapp from their pinned releases on a Mac without Homebrew ([b99ce1e](https://github.com/planetaryescape/keyloom/commit/b99ce1ee20bc7e9d07c748e8832030735c08b394))


### Bug Fixes

* give the last round-11 failures a way on and serve configs in the dev editor ([c78d625](https://github.com/planetaryescape/keyloom/commit/c78d6252d4139fdf0c7cea8e34f2ff623ddeeb5f))
* honour a cancel before a checked tool is saved, and keep the download's exit code ([680b03d](https://github.com/planetaryescape/keyloom/commit/680b03da2719e210d85ceb3706f91dcd9a76a14c))
* name only restart commands that fit, offer a fitting board only for one key count ([ea32a13](https://github.com/planetaryescape/keyloom/commit/ea32a133e7e0652d303cf3135b2f5eedf45b0a44))
* restart kanata's service from its checked plist, keep its wait to one deadline, gate every setup on the driver, and hold the import screen per card ([ceda9ce](https://github.com/planetaryescape/keyloom/commit/ceda9ce682c0c88c54e82d55532a1c1d85dc42b7))
* round-11 polish and the dev editor fixture ([c9ae359](https://github.com/planetaryescape/keyloom/commit/c9ae359f98f4b0957b0a920393e39f4de1161221))
* show the Karabiner edit after a MacBook import, and restart kanata's service when it doesn't answer ([5309361](https://github.com/planetaryescape/keyloom/commit/5309361c3590833fa3127cf054519db66861bfce))
* show the Karabiner edit after a MacBook import, and restart kanata's service when it doesn't answer ([4eae33b](https://github.com/planetaryescape/keyloom/commit/4eae33b6d534af365fffafe9543517a13523c68b))
* start no kanata probe after the restart's deadline, and give each only the time left ([42e27b7](https://github.com/planetaryescape/keyloom/commit/42e27b7ffb3cdcfbea3ab2b243fa17c645e057ee))
* tell a Linux browser from its user agent, not the rendering runtime ([f2e4c03](https://github.com/planetaryescape/keyloom/commit/f2e4c030d3a206a466725c171b92859011f45840))
* trust keyloom's kept kanata and Zapp only while they match their pins, and check every download redirect hop ([545ef54](https://github.com/planetaryescape/keyloom/commit/545ef54240a1c138c4abc372ebac7c5e0fc6ba8f))

## [0.78.2](https://github.com/planetaryescape/keyloom/compare/v0.78.1...v0.78.2) (2026-11-13)


### Bug Fixes

* a button whose request fails the same way again goes off, and Restart keyloom leads, in the config dialogs, the import card and the mismatch page ([1ac3aab](https://github.com/planetaryescape/keyloom/commit/1ac3aab794cd1b43111512737cfa1ceafe555bb7))
* a tall config dialog fits a phone's screen ([dbe1074](https://github.com/planetaryescape/keyloom/commit/dbe10748bb1f8c3b34c844125f895414f61bc4f7))
* Add refused because another tab added the board offers Put a config on it, not the CLI's sentence ([747a351](https://github.com/planetaryescape/keyloom/commit/747a3510fe84f49c771f0dfc34a8c146df18d4f3))
* clear a repair request's recheck notice once it is sent, in plain words ([242318a](https://github.com/planetaryescape/keyloom/commit/242318ab0e2e83b6825ff2ff21676e6127a0f02a))
* drop a build re-read that a newer build or flash overtook ([81b913d](https://github.com/planetaryescape/keyloom/commit/81b913dee9b24f6cf8da49bf61106fc7fa08a7be))
* follow a new install after reads stopped, and pick Check again from the read that lost track ([699ceb4](https://github.com/planetaryescape/keyloom/commit/699ceb4cf669bd1e696e5fd1bc134e7eb244c2fd))
* give a reply stopped by keyloom's own exception the log and Restart keyloom ([6c401b9](https://github.com/planetaryescape/keyloom/commit/6c401b9668a4a439a536293c3b74074741460734))
* give the keycode field a Try again that reads it again ([4edee8c](https://github.com/planetaryescape/keyloom/commit/4edee8c3d18ebf349b642417e3cfe2425339e77f))
* kanata refusals, ready Docker engines and kept failure codes (round 10, sync and kanata) ([7a0dfaf](https://github.com/planetaryescape/keyloom/commit/7a0dfaf892eb058c8a9476306cc5195a24411d5d))
* keep a failed Apply's code in Settings, Combos, the tuner and Repeat ([05b7078](https://github.com/planetaryescape/keyloom/commit/05b7078709f6a5fab52293521ecae21abb9609bb))
* keep failure codes in Build and flash and Replace it, and say when keyloom loses track of an install ([5fe2556](https://github.com/planetaryescape/keyloom/commit/5fe2556ca7018f9cbc300869a3a02673a1a111c9))
* keep the lab's catch-all and failed-cancel codes ([fd2c401](https://github.com/planetaryescape/keyloom/commit/fd2c4014587765759ea046741ead37c9fbe2ddd8))
* keep the review's provider switch failure code ([5d9eb84](https://github.com/planetaryescape/keyloom/commit/5d9eb8464760d119923e590359853ec26b8ab041))
* name a ready Docker's engine only from what the daemon or its context says ([00f83b2](https://github.com/planetaryescape/keyloom/commit/00f83b2ef09326a749456e25d49f76892dcdd550))
* name the app macOS lists for a flashing permission, and keep the settings path under Details ([fd3062a](https://github.com/planetaryescape/keyloom/commit/fd3062aa0c42f41306a78e018cd98ddca7ac651c))
* name the Docker engine behind a ready Docker, so a full disk on Docker Desktop offers its settings ([66426e4](https://github.com/planetaryescape/keyloom/commit/66426e4970ba704b3fcee16ef67777390a4e0331))
* no dead ends in chat, the editor's panes, the lab and the review (round 10) ([b9d1bbe](https://github.com/planetaryescape/keyloom/commit/b9d1bbe5d70a62c72ba05338827d57c9fbd9d38c))
* no dead ends in keyboards, configs, import and first run (round 10) ([d12a082](https://github.com/planetaryescape/keyloom/commit/d12a082ecc8c88a1c9bfa615839daf6dd4e56c42))
* Not now on a plugged-in keyboard's card survives a config switch, and the card waits while the review or a dialog is open ([575efd5](https://github.com/planetaryescape/keyloom/commit/575efd50aba602f0606a71265b59f52a4de93690))
* offer Undo only when one step reaches kanata's layout, and say kanata refused only when it did ([93d19b4](https://github.com/planetaryescape/keyloom/commit/93d19b4b12b1803bb5efb7ccc7c863802c75186e))
* offer your other layouts from a re-read toast whose layout is gone, and keep the validator's plain words for a refused lab fix ([f7f0699](https://github.com/planetaryescape/keyloom/commit/f7f0699062436c881eefd1175d91f19b59a12ea5))
* offer your other layouts when a layout was deleted elsewhere ([f578657](https://github.com/planetaryescape/keyloom/commit/f5786579c134d54c3c2c233f3df9cb58988d3fa9))
* open a held setup card when a dialog closes, and keep the board chip after Not now ([a87600f](https://github.com/planetaryescape/keyloom/commit/a87600fad379daf73e0f8bc364ccff6f7b217a5f))
* read readiness again after a start instead of naming the engine it started ([2ede2f7](https://github.com/planetaryescape/keyloom/commit/2ede2f7ff8a44cee1ce138acd509270e6703451b))
* say a lab fix was never proposed, and stop a repair request whose conversation or layout is gone ([a3fac42](https://github.com/planetaryescape/keyloom/commit/a3fac42d24899884935766e14d4ba601a9b11b4f))
* say when kanata refuses keyloom's config and offer Undo or the keyboard's status ([353ff65](https://github.com/planetaryescape/keyloom/commit/353ff656ed4532d8d1fb3dfd827f248691389fb1))
* say why the checks refused a lab fix and offer Type again ([fb0a9a2](https://github.com/planetaryescape/keyloom/commit/fb0a9a2057c02191d558eedd08c7d8f76b04c4a8))
* show Build firmware when a re-read finds the build gone ([5457e8a](https://github.com/planetaryescape/keyloom/commit/5457e8a68f4fbff622cafb683a8aa9385599c260))
* show only the no-built-in-keyboard note on a Mac without one ([52efa59](https://github.com/planetaryescape/keyloom/commit/52efa5947942779508e7b5245633ab7e7f9c3b49))
* stop the layout re-read toasts from reading again for ever ([79cf757](https://github.com/planetaryescape/keyloom/commit/79cf757afbc69e6a4192010c4208b20f23e0744d))
* the QMK and ZMK search and Restore {board} keep a failure's code, and don't repeat a request that fails the same way ([feb5395](https://github.com/planetaryescape/keyloom/commit/feb5395873c66037db503574e592a98fcba7be35))
* the setup card says keyloom has no config for the keyboard, and the welcome's lead points below only when the list shows ([0873a25](https://github.com/planetaryescape/keyloom/commit/0873a25b5d14f526c83babb5602ce17d99b30e59))
* turn the other Forget buttons back on after one lands ([6275df4](https://github.com/planetaryescape/keyloom/commit/6275df4fc0c8dc2379dafbd5a179290bf2efc8e9))

## [0.78.1](https://github.com/planetaryescape/keyloom/compare/v0.78.0...v0.78.1) (2026-11-13)


### Bug Fixes

* check for an open key when a failed undo is tried again, and assert the restart dialog opens ([11d90d1](https://github.com/planetaryescape/keyloom/commit/11d90d1e785f8dc983d7c13e09b86c77d1c0496b))
* D-540's way out for the change check, Stop, Apply, the review read, History and the editor's toasts ([d45187b](https://github.com/planetaryescape/keyloom/commit/d45187b6bc9b175e2c4d8dccc4909eea69d0a5ed))
* give a build whose Docker daemon stopped the docker_unavailable code ([33c0088](https://github.com/planetaryescape/keyloom/commit/33c00881cf93dd366dbd89064898e03719af8c00))
* give the change check, a failed Stop, Apply, the review read, History and the editor's toasts D-540's way out ([9d1b380](https://github.com/planetaryescape/keyloom/commit/9d1b3807158fb60c701efb97dbfda487e5182e1c))
* keep a failure's code in the config dialogs, import card, new-keyboard steps, welcome and mismatch page ([1ee57b9](https://github.com/planetaryescape/keyloom/commit/1ee57b92a344c5091c301159a08c833e17cfca9f))
* keep the failure's code on Docker starts, installs and lab fixes ([512a6cf](https://github.com/planetaryescape/keyloom/commit/512a6cfe05c70f111d2bfdcda8c77a868771c2f8))
* keyboards, configs and import keep a failure's code; Later doesn't reopen setup ([e123beb](https://github.com/planetaryescape/keyloom/commit/e123beba63aad8b70a84dad06e5e2c646a4185fe))
* offer the fix for refused sync flashes, missing flash tools and Docker's build-cache outcomes ([bf79c7b](https://github.com/planetaryescape/keyloom/commit/bf79c7bf94a74edc5beefe2c31c44aaaff563a79))
* offer the settings a sync's flash was refused for, and Build and flash for a missing flash tool ([b6bfc27](https://github.com/planetaryescape/keyloom/commit/b6bfc27acfd4c9da6d32a73e09450a2ecea287e5))
* reread History after a gone version, name only the offer's features, and ignore a stop that fails after the reply ends ([3b9273d](https://github.com/planetaryescape/keyloom/commit/3b9273d74a91bb97266166aa299e0a6c72894441))
* say what freeing Docker's build cache needs when it can't run ([5ed4287](https://github.com/planetaryescape/keyloom/commit/5ed42871e66711eeb3e53702aa23fa690ff12e4f))
* show kanata's keyboard-name warning as a step, and keep the checklist's failure codes ([61d06da](https://github.com/planetaryescape/keyloom/commit/61d06da90abe173dc0bbe7c08303a8d1969bd560))
* show the settings note only while the pill still offers that pane ([93d519e](https://github.com/planetaryescape/keyloom/commit/93d519e588ea6568228271c753fcc7fa1cfba62e))
* stop a held run without a live view, say when Repeat's layout is gone, and close Compare after a retried go back ([0b86c12](https://github.com/planetaryescape/keyloom/commit/0b86c1267666ba40dcd65ce2a6cd91468562efdc))

## [0.78.0](https://github.com/planetaryescape/keyloom/compare/v0.77.0...v0.78.0) (2026-11-13)


### Features

* keep a failure's code on every screen and pick its way out from it ([a8e2ff5](https://github.com/planetaryescape/keyloom/commit/a8e2ff56e7e0572c714c46fceb3eb69d8a0ca06d))
* show keyloom's log beside a failure that says the details are there ([dc2e630](https://github.com/planetaryescape/keyloom/commit/dc2e630ebef2e5fca5d6fde69f544b88124dc2e8))


### Bug Fixes

* answer the PR [#306](https://github.com/planetaryescape/keyloom/issues/306) review on the failed-build dialog, the stale check and kanata's return ([4cf39bc](https://github.com/planetaryescape/keyloom/commit/4cf39bcd00daec28b3b716993485660617566fcf))
* close the key card and park its draft when Show the latest version reads a newer head ([ab55403](https://github.com/planetaryescape/keyloom/commit/ab55403d669303e32c11571dc3e648d39469f168))
* fit the new-keyboard board to a phone, and give the keyboard screens their ways out ([dc2c22b](https://github.com/planetaryescape/keyloom/commit/dc2c22bace9a6c70ccf0c9c19b906787d037ca2d))
* fit the new-keyboard board to a phone, and give the keyboard screens their ways out ([30b5868](https://github.com/planetaryescape/keyloom/commit/30b58689d0b7bb595ad7173cd9c2801c1ce618c6))
* give a Glove80 image build that fills Docker's disk the disk_full code ([3dc8a97](https://github.com/planetaryescape/keyloom/commit/3dc8a977eb974422680fb7645962a60a5c13ad48))
* give a refused build cache prune its own words, never the restart's ([bc7661b](https://github.com/planetaryescape/keyloom/commit/bc7661b1061b487170ef3364edb0067f3e6d3228))
* give sync build failures, a full Docker disk and flash dead ends their own codes and buttons ([87b3021](https://github.com/planetaryescape/keyloom/commit/87b3021eca7295d1b47005b76dac899568f75380))
* keep the failure's code in the chat composer and use one rule for every unexpected answer ([3b35820](https://github.com/planetaryescape/keyloom/commit/3b35820ea9ed57843029e70b7c95284830e71392))
* let a failed log read be tried again, and finish an edit's follow-up when the toast's Try again lands ([bfe881b](https://github.com/planetaryescape/keyloom/commit/bfe881b1349006aa8b296c12bf84bb97b963a855))
* never cut a finger word on Review, and act on the PR [#307](https://github.com/planetaryescape/keyloom/issues/307) review ([9edd1d9](https://github.com/planetaryescape/keyloom/commit/9edd1d92a9178a644aa5f93bbeb8ab398968def2))
* no dead ends in sync failures, Docker's disk, Colima's stop and flash errors (round 8) ([29b86d4](https://github.com/planetaryescape/keyloom/commit/29b86d4996105b6d4a02b9e0c34f4545966bad3a))
* no dead ends round 8: unexpected errors and the shell ([64f5f73](https://github.com/planetaryescape/keyloom/commit/64f5f7310e2b990ce45d93edb284c089ac4b54f1))
* offer Restart keyloom on the chat, decisions and direct-edit failures that can't pass again ([bdfe7e3](https://github.com/planetaryescape/keyloom/commit/bdfe7e316fb89e9aea0bd12b39e62d028563d1f0))
* open the other config when a sync toast is about another config of this keyboard ([33bca33](https://github.com/planetaryescape/keyloom/commit/33bca33fae3752bcd95af13ab0b3580927836e71))
* quote an unusual Colima profile in the printed sudo lines ([37a5b55](https://github.com/planetaryescape/keyloom/commit/37a5b55e574eea2f433f54bddb74db046379bf05))
* say what a failed read of a sync's build leaves, with only the buttons it has ([08e1369](https://github.com/planetaryescape/keyloom/commit/08e136906955bea26d587c68fe5951e3018727c1))

## [0.77.0](https://github.com/planetaryescape/keyloom/compare/v0.76.0...v0.77.0) (2026-11-13)


### Features

* fix Colima's files from a button through macOS's password dialog ([2d6311a](https://github.com/planetaryescape/keyloom/commit/2d6311a54a06d75eb8d23bcd787956a8e5b95bec))


### Bug Fixes

* answer PR [#303](https://github.com/planetaryescape/keyloom/issues/303) review: end a restart wait with the dialog, class Docker Desktop's refused mount as folder_not_shared, and keep the stage notes off the floor ([a920045](https://github.com/planetaryescape/keyloom/commit/a9200455a9bfad0a80ca24a790a16ccf161962cf))
* answer PR [#303](https://github.com/planetaryescape/keyloom/issues/303) review: only a missing sentinel is folder_not_shared, and a restart wait stops on every Cancel ([1d3def0](https://github.com/planetaryescape/keyloom/commit/1d3def0a00c3bd17930e5efc7741dcf1aa55af05))
* build nothing after a restart that went through once the dialog closed ([d713881](https://github.com/planetaryescape/keyloom/commit/d7138819dcda1cf960b868320f1fc66359246005))
* change Colima's files only from folders root holds, in every step ([bd0c3f9](https://github.com/planetaryescape/keyloom/commit/bd0c3f9e1ff229b510b32cc69c02956a802d373b))
* close the mount trick in Fix Colima's files and give root scripts an empty environment ([c5ff21a](https://github.com/planetaryescape/keyloom/commit/c5ff21a5bd3cf2a367b0ccb8fbf5603ee7ef56eb))
* code build failures that repeat, and let a refused Docker restart wait for running work ([39ab82f](https://github.com/planetaryescape/keyloom/commit/39ab82ff0831b92ab04f60a4eb29453340477195))
* count a failed find walk as a failed Colima fix ([95cc63b](https://github.com/planetaryescape/keyloom/commit/95cc63b2ef3fd9e85f69c42427dc30942298c0b7))
* first-run keyboard steps offer only what can be done ([f717954](https://github.com/planetaryescape/keyloom/commit/f7179542caf72b4e331031ff6216d0e4ca39ec0b))
* first-run keyboard steps offer only what can be done (R7-10, R7-11, R7-13) ([9db3df6](https://github.com/planetaryescape/keyloom/commit/9db3df6b1797e04f71a5eb6053804224213c8228))
* give a failed probe cleanup its own failure, and read the last restart lines however fast it failed ([799a7db](https://github.com/planetaryescape/keyloom/commit/799a7dbd9441ea4de590b01c7dfee24aeb048e38))
* give unexpected failures, lab refusals, the review's model list and stale repairs a way out ([19a2dbc](https://github.com/planetaryescape/keyloom/commit/19a2dbcbdbf654dfd217f71d010ee26d9363907f))
* give unexpected failures, lab refusals, the review's model list and stale repairs a way out ([e8d52d7](https://github.com/planetaryescape/keyloom/commit/e8d52d7770b97b1fffb5cf19eb2dfd069e6b072f))
* hold back Colima's chown -R command on the server while a linked file is known ([51ce62f](https://github.com/planetaryescape/keyloom/commit/51ce62fd1c54538f6a408fa7cc5b06dee3a49611))
* hold Colima's command until a finished look finds no linked file, and keep file names out of the fix's status ([aa4aae3](https://github.com/planetaryescape/keyloom/commit/aa4aae326c6aa13c665c65f4e08f43884f7f83b5))
* keep a route's own not_found words, map Bun's bare 413, and wait to show a proposal while a reply runs ([ccad23d](https://github.com/planetaryescape/keyloom/commit/ccad23da356336059fcd43f56743f8e71a304e94))
* keep applied-not-shown in the editor, code the Disable remapping refusal, and give the phone's sync popover its gutter ([06af24c](https://github.com/planetaryescape/keyloom/commit/06af24c45e5e171e4a6dec6ca6428a741fb7e2f7))
* never count a catch-all 404 as something already removed ([988f80b](https://github.com/planetaryescape/keyloom/commit/988f80bd194dc056134ce96728e6db7ce565cb47))
* no dead ends in builds, the Docker restart, the editor and sync (round 7) ([7c6b4e8](https://github.com/planetaryescape/keyloom/commit/7c6b4e8eedb2affab0e046af64eb35f311ce6cb9))
* say the MacBook's changes reach it through kanata, not by themselves ([04441a1](https://github.com/planetaryescape/keyloom/commit/04441a1ea31147d54f373dc83a691765dd4c3866))
* start a config from a known board on the Review step, and keep each put source's board ([b7a98cf](https://github.com/planetaryescape/keyloom/commit/b7a98cf633ab1cae9fc1654883a02dc6f46fe606))

## [0.76.0](https://github.com/planetaryescape/keyloom/compare/v0.75.1...v0.76.0) (2026-11-12)


### Features

* a build that fails the same way every time offers the last version that built and a question to keyloom ([192a772](https://github.com/planetaryescape/keyloom/commit/192a77251ee41db61af3ef4bd07afc2bd01dedc2))
* restart keyloom from the typing lab and the menu bar ([eadee6a](https://github.com/planetaryescape/keyloom/commit/eadee6ad755bf5ac48e98b140f7ccdbc956dd9c2))
* restart the Docker engine and build again for a stale mount or a stuck build container ([70260e8](https://github.com/planetaryescape/keyloom/commit/70260e82bd9f494ce2d08b7cc6750e489dc78f7d))


### Bug Fixes

* an applied proposal whose layout can't be shown says applied, and a failed proposals read says so on the board ([6b4a4b5](https://github.com/planetaryescape/keyloom/commit/6b4a4b553df5e41f917acf641f182d02b97760dd))
* answer PR 298 review: no switch back to a used-up provider, a checking state for repair requests, not_open, and replay words without paths ([a2459c6](https://github.com/planetaryescape/keyloom/commit/a2459c61b43bd9c206ca1fe6d9770f944f7f2cb0))
* answer review: Docker code on a QMK replay, one cancel at a time, and a fresh review that dismisses the stale request ([b5cc59a](https://github.com/planetaryescape/keyloom/commit/b5cc59a5e2487b6250ae0b0f6a8c4714f00c6c64))
* cap the board name in a build question too ([55ad1ff](https://github.com/planetaryescape/keyloom/commit/55ad1ff12133941a519894433f3b5325c6d5ad73))
* check for running work inside the engine lock before a forced Docker restart ([2cefe90](https://github.com/planetaryescape/keyloom/commit/2cefe90e986ad199e86459204a690ffbf6e9f61e))
* close the gaps CodeRabbit found in the forced restart, first flash and key card ([775dcce](https://github.com/planetaryescape/keyloom/commit/775dcce176168dd21aa593bb9569d4b7f71f9f56))
* dead ends in adding a keyboard, the editor and the mismatch page (round 5) ([76433d7](https://github.com/planetaryescape/keyloom/commit/76433d733cf01be0f84c3a3bd185ae6274197898))
* dead ends in builds, board review and proposals (round 5) ([c0eac9b](https://github.com/planetaryescape/keyloom/commit/c0eac9b5d8964871902532574ab1a9f0abe14d13))
* desktop drag and drop, Restart keyloom, and chat ways out for a used-up plan and unconfirmed messages ([8f1aa37](https://github.com/planetaryescape/keyloom/commit/8f1aa37f4728e1146ac4f3e9a48039e3fe7e50b9))
* give a used-up Codex plan its own words, its reset time and another model ([551138c](https://github.com/planetaryescape/keyloom/commit/551138c90ea010c7973b31ddbef47864085a0f02))
* give every failed review request its button, and let activity tests be stopped ([76d2b38](https://github.com/planetaryescape/keyloom/commit/76d2b3894a409081e7d1b0cdbb3a06e3eecd6b68))
* give every keyboard and import refusal a button that resolves it ([c72b257](https://github.com/planetaryescape/keyloom/commit/c72b257bcba629ffa28dc4d03a5303542982d98a))
* give every keyboard and import refusal a button that resolves it ([d0ad3ed](https://github.com/planetaryescape/keyloom/commit/d0ad3ed59c9c85ad86c62d614db67777c7d5b524))
* give review, chat and lab dead ends a way on ([9b2baa1](https://github.com/planetaryescape/keyloom/commit/9b2baa1a40751e2d18fa2c5d90aa25c39e936925))
* give review, chat and lab dead ends a way on (round 6) ([e0072a1](https://github.com/planetaryescape/keyloom/commit/e0072a158a5d5e468bb189fa9082de031ad71788))
* hold the questions back for a keyboard keyloom can't add, and stack the combo refusal ([d8328af](https://github.com/planetaryescape/keyloom/commit/d8328af12d647f62ea13d5727bba5f915b4b0e7d))
* keep a refused retry's code and offer Open history for an unconfirmed message ([9a7716c](https://github.com/planetaryescape/keyloom/commit/9a7716cb78e03aa3cd5e89fbffdfcd44e0272b88))
* keep a restart's exit code when cleanup fails, and say what to do when keyloom doesn't come back ([d212130](https://github.com/planetaryescape/keyloom/commit/d21213019543c110f2d6edea0f4191c9e47ebaf1))
* keep Delete layer open while a combo waits, and say why Make a combo is off ([2555788](https://github.com/planetaryescape/keyloom/commit/25557886a9c10ecfeb9ddedcc86b90b9c324163f))
* keep Go back after a request that never landed, and tie its refusal and its line to one build ([895c5c9](https://github.com/planetaryescape/keyloom/commit/895c5c904827c01cd364bb95a66ec42ed472e6e8))
* keep the newest build-log line in a build question, and say what to do when a build question goes out of date ([0a6812b](https://github.com/planetaryescape/keyloom/commit/0a6812b0d8ddd4252754dd94b47267f6b812fdd6))
* let a dropped file and a dragged layer tab reach the desktop page ([1735f54](https://github.com/planetaryescape/keyloom/commit/1735f549389687d6a79e5fb4bee1724bd941a48b))
* never add a guessed QMK layout from the web, and keep refusal details beside kanata's setup ([b437042](https://github.com/planetaryescape/keyloom/commit/b4370421e14f98df94c80dc701138bfc521bba11))
* offer Build and flash for a board keyloom sees only once its firmware is on it ([7223725](https://github.com/planetaryescape/keyloom/commit/7223725a5313a166810204846eb484863a2c9594))
* refuse a QMK info.json that isn't an object, and drop a stale Restore retry ([56d8cd8](https://github.com/planetaryescape/keyloom/commit/56d8cd850574b3321ec81fe7735a2957945f5001))
* restore the board an import was refused for, and keep cached layouts from blocking a keyboard ([78db913](https://github.com/planetaryescape/keyloom/commit/78db9139e845d1a0bad5f0d68be167304f6bfd1b))
* round-6 dead ends in the editor, builds, Docker and sync ([92b38ba](https://github.com/planetaryescape/keyloom/commit/92b38ba0734b410864b6d54b337e3aafa284e52e))
* say a direct edit is applied when only the read after it fails ([bb223de](https://github.com/planetaryescape/keyloom/commit/bb223de7ce7f20b7fbd2100c93f04b8ebca89dd4))
* say a forced restart waits for a keyboard write, log the wait, and record what the restart guard can't see ([bb34301](https://github.com/planetaryescape/keyloom/commit/bb343012fbfcc363c1c7da0cfc7a806d68c4795e))
* say a review server fault in plain words, and let the fake editor fail a build the same way every time ([d1f0075](https://github.com/planetaryescape/keyloom/commit/d1f0075e50ec911f668520c830bdb7b99499d408))
* say Restarting Colima while the forced restart runs, and add a stale-mount switch to the dev editor ([3cd6ac1](https://github.com/planetaryescape/keyloom/commit/3cd6ac126c25da6ba085fb8163efeeeab0dfb477))
* say when Copy is refused and leave the command selected ([892cace](https://github.com/planetaryescape/keyloom/commit/892caced220698753072dfe9b2d19044eb9d152e))
* say why keyloom can't add a keyboard, and ask which layout is yours ([f5ec4af](https://github.com/planetaryescape/keyloom/commit/f5ec4af9e4c386c9e5c23dc235870494773b5a32))
* show kanata's failed read with Check again, and say in a line why key moves are off ([0d108e8](https://github.com/planetaryescape/keyloom/commit/0d108e8149e889614487d297b8b11216a8eea835))
* start a lab replay reason with a capital letter ([674cd7a](https://github.com/planetaryescape/keyloom/commit/674cd7a4d190e66717708eb1c0aa457e9a29172d))
* treat a typed server refusal as refused, and word a workspace spend cap apart from a used-up plan ([be9be0a](https://github.com/planetaryescape/keyloom/commit/be9be0a3bf44912500c7a5c908bc22cab74787aa))
* use board-wide evidence for the first-flash line, and make sync and restart words match their buttons ([d336d28](https://github.com/planetaryescape/keyloom/commit/d336d280a71952b30dc71b251bde16b8da6f51cf))

## [0.75.1](https://github.com/planetaryescape/keyloom/compare/v0.75.0...v0.75.1) (2026-11-11)


### Bug Fixes

* answer the [#290](https://github.com/planetaryescape/keyloom/issues/290) review on stale Replace it, latched helper setups, search states and test cleanup ([1e46c83](https://github.com/planetaryescape/keyloom/commit/1e46c83bb68b6b57609018b49dcfde9fb0236933))
* back off respawning a keyboard helper that keeps dying ([9c000d4](https://github.com/planetaryescape/keyloom/commit/9c000d410a1d31aa384b4048c3a313846c116e91))
* check an unconfirmed review Apply, show unread proposals in the review, and keep newer words on a retried switch ([a04a677](https://github.com/planetaryescape/keyloom/commit/a04a6778636a7982a0e528632087d6db154453ae))
* describe a layer reference's tapDanceId in one comment ([042f3c9](https://github.com/planetaryescape/keyloom/commit/042f3c9898517a8c26924ad9cb21034aad2391e3))
* desktop links, downloads, and update and sync ways out (R4-A) ([8834ba0](https://github.com/planetaryescape/keyloom/commit/8834ba0de20f73fa4a24528617f413b217219b7d))
* drop the catalogue's search hint once the QMK and ZMK search answers ([a2cee31](https://github.com/planetaryescape/keyloom/commit/a2cee31964e7918d678d0db73ffa594412a438c0))
* follow a Docker start already running, and block builds on a Colima that won't come back ([5162ed8](https://github.com/planetaryescape/keyloom/commit/5162ed820bdebd607ca516963efa88e77ab7f80f))
* give a blank config a free default name ([0706d7d](https://github.com/planetaryescape/keyloom/commit/0706d7dcc6075b693dcddc0fde5e1473766f3352))
* give a tap dance only the deleted layer or a combo uses an Open button, and offer Remove tap dance for an unused one ([b8490bf](https://github.com/planetaryescape/keyloom/commit/b8490bff0f5c96a08a3234d6ec061955808f6f0e))
* hold Delete layer while something switches to it, and open each reference ([b128d8a](https://github.com/planetaryescape/keyloom/commit/b128d8af66faf7b78a9f58d37149c9a942d75137))
* keep a combo card's edits when Open combo names the same combo ([d71433c](https://github.com/planetaryescape/keyloom/commit/d71433c068d42e8a3f17b96560d7c0fae3f1fa7e))
* keep a dead helper's cause through the lab's real capture ([3744120](https://github.com/planetaryescape/keyloom/commit/37441206ab3907610bef4ffbdfc5db52b8c9b4ad))
* keep review Apply off until its check reads back, and say an Apply landed when only the layout refresh failed ([a434132](https://github.com/planetaryescape/keyloom/commit/a4341324a11015125c4939d514a6d87226576ccd))
* keep the first foreign keyloom.kbd copy, and make it only after kanata --check passes ([2c62105](https://github.com/planetaryescape/keyloom/commit/2c62105d19b4567cb988370680303e7a892153f9))
* let a refused review run again, and say what a stopped chat reply already prepared ([2568fcb](https://github.com/planetaryescape/keyloom/commit/2568fcb2b87611d513ef31a8967855c717dcce37))
* offer Replace it when keyloom.kbd on disk isn't keyloom's ([32122e4](https://github.com/planetaryescape/keyloom/commit/32122e4932423a766471ec97bf338fdfaaee58ce))
* offer Resume syncing after a keyboard is restored ([4577ebb](https://github.com/planetaryescape/keyloom/commit/4577ebbfa9ad41eece4bbf8ffaba8ed69bbb0abb))
* offer Try again when the helper dies during the START write, and keep a missing helper's own error ([4d12f8e](https://github.com/planetaryescape/keyloom/commit/4d12f8e46656189a6179b423c98027c272de67e7))
* open desktop links in the browser and save downloads, and give the shell's update and sync dead ends a way out ([d867a0c](https://github.com/planetaryescape/keyloom/commit/d867a0c37c9166598cbd2e0d3655789e860142ac))
* quote layout names in the commands sync refusals name ([2dfcd21](https://github.com/planetaryescape/keyloom/commit/2dfcd21984ca6afcf7d2ccf6ea0f34c2024a24cf))
* replace a dead keyboard helper on the next try instead of asking for a restart ([641f9a5](https://github.com/planetaryescape/keyloom/commit/641f9a5d178c9a108d53ceb88e6c42b390242951))
* round-4 dead ends in sync, MacBook, lab, Docker and the editor ([35fdb9c](https://github.com/planetaryescape/keyloom/commit/35fdb9ca2e90517d795528e8758a6ad33341becd))
* save only keyloom's own downloads and keep a too-new database's code past a cleanup failure ([61ead48](https://github.com/planetaryescape/keyloom/commit/61ead48776f939ab31cbf103c1760ef708754f05))
* say Choose which board this is beside a Build firmware waiting for it ([07cebb8](https://github.com/planetaryescape/keyloom/commit/07cebb80228caa92e5c5628807ff8335745d3861))
* say when a QMK and ZMK keyboard search finds nothing ([af2ea3c](https://github.com/planetaryescape/keyloom/commit/af2ea3cfdd50e4f0e95f455e04f86723e1703fd4))
* say why Undo and a combo's Remove this key are off beside them ([fed9a88](https://github.com/planetaryescape/keyloom/commit/fed9a88b0e07c0d1fdf2927309049318bed94744))
* show an incomplete lab recording as one that can't be read, not a button ([c40ab05](https://github.com/planetaryescape/keyloom/commit/c40ab0571bd1a7f54b59537efe246fb48f3e1765))
* show kanata's setup in the mismatch page's put-on while kanata isn't running ([33ae473](https://github.com/planetaryescape/keyloom/commit/33ae473befad81650c65bcb7db2df3587df5a599))
* show why a chat turn or board review failed after it started, with the button that fixes it ([be2c53a](https://github.com/planetaryescape/keyloom/commit/be2c53a9c9bf79208e7c342dece961b6373fc301))
* show why a chat turn or board review failed, with the button that fixes it ([f18f035](https://github.com/planetaryescape/keyloom/commit/f18f0357a553ba8a8818a84cf0e6c734bb725e1b))
* show why Undo is off in the phone menu, and read the last Docker action without a render-time ref ([dd50d52](https://github.com/planetaryescape/keyloom/commit/dd50d52a01333e715b83dceb84c8289f2e66c192))

## [0.75.0](https://github.com/planetaryescape/keyloom/compare/v0.74.0...v0.75.0) (2026-11-11)


### Features

* install a missing Codex from the chat setup, and give the desktop app's refused key its own steps ([595cc1c](https://github.com/planetaryescape/keyloom/commit/595cc1c28822899969fa2db959bdba04b24944f6))
* open Karabiner-Elements from the kanata checklist when it is installed ([fd64003](https://github.com/planetaryescape/keyloom/commit/fd6400325402dd1fe694ee3dd2eec1f70b9bc39f))
* restart a Colima that won't start, cancel a running build, and name the CLI's next step ([f4f7b3d](https://github.com/planetaryescape/keyloom/commit/f4f7b3d64c5d1fee12395bcaad6f4effbc701bea))
* restart a Colima that won't start, cancel a running build, and recover a lost poll ([6c63538](https://github.com/planetaryescape/keyloom/commit/6c63538e4bb137081a35963e50e9b6c3ca44d167))


### Bug Fixes

* answer Cancel build at once and stop a build that waits on another build's lock ([a1dd21b](https://github.com/planetaryescape/keyloom/commit/a1dd21bca23496fd1929a0a97aa1e6ee70e9ffec))
* dead ends in sync, configs, the MacBook and the typing lab (round 3) ([2831db0](https://github.com/planetaryescape/keyloom/commit/2831db05192c3275830ad79285decaf185892e28))
* give a wall tile that can't be drawn an Open button ([150168f](https://github.com/planetaryescape/keyloom/commit/150168fe2213f5521469c39793b31734e0a98ef7))
* give each page one h1, name the phone controls and serve the app icon ([0203ff5](https://github.com/planetaryescape/keyloom/commit/0203ff5be68af2d0a0ed22c681505003e5347eeb))
* give typing lab failures a way on: Apply errors, Input Monitoring, foreign firmware and delete ([245d8d9](https://github.com/planetaryescape/keyloom/commit/245d8d9ad9d6e0279731b7c06e6ed22451e0a865))
* hide Archive for the config on its keyboard on the mismatch page, and offer another to put on ([9a133be](https://github.com/planetaryescape/keyloom/commit/9a133be0f9bf8526bd6de3542603b9b21d0185bb))
* keep CLI commands off the page, drop the terminal hint after a failed restart, and quote names in suggested commands ([c9e4798](https://github.com/planetaryescape/keyloom/commit/c9e479873e61b036f799474c9c9f0cab02379d3d))
* keep Compare open after a failed Go back, say a failed version list, and hide Disable remapping while kanata is stopped ([465cbb7](https://github.com/planetaryescape/keyloom/commit/465cbb7c772d4bd5e3d92cff1419447334f51115))
* let the desktop shell build without the updater and use no reserved name in its tests ([704163f](https://github.com/planetaryescape/keyloom/commit/704163f9592b9412c0a9daebacc9942abbad1a56))
* name the next command in CLI failures, and keep CLI commands out of shared sentences ([79b4b22](https://github.com/planetaryescape/keyloom/commit/79b4b2296932b029453b80e7f48f6d466067cf6f))
* never restart a slow Colima, which may be running a build ([4bd46ef](https://github.com/planetaryescape/keyloom/commit/4bd46efdeacf4c6cff70e36bbfd73a6dd5bf1c9b))
* offer a way on from a failed board preview, an empty Karabiner, a failed reload and disabled layer actions ([b3fe872](https://github.com/planetaryescape/keyloom/commit/b3fe872894baa3ea7c0d7bf1a87a5e1fd4231a09))
* offer kanata setup or Replace it after an Apply that kanata can't take ([431e45a](https://github.com/planetaryescape/keyloom/commit/431e45a2fe6e6cfd42930c575217f587a65a9469))
* offer Resume syncing after a keyboard restore, and Your keyboards when it fails ([4584b54](https://github.com/planetaryescape/keyloom/commit/4584b54785b24e272e256fa4834069c64479c41e))
* recheck updates at once, clear a stale board preview, and give Start blank a free name ([40b1cb9](https://github.com/planetaryescape/keyloom/commit/40b1cb967d16a7d66b673bc4bda4da5a661773c6))
* record the exit-chord proof only after keyloom saw kanata running its config ([ae52b08](https://github.com/planetaryescape/keyloom/commit/ae52b089b391630030962061960e0b4e34af10e4))
* record the slow-Colima, engine-lock and cancel changes in D-511 and D-512 ([1162f8e](https://github.com/planetaryescape/keyloom/commit/1162f8e3d344265d954171c9a25cc1664657d56a))
* round 3 dead ends: accessibility, desktop shell and web polish ([20cb314](https://github.com/planetaryescape/keyloom/commit/20cb3143f8d29c9cc463750078ec15ab58e55a26))
* run one Docker start or restart at a time, and refuse a restart over a start ([845e55d](https://github.com/planetaryescape/keyloom/commit/845e55d87a56e9ea76805abf50fc963acce4553f))
* say Docker isn't ready after a failed auto-sync build, with Build and flash ([c15566b](https://github.com/planetaryescape/keyloom/commit/c15566bcb925405972f7c77a948e1fbb99472ba8))
* say why a desktop update failed, show the server's last lines, and answer a refused Sync now ([cbf87d6](https://github.com/planetaryescape/keyloom/commit/cbf87d6eacfb093e9262feb43f81387d007d81fa))
* send a refused put-on to the config that can fix it, and stop a busy Sync now that outlived its page ([004ace7](https://github.com/planetaryescape/keyloom/commit/004ace7ac4e1842e58fa8567e38d02288d800d1f))
* send toasts, refusals and closed lab fixes to a page that can act on them ([3933796](https://github.com/planetaryescape/keyloom/commit/393379689ca603689045e8bc289f64b2a6f0bdb8))
* show a refused put-on's fix in its dialog instead of CLI commands ([f17b6b4](https://github.com/planetaryescape/keyloom/commit/f17b6b4c490df555069804282159524fb91ec0a9))
* sync by itself once a running build or flash ends, instead of telling the person to come back ([7bf6216](https://github.com/planetaryescape/keyloom/commit/7bf62160d940ce6330ccab86140837e68383ba69))

## [0.74.0](https://github.com/planetaryescape/keyloom/compare/v0.73.0...v0.74.0) (2026-11-11)


### Features

* give flash problems codes, cancel a waiting flash and check an unconfirmed one ([ebd7ecb](https://github.com/planetaryescape/keyloom/commit/ebd7ecbacdc51346580e33f01a80155d9222c12d))
* link the import cards' editors, read Karabiner's settings from the Mac, and reload after an unreadable import ([3707ffa](https://github.com/planetaryescape/keyloom/commit/3707ffa875a39acac98520360864ac2724885773))
* offer the fix for every flash problem in Build and flash, and keep the MacBook out of it ([12020c7](https://github.com/planetaryescape/keyloom/commit/12020c7438184d92ffaeda09f9b12afecdc89a5b))
* open a window with Try again when the desktop server can't start or keeps stopping ([13e6610](https://github.com/planetaryescape/keyloom/commit/13e66109f6e16ce91e164b0486365eb64cdffd3f))
* root-owned kanata for the daemon, and a kanata checklist with no dead ends ([9255ef1](https://github.com/planetaryescape/keyloom/commit/9255ef10c38d8beaaa97bffb29d14457d04b3f9f))
* run a root-owned, hash-checked copy of kanata, and give the kanata checklist an install it can follow and cancel ([4e9a20b](https://github.com/planetaryescape/keyloom/commit/4e9a20b4b090bb8dbcaa58def1f21b3b26a35213))


### Bug Fixes

* answer the bot review of the flash-cancel fix ([2072917](https://github.com/planetaryescape/keyloom/commit/20729175b94dee9db141b9cd3a586b36bf31ca14))
* clear git locks a cancelled ZMK build left in its checkout ([7d548f1](https://github.com/planetaryescape/keyloom/commit/7d548f12fbecaf35b9ab389edb0851f12478a98d))
* find Colima after a failed first start, and restart or install Docker only when that fixes it ([118878d](https://github.com/planetaryescape/keyloom/commit/118878d520235414c50340a77141e62965725992))
* finish a stranded ZMK flash and clear a cancelled build's git locks ([2bf08df](https://github.com/planetaryescape/keyloom/commit/2bf08dfd66d8f2790ed3a0cef0ce00adacb07407))
* finish a ZMK flash whose boot drive went away before the file was opened ([0cb3da4](https://github.com/planetaryescape/keyloom/commit/0cb3da46003b39627c5d9370e37628b1ffa9d6a0))
* flash problems offer their fix, and the MacBook keyboard never opens Build and flash ([e144d32](https://github.com/planetaryescape/keyloom/commit/e144d32c1811531880b1514827b8cb0a361bcb15))
* give every Docker and tool install state a way out ([5a3b9d3](https://github.com/planetaryescape/keyloom/commit/5a3b9d3e4281e3750850eb273bc9abbfc50008f8))
* give every Docker and tool install state a way out ([be0c57f](https://github.com/planetaryescape/keyloom/commit/be0c57f79d0f665d407c69671e75de8ede28cab8))
* hold the write guard through a ZMK restart and say where a stopped keyboard is ([36d9bdc](https://github.com/planetaryescape/keyloom/commit/36d9bdc64d18b6ad626d9bd5973eeb0969446ae6))
* keep the write guard sound around Zapp's exit, a cancel's USB check and a shutdown during a split write ([010b0e1](https://github.com/planetaryescape/keyloom/commit/010b0e1e7e8a8d908cd1f4f7c84cfe92c99e024c))
* let a written but unconfirmed flash be checked again, and never record a stale check or cancel answer ([5f1281c](https://github.com/planetaryescape/keyloom/commit/5f1281cb11929289fdb996e42da5796eaac2d601))
* link the places copy names, and drop offers that can't be taken ([93dd6d0](https://github.com/planetaryescape/keyloom/commit/93dd6d08d752c89a6c9e982f6e65bd1fc7cb4ce4))
* never let a Ctrl-C, shutdown or cancel cut off a keyboard write ([123ae98](https://github.com/planetaryescape/keyloom/commit/123ae9897bc1c343cd45c15e13c042681d9e14b6))
* never stop a flash once the keyboard is in its bootloader, and keep flash and Apply words true ([8367f70](https://github.com/planetaryescape/keyloom/commit/8367f7047eb112fe353098ec70dc16a7142467a0))
* offer only the locked provider's setup, and a way round a refusing Keychain ([849ae28](https://github.com/planetaryescape/keyloom/commit/849ae282065129d82edd971baa672ab7b5b494cb))
* read a flash's instruction code with its instruction, before the log read ([dbb6301](https://github.com/planetaryescape/keyloom/commit/dbb630155720a2873a7fda5f9f22e2eb1b390134))
* release the write guard and keep the error when a hands-free restart's callback throws ([c7f490d](https://github.com/planetaryescape/keyloom/commit/c7f490dd39671a2366eec7f6b7d99f938bf3309b))
* say why a root setup stopped, keep kanata's log root-only, and offer no password step for a kanata changed outside Homebrew ([cefab69](https://github.com/planetaryescape/keyloom/commit/cefab69ceaa65a27caad473fa3777f5feb36b49b))
* stop a ZMK build when keyloom can't check for or remove an earlier container ([bbadce9](https://github.com/planetaryescape/keyloom/commit/bbadce95299bd00ac69b375fb8c6e164af795cc8))
* stop all of Homebrew on Cancel, keep the newest log line in view, and record D-498 and D-503 ([0815b08](https://github.com/planetaryescape/keyloom/commit/0815b08a413f902537c1e3c4ab587a57d2b8204a))
* stop the desktop server cleanly on quit, timeout and exit, and say why Karabiner's settings can't be read ([a29702f](https://github.com/planetaryescape/keyloom/commit/a29702fc45a1592ab304ad7ade2d3880f36083f0))
* test the new shutdown cancel and the keyboard that only left USB ([7955392](https://github.com/planetaryescape/keyloom/commit/795539215e07cf94b461b175c38fe4dc4b31e1bc))
* the desktop app, chat setup and copy offer the way out (round 2) ([293c9ef](https://github.com/planetaryescape/keyloom/commit/293c9efe8063da6f28e8fcc4809a919535cbe3ef))
* treat a timed-out container check or removal as a failed ZMK build ([83f3b5a](https://github.com/planetaryescape/keyloom/commit/83f3b5a8007ca6f74d9cfed532c285e7835fc933))
* wait for zapp's loaded line before the slow-USB Ctrl-C test signals ([e50bf95](https://github.com/planetaryescape/keyloom/commit/e50bf9545812c652d6303dc864f692097fc49d3c))
* write a returning boot drive at its new path, and only when its half is proven ([3f990e3](https://github.com/planetaryescape/keyloom/commit/3f990e33ad4c97b4901a5d3a07bb5dfab1cc956c))

## [0.73.0](https://github.com/planetaryescape/keyloom/compare/v0.72.5...v0.73.0) (2026-11-11)


### Features

* give a mismatched layout, a failed comparison and a failed wall tile a way on ([ddb02b6](https://github.com/planetaryescape/keyloom/commit/ddb02b61e219f2c16eff9cdbd892263bb5385a62))
* install Docker and flash tools from the release dialog, and give manual boards their file ([baa1a17](https://github.com/planetaryescape/keyloom/commit/baa1a17b0ee9a7ecc88235650269267f0d5bacf9))
* install Docker and Zapp from Build and flash, and give manual boards their file ([d25d5bb](https://github.com/planetaryescape/keyloom/commit/d25d5bb180dcf3a9a884c28b7f624d0a31a5ac1e))
* put Sync now and Build and flash beside typing lab problems ([00ea02b](https://github.com/planetaryescape/keyloom/commit/00ea02b6f83e4c47df86c4d252990102e9d097ef))
* save a pasted API key in the system key store and use it without a restart ([5c77d8c](https://github.com/planetaryescape/keyloom/commit/5c77d8cc8ba86e1f3dcada507de3f8b9ce21b072))
* say once when keyloom stops answering, and give gone layouts and old links a way back ([1c2f435](https://github.com/planetaryescape/keyloom/commit/1c2f435e1e229678d356a7531ab3e800523f1456))
* set up a model from chat, the picker, the review and a refused key ([bf1eb75](https://github.com/planetaryescape/keyloom/commit/bf1eb759980fea1947f87fe986a2fb6618535c39))
* set up a model in the app and keep a pasted key in the Keychain ([de7fe0c](https://github.com/planetaryescape/keyloom/commit/de7fe0c00b7c2701e8027f6947398c756d6a75f1))
* set up kanata, replace its config and confirm the exit chord from the sync menu ([500eb86](https://github.com/planetaryescape/keyloom/commit/500eb86a3988df6928f96bb5b55bc501b76ddafe))
* start any engine the docker context names, and say what to install when there is none ([df2bc4a](https://github.com/planetaryescape/keyloom/commit/df2bc4a2c58e77c4c6c8771bf74434521348b71a))
* start Docker's engine instead of stopping the build ([c66d71c](https://github.com/planetaryescape/keyloom/commit/c66d71ce697e147382ff1cd8bd4c7991170570ce))
* sync, the MacBook keyboard and the app shell always offer a way forward ([319f632](https://github.com/planetaryescape/keyloom/commit/319f6328b9dc915b510a5784dd8e19240dd2ac5a))


### Bug Fixes

* act on [#270](https://github.com/planetaryescape/keyloom/issues/270)'s review: root plist, stale replace, exit-chord proof, Docker access and restarts ([c188465](https://github.com/planetaryescape/keyloom/commit/c188465cba941974a97c23affab1088f15e48731))
* carry the kanata daemon's plist inside the root script instead of reading it from the home folder ([65be290](https://github.com/planetaryescape/keyloom/commit/65be29023b46568bc65d52414e7bcd34e6a157a5))
* close the model setup dead ends from review ([97870c9](https://github.com/planetaryescape/keyloom/commit/97870c94f427b96cba4a6a7133e541bc55876d93))
* fail Forget when the key store times out or is killed ([77864db](https://github.com/planetaryescape/keyloom/commit/77864dbef43fa955a0204659adbdfd6e00548789))
* finish a failed replace's claim, wait for it on stop, probe the exit chord last, and give Colima its own access fix ([4c84a0f](https://github.com/planetaryescape/keyloom/commit/4c84a0fcffb64a43b5bad9daeae6867403a356df))
* keep the server-gone banner's sentence readable beside its command ([f7732d9](https://github.com/planetaryescape/keyloom/commit/f7732d9e8e12dadd9f8bdcfee39b537f657a051e))
* lay out the install callouts as a stack, and let the dev editor show flash and Docker states ([d1e3c68](https://github.com/planetaryescape/keyloom/commit/d1e3c68e4a080e40ae48924a01a6464178dcc5f7))
* let the Corne pair a new computer without a typed passkey ([e3fd0ac](https://github.com/planetaryescape/keyloom/commit/e3fd0ac933529ad8cf72ee0d001a545741f3ca62))
* let the Corne pair a new computer without a typed passkey ([234c538](https://github.com/planetaryescape/keyloom/commit/234c5380ab749e287b10c4e0ec78634b23b63ed9))
* never abort a flash that is already writing when the sync engine stops ([de27ed7](https://github.com/planetaryescape/keyloom/commit/de27ed711630ef4e513845c7dacc76eb6034424f))
* offer only the locked provider's setup in the chat bar ([c09fedf](https://github.com/planetaryescape/keyloom/commit/c09fedf12d70befed599327ae6d56ff1c3a92ceb))
* offer Resume auto-sync in the release dialog, and keep the decision log newest first ([3a08d9c](https://github.com/planetaryescape/keyloom/commit/3a08d9cc7f532864f904416afaaa042cdc8407e2))
* probe kanata before the CLI records the exit chord, and keep a config-file warning from blocking a Docker start ([a3ff718](https://github.com/planetaryescape/keyloom/commit/a3ff71864fa1597da250587678aad67b345ce60f))
* replace a foreign kanata config only while it is still foreign, and prove the exit chord only on a refused port ([70ad2cd](https://github.com/planetaryescape/keyloom/commit/70ad2cd5b743b288c99fb3e7761dd102a421cd14))
* tell a refused Docker socket from a stopped daemon, never restart a slow one, and give the launch the whole start window ([6082d42](https://github.com/planetaryescape/keyloom/commit/6082d4212934d351b0f55e48fd5b48e689afede6))
* tell people to replug a keyboard whose flash wasn't confirmed, not to run keyloom doctor ([f03ecd0](https://github.com/planetaryescape/keyloom/commit/f03ecd0e01ead5952a9ad74a089b26740ee0939e))
* treat any silent secret-tool exit but 1 as a failed delete ([210ccca](https://github.com/planetaryescape/keyloom/commit/210cccabaae1f092a893d9ab9fa9d8ab2e3b10cb))

## [0.72.5](https://github.com/planetaryescape/keyloom/compare/v0.72.4...v0.72.5) (2026-11-06)


### Bug Fixes

* let a computer re-pair over its own stale Bluetooth entry ([#268](https://github.com/planetaryescape/keyloom/issues/268)) ([fbaf545](https://github.com/planetaryescape/keyloom/commit/fbaf545563a79166691a27ff8272330f8b5f541b))

## [0.72.4](https://github.com/planetaryescape/keyloom/compare/v0.72.3...v0.72.4) (2026-11-05)


### Bug Fixes

* say an unavailable view open is unconfirmed, not that it never opened ([#266](https://github.com/planetaryescape/keyloom/issues/266)) ([264165c](https://github.com/planetaryescape/keyloom/commit/264165c014cc5767b69943ba3cc5586132f328d9))
* stop nesting the keyboard's cap buttons inside the wall's open button ([#265](https://github.com/planetaryescape/keyloom/issues/265)) ([ca9cecc](https://github.com/planetaryescape/keyloom/commit/ca9cecc68d5c02976fe6390a8591da69994e40ca))

## [0.72.3](https://github.com/planetaryescape/keyloom/compare/v0.72.2...v0.72.3) (2026-11-04)


### Bug Fixes

* sign the desktop app with its own keychain on BK's Mac ([#261](https://github.com/planetaryescape/keyloom/issues/261)) ([9f156ab](https://github.com/planetaryescape/keyloom/commit/9f156abfd6179c90486101fd7e882f06af716125))

## [0.72.2](https://github.com/planetaryescape/keyloom/compare/v0.72.1...v0.72.2) (2026-11-04)


### Bug Fixes

* state the cable cause instead of asking when a half won't restart ([#258](https://github.com/planetaryescape/keyloom/issues/258)) ([0ff2b3e](https://github.com/planetaryescape/keyloom/commit/0ff2b3ecdb6a4d0a419b17d05a4a89e45713320e))

## [0.72.1](https://github.com/planetaryescape/keyloom/compare/v0.72.0...v0.72.1) (2026-11-04)


### Bug Fixes

* give build and flash dialog more room ([#255](https://github.com/planetaryescape/keyloom/issues/255)) ([ee78e4c](https://github.com/planetaryescape/keyloom/commit/ee78e4c5c882f15ce4eccdecd853e01f5fe1a3e2))

## [0.72.0](https://github.com/planetaryescape/keyloom/compare/v0.71.1...v0.72.0) (2026-11-04)


### Features

* prompt before installing desktop updates ([#252](https://github.com/planetaryescape/keyloom/issues/252)) ([1e71c30](https://github.com/planetaryescape/keyloom/commit/1e71c30ec8b2b6252c57993506dff08255d0019c))


### Bug Fixes

* record only verified standalone flashes ([#253](https://github.com/planetaryescape/keyloom/issues/253)) ([4d60d0e](https://github.com/planetaryescape/keyloom/commit/4d60d0ed964bdeb6dcbb4e07a8b2cdbabd0291a9))

## [0.71.1](https://github.com/planetaryescape/keyloom/compare/v0.71.0...v0.71.1) (2026-11-03)


### Bug Fixes

* retry ZMK flash after USB connects ([63f715a](https://github.com/planetaryescape/keyloom/commit/63f715a65fc083047559b02d5ba8dc378f765b45))

## [0.71.0](https://github.com/planetaryescape/keyloom/compare/v0.70.2...v0.71.0) (2026-11-02)


### Features

* plan contextual recovery for refused proposals ([fb25e1f](https://github.com/planetaryescape/keyloom/commit/fb25e1fd3388ec9a9cc8b40615a8c21e0694bf7a))

## [0.70.2](https://github.com/planetaryescape/keyloom/compare/v0.70.1...v0.70.2) (2026-11-02)


### Bug Fixes

* make review repair requests clear and reachable ([b60669a](https://github.com/planetaryescape/keyloom/commit/b60669affb887fde30e65d373f7c7b7edd5329f6))
* plan repairs for individual review findings ([cc5f023](https://github.com/planetaryescape/keyloom/commit/cc5f0236d9ac6bc9deb74f12415e9404327d66af))
* scope board review repair requests ([c1ab5fc](https://github.com/planetaryescape/keyloom/commit/c1ab5fcab4f1c7e637f4e355900d961bb1615828))

## [0.70.1](https://github.com/planetaryescape/keyloom/compare/v0.70.0...v0.70.1) (2026-11-02)


### Bug Fixes

* pegboard 3D flight view transition pairing and mechanics ([48932ee](https://github.com/planetaryescape/keyloom/commit/48932ee479a82a1a9a9080d8eb49d4d53817dc7f))
* pegboard 3D flight view transition pairing and mechanics ([01c50d1](https://github.com/planetaryescape/keyloom/commit/01c50d1c763bdc79310e99699a64f580f9f4bd75))

## [0.70.0](https://github.com/planetaryescape/keyloom/compare/v0.69.0...v0.70.0) (2026-11-02)


### Features

* pegboard home page with flight transition to configurator ([36fbb86](https://github.com/planetaryescape/keyloom/commit/36fbb86b8af1099e672517127f7876d058762225))
* pegboard home page with flight transition to configurator ([993d14f](https://github.com/planetaryescape/keyloom/commit/993d14ff7391111de973069314d581bec31d47bb))


### Bug Fixes

* add pegboard wall navigation item to mobile menu ([a1dace5](https://github.com/planetaryescape/keyloom/commit/a1dace55419795ede2c7463c3878841a7c804f6e))

## [0.69.0](https://github.com/planetaryescape/keyloom/compare/v0.68.4...v0.69.0) (2026-11-02)


### Features

* manage keyboard collections and contribution handoffs ([c1c1fce](https://github.com/planetaryescape/keyloom/commit/c1c1fce3cc167e4230f29c716be55f78ef20e60a))

## [0.68.4](https://github.com/planetaryescape/keyloom/compare/v0.68.3...v0.68.4) (2026-11-02)


### Bug Fixes

* make review proposal changes readable ([2cc4606](https://github.com/planetaryescape/keyloom/commit/2cc46066992586ba1ea1a404b0dc3d7d4ccecc8e))

## [0.68.3](https://github.com/planetaryescape/keyloom/compare/v0.68.2...v0.68.3) (2026-11-02)


### Bug Fixes

* keep long review text inside the sidebar ([6023bbd](https://github.com/planetaryescape/keyloom/commit/6023bbdee61d7a3d7eeeb699b89e9c521a54eade))

## [0.68.2](https://github.com/planetaryescape/keyloom/compare/v0.68.1...v0.68.2) (2026-11-02)


### Bug Fixes

* refresh outdated connected reviews and lock unfinished results ([cdf1944](https://github.com/planetaryescape/keyloom/commit/cdf1944124ff276d47691dc54b18297ac3bbc291))

## [0.68.1](https://github.com/planetaryescape/keyloom/compare/v0.68.0...v0.68.1) (2026-11-01)


### Bug Fixes

* close review migration and verification edge cases ([a9d582c](https://github.com/planetaryescape/keyloom/commit/a9d582cf09699a6d1837e14cd52142805e1f6328))
* detect keyboard changes across review engine restarts ([188b504](https://github.com/planetaryescape/keyloom/commit/188b50489d4585f68808705db71b3775f7a9da2f))
* distinguish complete review fixes and refresh switched configs ([08c6afa](https://github.com/planetaryescape/keyloom/commit/08c6afab53f17847a612ae30ca07e6040c8d01a6))
* ground keyboard reviews and refresh changed keyboards ([ac09564](https://github.com/planetaryescape/keyloom/commit/ac095642884559f89814df34a3e93ef04b5b6eaa))
* ground keyboard reviews and refresh recommendations on reconnect ([edfff14](https://github.com/planetaryescape/keyloom/commit/edfff146a7f132257da0ef5a97c1492f7855dc84))
* keep the keyboard visible while reading long replies ([5c71e45](https://github.com/planetaryescape/keyloom/commit/5c71e456546b8af800ef5d8fc76e347a5d772d52))
* withdraw duplicate grounded review proposals ([e60c800](https://github.com/planetaryescape/keyloom/commit/e60c800187022515c9e90fe7b2a8aeec985d105b))

## [0.68.0](https://github.com/planetaryescape/keyloom/compare/v0.67.0...v0.68.0) (2026-11-01)


### Features

* independently test activity-based board review suggestions ([88c96ab](https://github.com/planetaryescape/keyloom/commit/88c96ab7448b78d8d0ff2a88f8b6de92d9738b90))

## [0.67.0](https://github.com/planetaryescape/keyloom/compare/v0.66.0...v0.67.0) (2026-11-01)


### Features

* evaluate keyboard configs against deterministic workloads ([223268d](https://github.com/planetaryescape/keyloom/commit/223268ded12f941a7ddbf8b47fc033c4dc2a895b))
* support per-layer encoders and recoverable agent replies ([0a28060](https://github.com/planetaryescape/keyloom/commit/0a2806000485743d59217584a46846091cbee86d))

## [0.66.0](https://github.com/planetaryescape/keyloom/compare/v0.65.0...v0.66.0) (2026-11-01)


### Features

* let the agent open existing app views ([f0aed75](https://github.com/planetaryescape/keyloom/commit/f0aed75df6797e4e748e820fe70381c67dd530ab))


### Bug Fixes

* say how to finish a shared-drive flash when a half is unplugged ([#217](https://github.com/planetaryescape/keyloom/issues/217)) ([5812213](https://github.com/planetaryescape/keyloom/commit/5812213635d3d093465e3ca59e36b747a4f1c6f8))

## [0.65.0](https://github.com/planetaryescape/keyloom/compare/v0.64.0...v0.65.0) (2026-10-30)


### Features

* link a reply's configs, proposals, layers and keys ([#215](https://github.com/planetaryescape/keyloom/issues/215)) ([e6b79e1](https://github.com/planetaryescape/keyloom/commit/e6b79e191cb1087f977dec0c385ec79b5c8b4a59))

## [0.64.0](https://github.com/planetaryescape/keyloom/compare/v0.63.0...v0.64.0) (2026-10-30)


### Features

* show what a copy carried ([#212](https://github.com/planetaryescape/keyloom/issues/212)) ([e508d27](https://github.com/planetaryescape/keyloom/commit/e508d279a39f29a962854953eb60fc151f7ef7a4))

## [0.63.0](https://github.com/planetaryescape/keyloom/compare/v0.62.0...v0.63.0) (2026-10-30)


### Features

* bring the Keebart Corne support onto main ([#210](https://github.com/planetaryescape/keyloom/issues/210)) ([ce53799](https://github.com/planetaryescape/keyloom/commit/ce53799db990d3615d600a35da1e9972c303f28b))

## [0.62.0](https://github.com/planetaryescape/keyloom/compare/v0.61.0...v0.62.0) (2026-10-30)


### Features

* fix the board review's findings in one agent run ([#208](https://github.com/planetaryescape/keyloom/issues/208)) ([44d2dae](https://github.com/planetaryescape/keyloom/commit/44d2daecb0399282aa309b725b39b6c1584a9615))

## [0.61.0](https://github.com/planetaryescape/keyloom/compare/v0.60.0...v0.61.0) (2026-10-30)


### Features

* set up a board keyloom knows but has no config for ([#206](https://github.com/planetaryescape/keyloom/issues/206)) ([b95012e](https://github.com/planetaryescape/keyloom/commit/b95012e2b959587b9048b0dcd47ef143bd77a01b))

## [0.60.0](https://github.com/planetaryescape/keyloom/compare/v0.59.1...v0.60.0) (2026-10-29)


### Features

* adapt copied setups in their own config conversation ([f7df5fb](https://github.com/planetaryescape/keyloom/commit/f7df5fb878af5257aac087fa870eaee7b00be548))

## [0.59.1](https://github.com/planetaryescape/keyloom/compare/v0.59.0...v0.59.1) (2026-10-29)


### Bug Fixes

* accept answers after the layout changes ([c2e790d](https://github.com/planetaryescape/keyloom/commit/c2e790d088210cf719171c7b9ecd6484856b3cf9))
* one timed-out test no longer cascades, evals answer refining questions, and keyloom layout settings shows the firmware settings ([#201](https://github.com/planetaryescape/keyloom/issues/201)) ([e894e6d](https://github.com/planetaryescape/keyloom/commit/e894e6dc25bb1c5f658832107f61eea201a6520c))

## [0.59.0](https://github.com/planetaryescape/keyloom/compare/v0.58.0...v0.59.0) (2026-10-29)


### Features

* one best proposal first, then questions that refine it (D-452) ([#199](https://github.com/planetaryescape/keyloom/issues/199)) ([e4ca3f5](https://github.com/planetaryescape/keyloom/commit/e4ca3f52d87e37b6624ac4fd01cb0389ede404d3))

## [0.58.0](https://github.com/planetaryescape/keyloom/compare/v0.57.0...v0.58.0) (2026-10-28)


### Features

* calmer result cards, a one-click cost footer and a neutral question card ([#193](https://github.com/planetaryescape/keyloom/issues/193)) ([e2f7194](https://github.com/planetaryescape/keyloom/commit/e2f7194e786b344b5f0b6b158db2878a53145311))

## [0.57.0](https://github.com/planetaryescape/keyloom/compare/v0.56.1...v0.57.0) (2026-10-28)


### Features

* clients check they have a keyloom they can work with, and a keyloom refuses a database a newer one migrated ([#196](https://github.com/planetaryescape/keyloom/issues/196)) ([f8a476e](https://github.com/planetaryescape/keyloom/commit/f8a476ede246b22d5b062d5ca7b55ae213c5720b))

## [0.56.1](https://github.com/planetaryescape/keyloom/compare/v0.56.0...v0.56.1) (2026-10-28)


### Bug Fixes

* a board can record that its firmware has lighting controls, so a copy keeps RGB keys on the Glove80 ([#190](https://github.com/planetaryescape/keyloom/issues/190)) ([e096d4f](https://github.com/planetaryescape/keyloom/commit/e096d4fff240adeb1acee167e33ecfc3f5cdec4d))
* a copy skips Print Screen on the MacBook, and Settings shows Caps Word on when a Caps Word key turns it on ([#194](https://github.com/planetaryescape/keyloom/issues/194)) ([ae08799](https://github.com/planetaryescape/keyloom/commit/ae0879952350d1527c8a0d31bfd8439a44373b58))
* dev servers draw the live Moonlander board with the synchronized Oryx layout ([#189](https://github.com/planetaryescape/keyloom/issues/189)) ([333c666](https://github.com/planetaryescape/keyloom/commit/333c6669d7f12a5d42d6e6c14792a3a539acf6c1))
* read ZMK layer defines on kept keys, and see risky steps behind macro controls ([#192](https://github.com/planetaryescape/keyloom/issues/192)) ([7285c13](https://github.com/planetaryescape/keyloom/commit/7285c13d31fdabf872abf22dbb24e0ec877f7c7e))

## [0.56.0](https://github.com/planetaryescape/keyloom/compare/v0.55.0...v0.56.0) (2026-10-28)


### Features

* keyloom web starts the web app, as another name for serve ([#186](https://github.com/planetaryescape/keyloom/issues/186)) ([cbfc591](https://github.com/planetaryescape/keyloom/commit/cbfc5910718e6a319e9e8ce6cd8597c1810c2b20))


### Bug Fixes

* let the board's shadow fade past the stage when the board fits ([#188](https://github.com/planetaryescape/keyloom/issues/188)) ([ef5643f](https://github.com/planetaryescape/keyloom/commit/ef5643f720df1cdd52a34513a772701cf3b74b96))

## [0.55.0](https://github.com/planetaryescape/keyloom/compare/v0.54.0...v0.55.0) (2026-10-23)


### Features

* copying a layout translates the firmware codes the new keyboard can do ([#184](https://github.com/planetaryescape/keyloom/issues/184)) ([da49da4](https://github.com/planetaryescape/keyloom/commit/da49da46a5609dd87fbcb13a9111a7b20964a761))

## [0.54.0](https://github.com/planetaryescape/keyloom/compare/v0.53.2...v0.54.0) (2026-10-23)


### Features

* agent-made configs open themselves and the reply carries a config card ([#179](https://github.com/planetaryescape/keyloom/issues/179)) ([2058768](https://github.com/planetaryescape/keyloom/commit/205876887db651f32f36febd00a1596c4c465547))


### Bug Fixes

* bound typing-capture writes and close so a stuck transport can't hang the lab ([#182](https://github.com/planetaryescape/keyloom/issues/182)) ([b0c3ca3](https://github.com/planetaryescape/keyloom/commit/b0c3ca3e930733e312ac2337b93a0f1ddbbea056))
* close the silent misses in layer numbers kept in firmware code ([#175](https://github.com/planetaryescape/keyloom/issues/175)) ([a863dbe](https://github.com/planetaryescape/keyloom/commit/a863dbee48648f420d63ec11689a43d9b6bcff37))
* express the transport protocol's runtime checks in its JSON Schema ([#176](https://github.com/planetaryescape/keyloom/issues/176)) ([0df6609](https://github.com/planetaryescape/keyloom/commit/0df6609e330a839c83026034fae27ca23f6bf9b0))
* keep lab start's JSON stderr to the error object ([#172](https://github.com/planetaryescape/keyloom/issues/172)) ([cf55ec3](https://github.com/planetaryescape/keyloom/commit/cf55ec39baaac38885d02ba668dac32fcc8483b3))
* match doctor's permission hint to the board's own USB serial ([#171](https://github.com/planetaryescape/keyloom/issues/171)) ([d4f323c](https://github.com/planetaryescape/keyloom/commit/d4f323cbe94d776f4e8bd59e50491e126fd18aed))
* pass model provider settings from the login shell to the desktop app's keyloom ([#181](https://github.com/planetaryescape/keyloom/issues/181)) ([dc107c3](https://github.com/planetaryescape/keyloom/commit/dc107c3fea27e1a9480f61a67ae00bbcd310957b))
* refuse a UF2 flash while the macOS screen is locked ([#178](https://github.com/planetaryescape/keyloom/issues/178)) ([d62332e](https://github.com/planetaryescape/keyloom/commit/d62332e033f2f519419a49f5e47a59c0caeeec87))
* report invalid_session for a write to an unknown serial session ([#169](https://github.com/planetaryescape/keyloom/issues/169)) ([aea4a9a](https://github.com/planetaryescape/keyloom/commit/aea4a9a1aacbee7620ae594da01d3085995fa859))
* treat older recordings that lost events as incomplete ([#173](https://github.com/planetaryescape/keyloom/issues/173)) ([3f797d8](https://github.com/planetaryescape/keyloom/commit/3f797d824ace2c106920d3fe5788d783442f8a57))
* wait for a manual flash that is still starting before shutdown closes the helper ([#177](https://github.com/planetaryescape/keyloom/issues/177)) ([ef2e8f0](https://github.com/planetaryescape/keyloom/commit/ef2e8f077815dd6e446598192c6d111e5870ebdf))

## [0.53.2](https://github.com/planetaryescape/keyloom/compare/v0.53.1...v0.53.2) (2026-10-22)


### Bug Fixes

* set the macOS touch rate with IOSSIOSPEED so the 1201 relay works ([#165](https://github.com/planetaryescape/keyloom/issues/165)) ([d9d7f81](https://github.com/planetaryescape/keyloom/commit/d9d7f81f792038c338c54d919a45f2142fca49c1))
* start the desktop app's keyloom with the login shell's PATH ([#167](https://github.com/planetaryescape/keyloom/issues/167)) ([d5ac21f](https://github.com/planetaryescape/keyloom/commit/d5ac21f0a4f61bf55794474439d10b0b48420a92))

## [0.53.1](https://github.com/planetaryescape/keyloom/compare/v0.53.0...v0.53.1) (2026-10-22)


### Bug Fixes

* wait for a UF2 boot drive to be mounted before writing to it ([#161](https://github.com/planetaryescape/keyloom/issues/161)) ([3e3ec42](https://github.com/planetaryescape/keyloom/commit/3e3ec42b574bddc6c7934a71f1ab122658f53df7))

## [0.53.0](https://github.com/planetaryescape/keyloom/compare/v0.52.0...v0.53.0) (2026-10-22)


### Features

* roll a split ZMK flash back so both halves stay on the same build ([3a693cd](https://github.com/planetaryescape/keyloom/commit/3a693cd141218aaea734de3887540479c4b508d7))

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
