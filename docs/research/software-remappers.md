# Software remappers for the MacBook keyboard: Karabiner-Elements and kanata

Research for BK's request: "I would like to have the features that karabiner has or if I install karabiner elements kanata, this configurator should be able to configure that as well so that I can get my macbook keyboard to behave like the other keyboards."

Date: 2026-10-15. Nothing here is committed, and no source file in keyloom was changed.

## Findings in short

- Build kanata first, behind one install spike. Its config is a positional list per layer, which is keyloom's own model (binding N is key N). It has tap-hold variants that line up with BK's QMK and ZMK hold-tap options. It validates a config without grabbing the keyboard (`--check`), it can be tested headless, and it confirms a reload over TCP.
- Karabiner-Elements second. It is already installed on BK's Mac, its safety story is better, and it needs no root daemon. It is weaker on tap-hold, and nothing can read back what it is running.
- BK already has a hand-written Karabiner config in his dotfiles with home-row mods, a Space-hold layer, six simultaneous combos and a Hyper rule. keyloom must import that as passthrough and own only its own rules.
- The two remappers cannot both grab the built-in keyboard (both seize the device). Coexistence means splitting devices, and the driver versions matter. Upgrading Karabiner-Elements to 16.3.0 installs driver 8.5.0, which breaks kanata 1.12.0.
- The MacBook is not a firmware board. keyloom's board schema needs a "software" kind with no build, no flash and no pinned firmware tree, and the mirror tests cannot hold a row-staggered unibody board as written.

## How to read the evidence tags

"Verified" means I read it in the primary source named next to it, or observed it on BK's machine. "Unverified" means inferred, remembered, or not checked. Every claim carries one or the other.

Pinned references:

| Thing | Ref |
|---|---|
| keyloom | `origin/main` `898dec65d8c8f1c3ac0740434c9a99be068420c6`, fetched 2026-10-15 |
| keyloom rung 19 code | uncommitted files in `.worktrees/keyloom-r19` (branch `rung19/cross-board`), not on origin/main |
| Karabiner-Elements source | `pqrs-org/Karabiner-Elements@7d32eb20ee5e93d842966375e7f8761e21baceaa` (main); latest release v16.3.0, 2026-09-06 |
| Karabiner docs | karabiner-elements.pqrs.org/docs, fetched 2026-10-15, pages carry "Last modified" dates given below |
| Karabiner driver bundled in v16.3.0 | `Karabiner-DriverKit-VirtualHIDDevice@bdfcb459b2eaca8ccda680a73b0dc898f330f4bb` = tag v8.5.0 |
| kanata source and docs | `jtroo/kanata@44edba27f9849b2494a4b9f5f003a4a5e932e277` (main, version 1.13.0-prerelease-2) |
| kanata release | v1.12.0, tag commit `02242ef761ef43b860eac30067ce86904be7d466`, 2026-07-05. v1.13.0-prerelease-1 is 2026-10-08 |

Where a kanata claim depends on the release, I checked it at both refs.

## What BK has on this Mac today

All observed on 2026-10-15.

- The machine is a MacBook Pro `Mac15,9`, Apple M3 Max, US keyboard. `ioreg -c AppleEmbeddedKeyboard` shows product "Apple Internal Keyboard / Trackpad", `Built-In = Yes`, VendorID 0, ProductID 0, Transport `FIFO`, `KeyboardLanguage = U.S.`. Verified.
- Karabiner-Elements app is 15.7.0 (`defaults read ... CFBundleShortVersionString`). Homebrew's cask is at 16.3.0. The driver package is `org.pqrs.Karabiner-DriverKit-VirtualHIDDevice` 6.5.0 (`pkgutil --pkg-info`). Verified.
- The driver extension process is running, but Karabiner's own services are not: `karabiner_cli --list-connected-devices` fails with "core_service_client connect_failed: No such file or directory", and the newest file in `~/.local/share/karabiner/log` is dated 2025-11-21. Verified. BK may have Karabiner quit or never relaunched.
- `kanata` is not installed. Homebrew has kanata 1.12.0, licence LGPL-3.0-only. Verified (`brew info`).
- `~/.config/karabiner` is a symlink to `../.dotfiles/.config/karabiner`. `karabiner.json` inside it is a regular 26 KB file, tracked in BK's dotfiles git repo. Verified.
- The profile "Default profile" has no simple modifications, 6 complex rules, 2 device entries and `keyboard_type_v2: ansi`. The two device entries are `ignore: true` for vendor 12951 and vendor 5824, which are BK's external boards. Verified.
- The six rules are, by description: Space tap for Space and hold for a Vim navigation layer; Shift tap for F13 and hold for Shift; six simultaneous combos; "Home-row Mods - roll = tap" (6 manipulators using `to_if_held_down`, `to_delayed_action` and `to_if_alone`); g and h as Hyper when explicitly held; one rule with the description "None". Verified.

BK's request is therefore not about starting from nothing. He has already built part of his Moonlander behaviour in Karabiner by hand, and the file is a source of truth he keeps in git.

## 1. Karabiner-Elements

### File and format

- The file is `~/.config/karabiner/karabiner.json`. Karabiner reads `$XDG_CONFIG_HOME/karabiner` if set, else `$HOME/.config/karabiner`. Verified: `src/share/constants.hpp#L83` and `#L135` (`get_user_configuration_directory`, `get_user_core_configuration_file_path`) and docs "File locations" (2026-01-21).
- Shape: `global`, then `profiles[]`. Each profile has `name`, `selected`, `simple_modifications`, `fn_function_keys`, `complex_modifications` (`parameters`, `rules[]`), `virtual_hid_keyboard`, `devices[]` and `parameters`. A rule has `description`, `description_notes`, `manipulators[]`. A manipulator has `type: basic`, `from`, `to`, `to_if_alone`, `to_if_held_down`, `to_after_key_up`, `to_delayed_action {to_if_invoked, to_if_canceled}`, `conditions`, `parameters`, `description`. Verified: docs "karabiner.json data structure" (2026-08-15).
- Comments in the JSON are allowed but all comments are lost when the Settings UI saves. Verified: same page.
- The second place rules can live is `~/.config/karabiner/assets/complex_modifications/*.json` (`{title, rules}`), but those only appear under "Add predefined rule" in the UI. They are not active until BK clicks. That is no use for an instant Apply. Verified: docs "File locations" and the data-structure page.
- Rules are evaluated top to bottom, and only the first matching manipulator acts on an event. Verified: docs "complex_modifications manipulator evaluation priority" (2026-01-21).
- Simple modifications run first, then complex modifications, and the output of the first feeds the second. Verified: same page.

### The timing parameters

Defaults are in `src/share/core_configuration/details/profile/complex_modifications_parameters.hpp#L19-L37` (verified):

| Parameter | Default | Range |
|---|---|---|
| `basic.simultaneous_threshold_milliseconds` | 50 | 0 to 1000 |
| `basic.to_if_alone_timeout_milliseconds` | 1000 | 0 and up |
| `basic.to_if_held_down_threshold_milliseconds` | 500 | 0 and up |
| `basic.to_delayed_action_delay_milliseconds` | 500 | 0 and up |

They can be set per profile (`complex_modifications.parameters`) or per manipulator (`parameters`). Verified: docs "to_if_alone" (2026-02-07) show the per-manipulator form.

- `to_if_alone` posts when the from key is released alone. It is cancelled if any other key, button or wheel event happens while the key is down, and also if the key is held past the timeout. It posts key down and key up together, so it cannot repeat. Verified: docs "to_if_alone".
- `to_if_held_down` posts when the key has been down for the threshold. If `to` is also set, the `to` key up is sent first. Its docs warn that events may not fire in the order the keys were pressed when typing fast, and show a longer pattern for letter keys (the "f becomes shift when held" example) built from `to_if_alone` with `halt`, `to_if_held_down`, and `to_delayed_action.to_if_canceled` that re-sends the letter. Verified: docs "to_if_held_down" (2026-02-07).
- `to_delayed_action` posts `to_if_invoked` after the delay if no other key came, else `to_if_canceled`. Verified: docs "to_delayed_action". The docs use it for double-tap (the Command-Q twice example uses a variable).
- `to_if_other_key_pressed` (since Karabiner-Elements 16.0.0, NEWS.md#L107) changes the held key into something else when one of a list of other keys goes down. `other_keys` entries are from-event definitions, so they can name specific keys. It only reacts to key down: `to_if_other_key_pressed.hpp#L73` and `#L109` return early unless the event type is `key_down`. Verified. BK's installed app is 15.7.0, so this needs an upgrade.
- `to.lazy` makes a modifier send only if another key arrives. Verified: docs "to.lazy".

### Combos, layers, devices, shell

- Combos: `from.simultaneous` fires when the listed keys go down within the threshold (50 ms default). It does nothing if a key is released before all are down, or if an unrelated key goes down in between (unless `detect_key_down_uninterruptedly` is true). `simultaneous_options` also has `key_down_order`, `key_up_order`, `key_up_when` and `to_after_key_up`. Verified: docs "from.simultaneous" and "from.simultaneous_options".
- Layers: there is no layer object. A layer is a variable. `to.set_variable {name, value, key_up_value}` sets it, and `conditions: [{type: variable_if, name, value}]` gate the layer's manipulators. `expression` and `key_up_expression` (since 15.5.19) allow a toggle (`my_flag != 0 ? 0 : 1`) and a time stamp (`system.now.milliseconds`). Verified: docs "to.set_variable" (2026-08-12).
- Device conditions: `device_if`, `device_unless`, `device_exists_if`, `device_exists_unless`, with `identifiers` that include `is_built_in_keyboard` (since 14.8.2), `vendor_id`, `product_id`, `is_keyboard`, `is_touch_bar`, `device_address`, `location_id`. Several fields in one entry are ANDed, several entries are ORed. Verified: docs "device_if" (2026-08-12).
- How the built-in keyboard is recognised: a product string containing "Apple Internal " on a keyboard that is not a pointing device, or transport `FIFO` with the keyboard flag. `src/share/device_properties.hpp#L62-L105`. Verified. BK's `ioreg` output matches the FIFO case.
- A device the user marks `ignore: true` in a profile's `devices[]` is not seized. Apple pointing devices (the trackpad) are ignored by default unless configured otherwise. `src/share/device_utility.hpp#L14-L22`. Verified.
- Shell: `to.shell_command` runs a command with a very limited environment (`$HOME`, `$UID`, `$USER`). Verified: docs "to.shell_command". keyloom should not generate it.
- Sticky modifiers: `to.sticky_modifier: {left_shift: "on" | "off" | "toggle"}`, for all eight modifiers and `fn`. The docs do not say when a sticky modifier releases. Verified for the syntax, unverified for the release rule.

### What each keyloom feature becomes in Karabiner

| keyloom | Karabiner | Fit |
|---|---|---|
| `key` with mods | `to: [{key_code, modifiers: [...]}]` (doc examples use `"modifiers": ["left_command"]`) | Exact. Verified. |
| `modifier` (including Command+Shift) | `to: [{key_code: left_command, modifiers: [left_shift]}]` or two `to` entries | Exact. Unverified for the two-modifier form. |
| `holdTap`, hold = mods | `to_if_alone` + `to_if_held_down` + `to_delayed_action.to_if_canceled`, timings in `parameters` | Works, one manipulator per key. This is the shape BK's existing HRM rule already uses. Verified shape. |
| `holdTap`, hold = layer | `to: set_variable` with `key_up_value`, plus `to_if_alone` for the tap | Works. This is BK's Space rule. Verified. |
| Permissive hold (decide on the other key's release) | No documented equivalent. `to_if_other_key_pressed` decides on press. | Gap. Verified for press-only. |
| Chordal hold / opposite-hand (ZMK `hold-trigger-key-positions`) | `to_if_other_key_pressed` with `other_keys` listing the opposite hand's keys | Close. Press-based. Inference, unverified in use. |
| Flow Tap / `require-prior-idle` | Nothing native. A variable with `system.now.milliseconds` expiry could emulate it. | Gap. Unverified. |
| Layer momentary | `set_variable` with `key_up_value: 0` | Exact. Verified. |
| Layer toggle | `set_variable` with an `expression` toggle | Exact. Verified. |
| Layer to | `set_variable` set, with other layers cleared | Workable. Unverified. |
| Layer one-shot | Variable cleared by every layer manipulator | Fragile, ordering-sensitive. Unverified. |
| Transparent | Absence of a manipulator in that layer | Exact by construction. |
| Tap dance | Variable plus `to_delayed_action` for the double-tap; tap-then-hold needs more state | Double-tap works (the docs show it). Other slots unverified. |
| Combos | `from.simultaneous` | Good. Threshold is global per profile or per manipulator. Verified. |
| Macros | A list of `to` events | Keys yes. There is no wait event in the `to` fields; `hold_down_milliseconds` is the nearest. Unverified for timed macros. |
| One-shot mods | `sticky_modifier` | Syntax verified; release rule unverified. |
| Caps Word | No documented equivalent | Gap. Emulation needs a manipulator per letter key. Unverified. |
| Option-Option (BK's macro) | `to: [left_option, left_option]` with `hold_down_milliseconds` | Probably, unverified in apps that watch for double Option. |

### What Karabiner does less well than QMK

- It decides hold versus tap at the event layer after macOS has already received the HID events, so timing is whatever its manipulator queue gives. I did not measure latency. Unverified.
- No release-based decision (permissive hold) and no prior-idle gate (Flow Tap), per the table. Everything is built from per-key patterns in JSON, so there is no single "home row mod profile". Tuning means rewriting every manipulator's `parameters`.
- Ordering is a hazard: first match wins, so a layer's manipulators must sit above the base ones, and a hand-written rule above keyloom's block shadows it silently.
- Karabiner has a hard-to-reason-about file size and shape: a 12-key HRM plus layers plus combos becomes hundreds of manipulators.
- It cannot see Touch ID. Karabiner's docs say fingerprint authentication is a separate device, unaffected by remapping, and the Touch ID press event is turned into a Lock key. Verified: docs "Implicit behavior".
- No simulator exists in the product. The CLI offers `--lint-complex-modifications` for JSON files in the `{title, rules}` form, `--select-profile`, `--list-profile-names`, `--list-connected-devices`, `--set-variables`. Verified: `src/bin/cli/src/main.cpp#L195-L270` and docs "Command line interface" (2026-08-30). Whether lint accepts a whole `karabiner.json` is unverified.

### How a change reaches the running remapper

- Karabiner watches the parent directory `~/.config/karabiner` with the File System Events API and reloads on change. It does not notice changes if the parent directory is recreated. Verified: docs "File locations".
- `configuration_monitor.hpp` loads the new file, and if parsing fails it reports the parse error and does not publish a new configuration, so the previous one keeps running (`#L142` returns before `core_configuration_updated` at `#L159`). Errors go to `~/.local/share/karabiner/log/console_user_server.log` and the Log tab. Verified.
- Apply is therefore: write the file, and it is live. Latency was not measured. BK's directory is a symlink, so whether FSEvents reports writes through it is unverified (spike S4).
- The file must be owned by root or the current user, or the load is refused. Verified: `core_configuration.hpp#L223` (`allowed_owners = {0, expected_file_owner}`) and docs "json-owner-is-invalid".

### Rules for tools that write `karabiner.json`

- When Karabiner itself saves, it writes `karabiner.json.tmp` and renames it over the file, which replaces a symlinked file with a regular one. It first copies the old file to `automatic_backups/karabiner_YYYYMMDD.json` once a day. `json_writer.hpp#L47` and `core_configuration.hpp#L265-L305`. Verified. BK's directory is the symlink, not the file, so a rename inside it lands in the dotfiles repo. Verified from the layout, not tested.
- Rule objects keep unknown keys through a UI save (`complex_modifications_rule.hpp#L145` "Allow unknown key", and `to_json()` returns the stored JSON). So a rule can carry a marker key such as `"x-keyloom": {...}` and Karabiner will not strip it. Verified for rules and for manipulators (`#L58`). Not verified for a real UI save.
- A rule has an `enabled` boolean (default true, `complex_modifications_rule.hpp#L95`). That is a per-rule kill switch keyloom can use. Verified.
- A malformed rule can stop the whole file loading (a rule with no manipulators throws, `#L153`). keyloom must validate before writing. Verified.
- Concurrent UI saves can overwrite a keyloom write. No lock exists. keyloom should compare a hash of what it read before it renames, and keep its own backup. Unverified as a race, verified that there is no lock in the code I read.
- Ownership boundary I recommend: keyloom owns exactly the rules that carry its marker key, plus the description prefix `keyloom:` so they are visible in the UI. It never edits `devices`, `virtual_hid_keyboard`, `global` or any other rule. A second option is a whole profile named `keyloom`, switched with `karabiner_cli --select-profile`. That is cleaner to own, but a new profile starts without BK's `devices` ignores and keyboard type, which keyloom would have to copy once.

## 2. kanata

### The config language

All of this is verified in `docs/config.adoc` at `44edba2`, and I confirmed the features named below exist at tag v1.12.0 by grepping that tree.

- `defsrc` lists the physical keys. Each `deflayer name ...` is a list of actions in the same order as `defsrc`. That is keyloom's own rule: position N is binding N. `#L116-L215`.
- `defalias` names actions. `defvar` holds numbers. `deflayermap` is an alternative that names key-action pairs. `defcfg` holds options, among them `process-unmapped-keys`, `concurrent-tap-hold`, `chords-v2-min-idle`, `tap-hold-require-prior-idle`, `delegate-to-first-layer`, `block-unmapped-keys`, `danger-enable-cmd`.
- Tap-hold: `tap-hold` (hold on timeout only), `tap-hold-press` (hold early when another key is pressed), `tap-hold-release` (hold early when another key is pressed and released), `-timeout` variants, `tap-hold-release-keys`, `tap-hold-except-keys`, `tap-hold-tap-keys`, `tap-hold-keys` with `tap-on-press`, `tap-on-press-release`, `hold-on-press` lists, `tap-hold-opposite-hand` and `tap-hold-opposite-hand-release` (needs `defhands`), and `tap-hold-order`. Every variant takes a tap-repress timeout and a hold timeout, and an optional `(require-prior-idle ms)`. `#L2012-L2413`.
- `defhands (left ...) (right ...)` assigns keys to hands, and `tap-hold-opposite-hand` has options `timeout`, `same-hand`, `neutral-keys`, `neutral`, `unknown-hand`, `require-prior-idle`, `tap-repress-timeout`. `#L2358-L2413`. A shipped example is `cfg_samples/opposite-hand-hrm.kbd`.
- Chords: `defchordsv2` with `(keys) action timeout release-behaviour (disabled-layers)` per chord. It requires `concurrent-tap-hold yes`. `#L4104-L4188`. The older v1 chords are per layer.
- Tap dance: `(tap-dance timeout (a b c))` and `tap-dance-eager`. `#L1786-L1862`.
- One-shot: `one-shot`, `one-shot-release`, `one-shot-press-pcancel`, `one-shot-release-pcancel`. `#L1864-L1970`.
- Caps word: `caps-word`, `caps-word-toggle`, `caps-word-custom`, `caps-word-custom-toggle`. `#L2696-L2805`.
- Layers: `layer-while-held` (momentary), `layer-toggle` (same thing), `layer-switch` (changes the base layer permanently), `_` transparent. kanata keeps a stack made of temporary held layers, one base layer and `defsrc`. `#L857-L956`.
- Macros: `(macro a b 100 c)` where a number is a delay in ms; variants that cancel on release or press; `macro-repeat`. Unicode output by codepoint. `#L2414-L2615`.
- Output modifiers by prefix: `C-`, `S-`, `A-`, `M-` and the `R` variants (`M-` is left Meta, which is Command on a Mac). `#L1092-L1135`.
- Also present and useful: `fork`, `switch` (with key history and `layer` and `device-history` conditions), `sequence-timeout` sequences, `defvirtualkeys`, `include`, `deftemplate`, `platform (macos)` blocks, `defoverridesv2`.
- Danger: `cmd` actions need the `danger-enable-cmd yes` option and a binary built with `cmd`. keyloom should never emit them. `#L4693`.

### Is kanata the closest to QMK?

Mostly yes, with one real difference.

- Where it matches: hold-tap behaviours that QMK exposes as `PERMISSIVE_HOLD` (kanata `tap-hold-release`), `HOLD_ON_OTHER_KEY_PRESS` (`tap-hold-press`), `CHORDAL_HOLD` (`tap-hold-opposite-hand`, and the `-release` variant is stricter), `FLOW_TAP_TERM` (`require-prior-idle`), `QUICK_TAP_TERM` (`tap-repress-timeout`). ZMK's flavors and `hold-trigger-key-positions` are the same ideas. The names of the kanata behaviours are verified; the equivalence to QMK and ZMK options is my inference from the docs and needs the golden tests in spike S6. Combos, tap dance, caps word, one-shot, macros and a virtual-key escape hatch all exist.
- Where it differs: layers are not an arbitrary stack. There is one base layer (changed by `layer-switch`), a stack of held layers, and `defsrc`. keyloom's `toggle` (turn a layer on over whatever is below it, as QMK `TG` does) has no direct kanata action. A transparent key in a toggled-on layer falls to the next layer in kanata's stack, not to the layer that was active before the toggle. The generator must flatten, which is exact when the toggle sits over one known base. Verified for the stack model, inference for the consequence.
- kanata has per-action timings in every tap-hold, which is more flexible than QMK's global `TAPPING_TERM` plus per-key functions. keyloom's `holdTapProfiles` map to a set of aliases, one per profile and tap/hold pair.
- A keyloom tap dance with a hold slot has no direct form, because kanata's `tap-dance` counts taps. A `tap-hold` can sit inside the action list. Unverified; test in S6.

### How it runs on macOS

- kanata grabs the keyboard through the Karabiner-DriverKit-VirtualHIDDevice driver. The process must run as root, because the driver daemon's socket lives under `/Library/Application Support/org.pqrs/tmp/rootonly/`. `docs/setup-macos.md#L1-L10`. Verified.
- It needs Input Monitoring and Accessibility permission for the kanata binary. `kanata --macos-request-permissions` asks macOS to list it. `docs/setup-macos.md` step 4. Verified.
- At v1.12.0 the supported driver is v6.2.0 (`git show v1.12.0:docs/setup-macos.md`). On main, for the unreleased 1.13.0, it is v8.0.0, because that release moves to protocol 7. Verified. I confirmed the protocol numbers in the driver's own `client_protocol_version.hpp`: v6.2.0 and v6.5.0 are protocol 5, v8.0.0 and v8.5.0 are protocol 7. kanata's `karabiner-driverkit` crate 0.3.1 (used by v1.12.0) embeds 5 and 0.4.0 (main) embeds 7. Verified.
- BK's driver package is 6.5.0, which is protocol 5. So kanata 1.12.0 should work with it. Inference from matching protocol numbers, unverified in use.
- Karabiner-Elements v16.3.0 bundles driver v8.5.0 (the submodule pointer at the v16.3.0 tag is `bdfcb45`). Upgrading Karabiner to the current release would put protocol 7 on the machine, and kanata 1.12.0 would stop working until the 1.13.0 release. Verified for the pointer and protocols; I did not test what the KE installer replaces. Homebrew's cask is already at 16.3.0.
- The daemon: with Karabiner-Elements installed it manages the VirtualHID daemon. Without it, the daemon has to be started by a LaunchDaemon plist (`cfg_samples/karabiner-vhid-daemon.plist`). `docs/setup-macos.md` step 2. Verified.
- Persistence: `cfg_samples/kanata.plist` is a LaunchDaemon (`UserName root`, `RunAtLoad`, `KeepAlive {SuccessfulExit: false}`, log to `/var/log/kanata.log`). Reload after a plist or config change with `sudo launchctl kickstart -k system/dev.kanata.kanata`. Verified.
- Default config path if `-c` is omitted: `kanata.kbd` in the working directory or `$HOME/Library/Application Support/kanata/kanata.kbd`. `src/main_lib/args.rs#L20-L28`. Verified.
- kanata's core maintainer supports Windows and Linux. The platform-issues doc says so and lists macOS notes separately. `docs/platform-known-issues.adoc#L18` and `#L89`. Verified. macOS is a community-maintained platform. Two open issues touch BK's use: #975 "F-row key get override on MacOS" and #1311 "fn does not toggle Touch Bar change on Mac" (Touch Bar models only; a 2023 MacBook Pro has none, unverified for Mac15,9). Verified that the issues exist, not reproduced.
- `--release-grab-on-lock` (in v1.12.0, `args.rs`) releases the keyboard while the screen is locked or another user holds the console. Verified.

### Selecting only the built-in keyboard

- `defcfg macos-dev-names-include ("Apple Internal Keyboard / Trackpad")` grabs only that device. `macos-dev-names-exclude` does the opposite. `kanata --list` prints the names. `docs/config.adoc#L5495-L5540`. Verified.
- The name match is an exact string compare against the device's product string (`c_src/driverkit.cpp`, `device_matches`, `CFStringCompare ... kCFCompareEqualTo`, in `karabiner-driverkit-0.4.0`). The crate's own self-test uses `"Apple Internal Keyboard / Trackpad"`. That equals the string `ioreg` shows on BK's machine. Verified. Vendor and product IDs are 0 on the built-in keyboard, so selection by ID would not work. Verified from the `ioreg` output.
- kanata skips devices whose name contains "Karabiner" (`register_device_hash` in the same file), so it should not re-grab Karabiner's virtual keyboard. Verified for that code path.
- `macos-continue-if-no-devs-found yes` keeps kanata running when no matching device is connected. With a laptop and no device filter, the built-in keyboard is always found. Verified.
- `definputdevices` plus `(device-history ...)` in a `switch` gives per-device behaviour inside one config, and the docs example literally names `(name "Apple Internal Keyboard")` and a Go60. It is macOS only and matched at startup. Verified.

### Live reload and the TCP server

- Keyboard reload: `lrld`, `lrld-next`, `lrld-prev`, `(lrld-num n)`. If the file does not parse, the previous config stays active. After a reload the active layer is the first `deflayer`. A reload does not re-read device options (`macos-dev-names-include` etc.). `docs/config.adoc#L776-L856`. Verified.
- TCP: start with `-p 127.0.0.1:7070`. If only a port is given, kanata listens on all addresses, so keyloom must pass the loopback address. The protocol is newline-terminated JSON. `docs/config.adoc#L5903-L5920`. Verified.
- Client commands that matter: `Reload`, `ReloadFile {path}`, `ReloadNext`, `ReloadPrev`, `ReloadNum {index}`, each with optional `wait: true, timeout_ms` which makes the server answer `{"ReloadResult":{"ok":true}}`. Also `RequestLayerNames`, `RequestCurrentLayerName`, `RequestFakeKeyNames`, `ChangeLayer`, `ActOnFakeKey`, `Hello` (version, protocol, capabilities). Notifications: `LayerChange`, `ConfigFileReload`, `MessagePush`, `HoldActivated`, `TapActivated`, `Error`. `#L5927-L6090`. Verified. All of these are present at v1.12.0 (grep of `ReloadResult`, `ReloadFile`, `HoldActivated`).
- There is no TCP command to exit the process. Verified by reading the command table.
- `kanata --check` validates a config and exits. `args.rs#L97`, present at v1.12.0. Verified.
- `kanata_simulated_input -c file.kbd -s sim.txt` runs a config against a scripted key sequence without touching the keyboard (`docs/config.adoc#L6810-L6860`, crate at `simulated_input/`). The v1.12.0 macOS release does not ship it; S33 built it from the tag.
- Because the TCP port is plaintext and unauthenticated, anything local can send `ActOnFakeKey`, `ChangeLayer` and `Reload*`. That is acceptable on a single-user laptop bound to loopback; keyloom should say so. Inference.

### Licence

- kanata is LGPL-3.0 (`LICENSE`, GitHub licence API, Cargo.toml `license = "LGPL-3.0-only"`). Verified.
- Karabiner-Elements is the Unlicense (public domain) and so is the driver. Verified: `LICENSE.md` and the GitHub API.
- keyloom is MIT (`LICENSE`). Verified.
- keyloom would write text files in kanata's language and call the binary as a separate process. No kanata code is linked or copied. I see no licence conflict. This is my reading, not legal advice, and I did not check anything beyond the licence texts.
- Two things to avoid: shipping the kanata binary inside keyloom's releases (that triggers LGPL redistribution duties; downloading it from upstream at the user's request does not), and pasting kanata's docs or sample configs into keyloom's generated output. Write keyloom's own templates.

## 3. The MacBook keyboard as a keyloom board

### Geometry

I could not fetch a primary geometry file for Apple's built-in keyboard (QMK and ZMK have none). The figures below are standard Apple proportions, which I checked for internal consistency (every row sums to 14.5 key units). They are unverified against a measured device. Spike S7 settles it.

ANSI (BK's Mac reports `keyboard_type_v2: ansi` in Karabiner and `KeyboardLanguage = U.S.`):

| Row | Keys (widths in key units) | Count |
|---|---|---|
| 0, function row | Esc (1.5), F1 to F12 (1 each), then Touch ID (1), which is not a key a remapper can see | 13 remappable |
| 1 | ` 1 2 3 4 5 6 7 8 9 0 - = (1 each), Delete (1.5) | 14 |
| 2 | Tab (1.5), Q to P, [ ] (1 each, 12 keys), \ (1) | 14 |
| 3 | Caps Lock (1.75), A to L, ; ' (11 keys), Return (1.75) | 13 |
| 4 | Left Shift (2.25), Z to M, comma, period, slash (10 keys), Right Shift (2.25) | 12 |
| 5 | fn/globe (1), Control (1), Option (1), Command (1.25), Space (5), Command (1.25), Option (1), arrow cluster 3 wide | 11 |

That is 77 remappable keys. The arrow cluster is Left (1 by 1), Right (1 by 1), and Up and Down stacked in the middle column, each 1 by 0.5, which keyloom's geometry (`x, y, w, h`) can draw as `h: 0.5`. The ISO variant has the extra key left of Z (HID `non_us_backslash`), a 1.25 left shift, a tall Return, and a `#` key before Return (HID `non_us_pound`), giving 78. The ISO key count is unverified. kanata's docs confirm the macOS `#` key name: `docs/config.adoc#L408-L416`, "use the name `non_us_pound` (aliases `NonUSPound`, `nuhs`)". Verified.

### Which keys a remapper can see

From BK's keyboard (`ioreg -r -c AppleEmbeddedKeyboard -l`, element list; verified on this Mac):

- Keyboard page (7) usages 4 to 231, which includes all letters, digits, punctuation, F1 to F24 and the eight modifiers.
- Consumer page (12) usages 0xB3, 0xB4, 0xB5, 0xB6, 0xB8 and 0xCD (fast forward, rewind, next, previous, eject, play/pause).
- Apple vendor page 0xFF usage 3, which Karabiner names `fn` (`key_code.hpp#L232`: `fn` = `apple_vendor_top_case` `keyboard_fn`; and `momentary_switch_event.hpp#L81`), and vendor page 0xFF01 usage 11.

Consequences:

- fn / globe is visible to Karabiner as key code `fn` (verified, `key_code.hpp#L232`) and to kanata as `fn`, with aliases including the globe emoji, on macOS builds (verified, `parser/src/keys/mod.rs#L326`, present at v1.12.0). Whether it can be both remapped and used for the macOS Globe function is not documented in either project. Karabiner has a note that the fn behaviour was changed in 15.1.0 (fn plus arrow no longer rewritten, NEWS.md#L298). Spike S3 tests it.
- The brightness, keyboard backlight and similar function-row keys are Apple vendor top-case usages (`key_code.hpp#L230-L234` lists `apple_top_case_display_brightness_*` and `illumination_*`). Karabiner can name them. For kanata the F-row override is an open issue (#975). Unverified in use.
- Touch ID: a separate device from the keyboard, so Karabiner never sees it. Verified from Karabiner's docs. For kanata: unverified.
- BK's `fn_function_keys` block in karabiner.json is already present. keyloom must leave it alone. Verified from the file's key list.

### Hands, fingers and rows for a row-staggered board

keyloom's finger assignment for touch typing, which suits the standard stagger. Row names follow the existing schema (`rows` has a `home` row; everything else is free).

| Finger | Keys by column |
|---|---|
| left pinky | Esc, F1, ` 1 Tab Q Caps A Shift Z, fn, Control |
| left ring | F2, 2 W S X, Option |
| left middle | F3, 3 E D C |
| left index | F4 F5, 4 5 R T F G V B |
| right index | F6 F7, 6 7 Y U H J N M |
| right middle | F8, 8 I K comma |
| right ring | F9, 9 O L period, right Option |
| right pinky | F10 to F12, 0 - = Delete, P [ ] \, ; ' Return, slash, Right Shift, arrows |
| thumbs | left Command, Space, right Command |

This is the textbook touch-typing split, not something I measured on BK's hands. Where BK actually uses a different finger (for example the right Option), the `fingers` map is his to correct.

Rows: home row = Caps/A to ', then top = Q row, bottom = Z row, number = ` to Delete, function = F-row, bottom-mods = the last row. Thumbs are the last row.

- Space is a 5-unit key that both thumbs use. keyloom's slot model needs one hand per position, so Space gets `hands.left` or `hands.right` by convention, or is left with no hand. With no hand, rung 19's `position` strategy lists it as `has-no-place` and only the `function` strategy maps it. That is acceptable: "types Space" is a function. `key-slots.ts` in the rung 19 worktree, `UnmatchedWhy`. Verified in that uncommitted code.
- Stagger and `colOffset`: rung 19's slot code computes the column offset as the rounded distance, along the outward direction, from the finger's home key. On a staggered board, Z is 0.5 unit to the right of A, and `Math.round(0.5)` is 1, so Z lands one column outward of A, while Q (offset 0.25) lands at 0. The touch-typing view says Z, A and Q share a column. This is a prediction from reading `key-slots.ts`, unverified until the board exists.

### Does keyloom's board model fit a non-programmable board?

Not as written. These are the concrete mismatches, from `origin/main@898dec6`:

- `FirmwareSchema = z.enum(["qmk", "zmk"])` (`src/layout/schema.ts#L6`). It is used in `Layout.firmware`, `HoldTapProfile.firmware`, `FirmwareSetting.firmware`, `Passthrough.firmware` and `native` bindings. 40 source files mention `"qmk"` or `"zmk"`, 91 occurrences (grep over `src`). Adding a family touches all of them. Verified.
- `RevisionSchema` is a strict object requiring `source {repo, ref, sha}`, `build` (one of the QMK/ZMK recipes) and `flash` (`src/boards/schema.ts`, `src/boards/recipes.ts`). A MacBook has no firmware tree, nothing to build, nothing to flash. Verified.
- `geometry.json` has a required `source {repo, sha, path}` and is regenerated by `keyloom boards geometry` from a firmware tree; `boards check` fails on drift (blueprint 04). The MacBook geometry has no upstream file. It would be hand-authored, with provenance in its own field. Verified.
- `detect: {usbProductId}` identifies a USB board. The MacBook keyboard has vendor 0, product 0 and is recognised by product string and transport. Verified by `ioreg`.
- `KeyCode` is a closed set joined across QMK and ZMK by HID usage, generated by `scripts/gen-keycodes.ts` (417 lines) into `src/layout/keycodes.ts`. A third and fourth column (kanata name, Karabiner name) can be added the same way. Karabiner's table is `key_code.hpp` (208 name entries, each with a usage pair), and kanata's is `parser/src/keys/mod.rs`. Verified that both exist and carry the data needed. The join itself is unbuilt.
- Mirror tests would fail on this board. `test/boards/mirror.test.ts` requires that every position has exactly one partner on the other hand, that partners sit at the same height (within 0.05), and that all partners reflect across one vertical axis (spread under 0.05). On the MacBook, Space and the F-row keys have no partner, and the stagger moves the reflection axis per row by up to half a unit. Verified by reading the test. `mirror` has to become optional or per-row for this board.
- `HoldTapProfile.options` holds firmware-native names (`TAPPING_TERM`, `flavor`, `hold-trigger-key-positions`). A kanata or Karabiner generator needs a translation from those names, or a neutral profile shape. The model today has none. Verified in `src/layout/schema.ts#L136` and blueprint 02.

None of this blocks the idea. It means a "software" board kind with these differences:

- `board.json` gets `"firmware": "kanata"` (or `"karabiner"`) plus an `apply` recipe in place of `build` and `flash`, and a `device` matcher in place of `detect`.
- `geometry.json` carries `source: {kind: "hand-authored", note}`, and `boards check` skips the upstream comparison for it.
- `mirror` is optional.
- The Touch ID key is not a position.

## 4. Which target first

### What BK asked for, and how each target serves it

| What BK wants on the MacBook | Karabiner | kanata |
|---|---|---|
| Home-row mods like the Moonlander (`CHORDAL_HOLD` and `PERMISSIVE_HOLD` profiles, per the existing UI audit) | Press-based approximation only | Variants line up one to one (inference), including opposite-hand |
| Layers with the thumb keys | Variables, works | Native layers, with the toggle caveat |
| Option-Option fix | Likely | Likely |
| Command-Shift key | Yes | Yes (`(multi lmet lsft)` or `M-S-` prefixes) |
| Combos | `simultaneous` | `defchordsv2` |
| Tap dances | Partial | Native |
| Ready on BK's machine today | Installed (15.7.0), services not running | Not installed, needs driver permissions and root |

### Effort and risk

- kanata generation is close to a transliteration, because `deflayer` is positional. Karabiner generation has to compile each layer into per-key manipulators with conditions, order them correctly, and keep variables consistent. My rough sizing is two to three times the generator code. Unverified: it is my estimate. For scale, keyloom's QMK generator is about 30 files under `src/firmware/qmk` and its ZMK one about 40.
- kanata can be tested without touching the keyboard (`--check`, the simulator). Karabiner cannot, short of building keyloom's own emulation of its manipulator rules.
- kanata can tell keyloom the reload worked (`ReloadResult`) and what it runs (`RequestLayerNames`, `RequestFakeKeyNames`). A keyloom revision marker can be a virtual key named `keyloom-<rev>`, which `RequestFakeKeyNames` would list. That is my design, unverified. Karabiner offers no read-back of the running configuration that I could find: a parse error shows in a log file, and success is silence.
- Karabiner is safer to operate. No root daemon, no extra permissions beyond what BK has, the trackpad still works, and the menu bar can quit it. kanata needs a root LaunchDaemon and a one-time sudo.
- kanata's macOS support depends on a third-party driver ABI that moves (protocol 5 to 7 in the last year) and on a maintainer who does not use macOS. That is the reason to gate the work on a spike.

### Recommendation

Build kanata first, gated by spike S1. If S1 fails, build Karabiner first.

Reasons: it answers BK's stated goal ("behave like the other keyboards") with the fewest semantic losses, it makes keyloom's generator small, and it is the only one of the two I can verify end to end in CI and on Apply. Karabiner second, aimed at the case where BK does not want a root daemon, and as the import path for his existing hand-written rules.

One thing to settle with BK before rung work: he does not need to uninstall Karabiner-Elements, but he does need to stop it seizing the built-in keyboard while kanata owns it.

### Coexistence

- Both seize the device. Karabiner's `device_grabber` seizes devices that need it (`device_grabber.hpp#L913`), and kanata opens with `kIOHIDOptionsTypeSeizeDevice` (`driverkit.cpp#L281`). kanata's own troubleshooting names "another process is already grabbing the keyboard exclusively" as a startup failure (`docs/setup-macos.md`, section 8). Verified.
- The workable split: Karabiner ignores the built-in keyboard (`devices[]` entry with `ignore: true` for the built-in; its identifiers are probably `vendor_id: 0, product_id: 0, is_keyboard: true`, unverified, and read them from `karabiner_cli --list-connected-devices` when Karabiner is running), and kanata is told `macos-dev-names-include` that one product string. BK's external boards stay as they are (already ignored by Karabiner, never selected by kanata).
- Output: kanata sends through the same VirtualHID driver. Whether Karabiner then re-reads that virtual keyboard as input is not documented. kanata does not grab Karabiner-named devices, and Karabiner ignores its own virtual device, I believe (unverified). Spike S2.
- Versions: do not upgrade Karabiner-Elements past the line that replaces driver 6.5.0 while on kanata 1.12.0, as described above. keyloom's setup check should read the installed driver version (`pkgutil`) and kanata's version, compare their protocol numbers from a small table, and say which pair is safe.
- Accessibility and Input Monitoring grants are per binary, so kanata needs its own entries even if Karabiner already has them. Verified from `docs/setup-macos.md`.

## 5. Design for keyloom

### A new firmware family: software remapper

One family, `remapper`, with two targets, `kanata` and `karabiner`. A board says `firmware: "kanata"`, and `target` selects the generator, the apply recipe and the key-name column.

The pieces, each with the rung 17 pattern it reuses:

- Generator: `src/firmware/kanata/generate.ts` produces `keyloom.kbd` from a layout, plus `safe.kbd` (identity, see Safety). Layers map to `deflayer`. holdTap maps to an alias per profile and tap/hold pair, using the variant the profile asks for. Combos map to `defchordsv2` (the generator sets `concurrent-tap-hold yes`). Tap dances, macros, one-shots, Caps Word and Option-Option map as in the table above. `defhands` comes from `board.json` hands. Unmappable bindings (`native` for another family, passthrough from another family) are reported, never silently dropped, which is rung 7/D-024 behaviour.
- Apply: write `keyloom.kbd` atomically (temp file, rename), run `kanata --check -c keyloom.kbd`, then send `{"ReloadFile":{"path": ..., "wait": true, "timeout_ms": 5000}}` to `127.0.0.1:<port>`. Done in under a second without sudo, if the daemon was installed with `-p`. No flash, no bootloader.
- Verify: `ReloadResult.ok` is true, `RequestLayerNames` returns the layer list the generator wrote, and `RequestFakeKeyNames` contains the revision marker. The sync states in blueprint 17 (In sync, Syncing, Behind, Needs a hand, Not connected, Not keyloom's) all apply, with "Not connected" meaning kanata isn't running and "Not keyloom's" meaning a different config file is loaded.
- Setup doctor: a read-only check for driver version, kanata version, Input Monitoring and Accessibility state, daemon plist, TCP port. When a step needs root, keyloom prints one command for BK to run. keyloom never holds sudo. This is a design choice, in the same spirit as handing BK a one-liner instead of retrying a privileged step.
- Import: parse only what keyloom wrote (a header with the layout id and revision, a hash of the body). A `.kbd` BK wrote by hand is not parsed into the model; it is stored as passthrough. kanata's config language is too wide for a faithful importer in one rung.
- Ownership: kanata uses a whole file that keyloom owns (`~/Library/Application Support/kanata/keyloom.kbd`). Never `include` a user file. keyloom refuses to overwrite a file that lacks its header without a confirmation, which matches "Not keyloom's".
- Security: the root daemon reads a file BK can write. A `cmd` action in that file would run as root. keyloom never emits `cmd`, never sets `danger-enable-cmd`, and the doctor warns if the file BK is loading contains it. Verified that `cmd` needs `danger-enable-cmd` (`config.adoc#L4693`).

For the Karabiner target, in a second rung:

- Generator: a `rules` block in the owning profile, every rule with the marker key and the `keyloom:` description prefix, every manipulator conditioned on `device_if` with `is_built_in_keyboard: true` (verified available), manipulators ordered layer first.
- Apply: read `karabiner.json` from its real path, replace only the marked rules, validate JSON and shape, compare a hash against the read, back up (Karabiner makes its own daily backup, keyloom adds a pre-write copy), atomic rename, and rely on the file watcher.
- Verify: weaker. Confirm the file parses, then look for the absence of new errors in `~/.local/share/karabiner/log/console_user_server.log` after a few seconds. There is no read-back. This is a reason the Karabiner target should say "applied, not confirmed" in the UI.
- Import: recognise the exact manipulator shapes keyloom writes, and BK's existing patterns only when a golden test proves the round trip: Space hold layer, the HRM pattern, `simultaneous` combos. Everything else stays verbatim as passthrough with its rule JSON intact.
- Existing rules: when a keyloom rule and a hand-written rule bind the same `from`, the first one in file order wins. keyloom should list shadowed bindings before it writes.

### Safety: never lock BK out of his laptop keyboard

kanata:

- Emergency exit: hold Left Control, Space and Escape together. It works on the raw input before any remapping (`config.adoc#L77-L86`; `src/kanata/mod.rs#L3073-L3150`, `check_for_exit`). On macOS it calls `_exit` with the code from `--emergency-exit-code` (default 0). The sample plist restarts only on unsuccessful exit (`KeepAlive {SuccessfulExit: false}`), so the chord stops kanata and launchd leaves it stopped. Verified.
- keyloom's generated plist should keep that default and pass `--release-grab-on-lock` so the lock screen gets a plain keyboard. Verified that the flag exists at v1.12.0.
- A bad reload cannot lock him out: if the file does not parse, the previous config remains active (`config.adoc#L776-L856`). keyloom also runs `--check` first. Verified.
- A well-formed but wrong config is the real risk (a layer with no way back, a lost Esc). The existing "nothing gets lost" validator (blueprint 07) covers reachability of functions, and should treat `layer:*` exits and Esc and Control as required. Inference about the validator extension.
- No TCP exit command exists, so a software kill that needs no sudo is: keyloom keeps `safe.kbd` (an identity map of the whole built-in keyboard) and "Disable remapping" sends `ReloadFile` to it. The process keeps running but changes nothing. keyloom must also offer the sudo one-liner to bootout the daemon. Design, unverified in use.
- Test the chord once during setup, with BK's hands, before keyloom turns on auto-apply. That mirrors blueprint 17's rule that auto-sync turns on only after one verified hands-free flash.

Karabiner:

- A rule can be turned off by `"enabled": false` (verified), the profile can be switched with `karabiner_cli --select-profile` (verified in `main.cpp`), and Karabiner can be quit from the menu bar or, if the icon is hidden, from Settings (docs "Quit"). The trackpad is not grabbed by default (verified), so BK can always reach the menu with the pointer. keyloom must never write `global.show_in_menu_bar: false`. Verified from the docs.
- I found no emergency key chord in Karabiner. Unverified.
- Wrong-owner or malformed files: Karabiner refuses to load them and keeps the old config. Verified for parse errors, and for ownership by the `allowed_owners` check.

### Rung 19's cross-board mapping puts the Moonlander or Glove80 layout on the MacBook

What exists: `src/boards/correspondence.ts` has `Strategy = "function" | "position" | "auto"`, returns `KeyMapping {mapped[], unmatchedSource[], unmatchedTarget[]}`, with a reason in words and a confidence for each match. `key-slots.ts` derives hand, finger, row offset and column offset from `board.json` plus geometry. `layer-match.ts` pairs layers. These are uncommitted in `.worktrees/keyloom-r19` and I read them there. `map_keys` the agent tool was not in that tree yet (`grep` for `map_keys` found no code). The ledger describes it. So the shape below assumes the tool wraps `correspondence.ts`.

How it applies to a software board:

- Target is the board `apple/macbook-ansi` (`firmware: kanata`). The source is a QMK or ZMK layout.
- `function` strategy first (default `auto`): "types A" maps to the A key, "holds Command" to a key that can hold Command. Most of the typing block matches by function. Numbers and punctuation on the base layer match too, because the MacBook has a number row the Moonlander lacks on some layers.
- The thumb cluster and layer keys are where it breaks. The Moonlander has 8 thumb positions in total (4 per side) and the Glove80 has 12 (6 per side), per `fingers` in their `board.json` files at `898dec6`. The MacBook has five keys a thumb can reach (two Command, two Option, Space), and Space is one key for both hands. Layer keys, macros and hold-taps whose function has no counterpart come back as `no-key-does-this`. The tool should then propose placements among `unmatchedTarget` keys: for example Caps Lock, Space hold, right Option. BK decides. This is the "make room" flow of D-019.
- Combos store source positions. After mapping, each combo's positions are translated through the mapping. A combo with an unmapped key is listed, not kept.
- Hold-tap profiles carry firmware-native options. The mapping step needs a translation table from QMK and ZMK names to kanata variants and timings. The ten or so option names in blueprint 02 are enough to start. This is a gap in today's model and it belongs in the rung.
- Layer pairing: `layer-match.ts` pairs layers by name and function. Layers keep their ids so "go to Navigation" stays valid.
- `native` bindings for another firmware and passthrough blocks are dropped from the target and listed as unmatched. That keeps the guarantee that nothing disappears silently.
- Cost: a mapping run produces a change set with alternatives and trade-offs, as every other keyloom change does. BK sees it, and applies or rejects it.

### What a rung looks like

Call it rung 20, since 19 is cross-board. Slices, each deployable:

1. Board kind. Schema change for software boards (apply recipe, device matcher, hand-authored geometry, optional mirror), `apple/macbook-ansi` board with hands, fingers, rows. The editor draws the MacBook. Done when `keyloom boards check` passes on it and BK sees his keyboard in the editor.
2. Key names. `gen-keycodes.ts` gains kanata and Karabiner columns from pinned SHAs, with a test that every KeyCode used by the MacBook board has a kanata name.
3. kanata generator. Layers, holdTap with profile translation, combos, tap dance, macros, one-shot, Caps Word, Option-Option. Tests: `kanata --check` on every fixture, plus golden sim runs (S6). Done when a generated file passes `--check` and the sim reproduces the expected output for an HRM script.
4. Apply and doctor. Atomic write, TCP reload with confirmation, revision marker, `keyloom sync` and the header state for this board, setup doctor, `safe.kbd`, the plist text. Done when BK edits an HRM timing, hits Apply, and the MacBook keyboard changes within a second with the Moonlander untouched, and he has proven the exit chord and "Disable remapping".
5. Cross-board. `map_keys` onto the MacBook, with the placement proposals. Done when BK's Moonlander layout becomes a MacBook layout he can apply.
6. Import of Karabiner's existing file as passthrough, so BK can see what he has and move rules over one by one.

Rung 21: the Karabiner target, using the same family and the same editor.

### Spikes

Run S1 and S2 first, with BK. They decide the recommendation.

- S1, kanata on the built-in only (BK present, about 30 minutes, sudo). Install kanata 1.12.0 from Homebrew. Confirm the driver extension is approved. Run `sudo kanata --list`, then `sudo kanata -c /tmp/s1.kbd -p 127.0.0.1:7070` with `macos-dev-names-include ("Apple Internal Keyboard / Trackpad")`, `process-unmapped-keys yes` and a one-HRM config. Pass if: the built-in keyboard is remapped; an external keyboard is not; Input Monitoring and Accessibility prompts are understood; the Ctrl+Space+Esc chord stops it; a TCP `Reload` with `wait` returns `ok`. Fail means driver 6.5.0 and kanata 1.12.0 do not work together, and Karabiner goes first.
- S2, coexistence with Karabiner running. Launch Karabiner-Elements with a `devices[]` entry that ignores the built-in. Run `karabiner_cli --list-connected-devices` to read the built-in's identifiers, then repeat S1. Pass if kanata's output arrives once, not twice, and Karabiner's rules still work on the external boards.
- S3, the keys that are special. With S1 running at `-d`, press fn/globe, F1 to F12, Esc, Touch ID, and the arrows, and record what kanata sees and what macOS does. Same list with Karabiner's EventViewer. Pass criteria: fn/globe is reportable and rebindable, F-row media keys still work when not remapped.
- S4, Karabiner write and reload. Write a tiny keyloom-marked rule into the real path of `karabiner.json`, measure the delay until it takes effect, check that a Settings UI save keeps the marker key, and check that the file watcher fires through the dotfiles symlink. Pass if reload is under a second and the marker survives.
- S5, Karabiner hold-tap quality. Upgrade is needed for `to_if_other_key_pressed` (16.0.0), which replaces driver 6.5.0, so run this on a spare profile or machine, never in the middle of S1 to S3. Compare a generated HRM rule against the existing hand-written one.
- S6, differential tests. Build `kanata_simulated_input`, feed it keyloom's emulator scripts (`src/firmware/emulate/script.ts` is the script format) for a Moonlander HRM profile, and compare against keyloom's own QMK emulator output. Pass if the cases BK cares about (roll, same-hand, opposite-hand, fast typing, hold past the timeout) agree, or the differences are documented per option.
- S7, geometry capture. Confirm the 77 ANSI keys, their order and widths on BK's MacBook, by pressing every key under `kanata -d` and by measuring a photo or Apple's published layout. Pass if the position order is stable and the geometry matches within 0.05 units.
- S8, Option-Option. Generate `(macro lalt lalt)` style output for kanata, and the double `left_option` for Karabiner, and test them against the app BK needs it for. Pass if the app sees a double tap.

## Unresolved questions

1. Is BK willing to run a root LaunchDaemon (one sudo setup, then none) for the MacBook, or should Karabiner go first for that reason alone?
2. Should kanata take over the built-in keyboard completely, with Karabiner kept only for the external boards he already ignores, or does he want Karabiner still active on the built-in for anything?
3. Does he want his existing six Karabiner rules replaced by generated ones, or kept as they are with keyloom adding to them?
4. Which Mac keyboards matter: only this MacBook Pro (ANSI), or also an ISO one?
5. Does he want to keep Karabiner-Elements current? That upgrade would break kanata 1.12.0 until 1.13.0 ships.
6. Is the `keyloom:` marker plus rule-level key acceptable inside a dotfiles-tracked `karabiner.json`, given every Apply becomes a git diff there?
7. For Space: should it stay a thumb-style layer key on the MacBook (as in his current rule), or move to another key so Space remains plain?
