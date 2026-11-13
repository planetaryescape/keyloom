# 21: The MacBook keyboard, through kanata

Status: built in v0.21.0 (rung 20), as of v0.36.1: the kanata family, the `apple/macbook-ansi` board, Karabiner import, apply by reload with verify, and the setup doctor. kanata is running keyloom's `keyloom.kbd` on BK's Mac (seen with `pgrep`, 2026-10-17), and one automatic sync applied and verified (`syn_01M53B4CQBCACRJDCTGJJG799H`, 2026-10-16, 5.1 s). Not recorded: S30, S31, S32 and S36 have not run, the board's geometry says `verified: false`, and S33 waits on a kanata build from source. Since D-492 and D-493 (2026-11-11), the app sets kanata up from the sync popover: install with Homebrew, open the Privacy panes, and install and start the daemon through macOS's password dialog. It also replaces a foreign config with a kept copy, and records the exit-chord proof from a button. Since D-497, root installs the plist from text carried in its own script, Replace it refuses a stale confirm and holds the sync claim, and the proof needs kanata's port to refuse the connection. Since D-498, the daemon runs a root-owned copy of kanata that setup checks by hash and refuses if it can run programs, and the checklist says to set up again after a Homebrew update. A kanata changed any other way gets Reinstall kanata instead of a password step, a failed root script says why, and the daemon's log is readable by root only. Since D-503, Install kanata shows Homebrew's progress and can be cancelled, an older kanata gets Update kanata, and a failed install links the download. These were driven against a fake kanata and fake `osascript`, `open` and `brew`, never the real ones. Since D-501, the MacBook page has no Build and flash, and the line after an Apply offers Apply now or says auto-apply puts it on. Since D-509, the exit-chord proof counts only within ten minutes of keyloom seeing kanata run its config, in the app and in `keyloom remap confirm-exit-chord`. Since D-510, the line after an Apply offers Open keyboard status or Replace it… where Apply now would fail, and the Karabiner-Elements step opens the app. Written 2026-10-15 against origin/main after v0.19.1. Since D-519 (2026-11-11), a keyloom.kbd edited by someone else while kanata runs keyloom's config fails as `foreign_file`, and Replace it (keeping keyloom.kbd.before-keyloom, made only after `kanata --check` passes and never written over: a later, different original gets a dated name) gets past it; the mismatch page's put-on shows kanata's setup while kanata isn't running. Since D-530 (2026-11-12), a failed read of what kanata needs shows its reason with Check again in the popover's attention steps too. Since D-537, Disable remapping that kanata doesn't take is the `disable_failed` refusal, with Open keyboard status. Since D-539 (2026-11-12), the first-run welcome and the setup card say that setup changes nothing on the Mac and that changes reach it through kanata, and the setup card's Import opens the MacBook's card alone. Since D-543 (2026-11-13), the popover's attention steps keep Check again, and a step whose System Settings pane keyloom opened is read again when keyloom's window is back in front. Since D-533 (2026-11-12), the root script runs with an empty environment, `PATH` only, and osascript starts with one too, so nothing from keyloom's environment reaches root. Since D-549 (2026-11-13), the setup checklist shows the doctor's `keyboard_name` warning as a step with the contribution guide, so it never reads as done while kanata remaps nothing. Since D-554 (2026-11-13, round 10), a config kanata refuses says so with Undo this change when one step reaches the layout kanata runs, otherwise Open History, or, for a kanata keyloom doesn't write for, Open keyboard status; only a refusal kanata itself answered says "kanata refused", and a reload keyloom couldn't finish offers Apply now. The checklist puts the permissions step after Start kanata, and a Mac with no built-in keyboard gets only a note that says so, with the contribution guide. Since D-558 and D-559 (2026-11-13, round 11), a Karabiner import shows the edit that frees the built-in keyboard, with the entry to copy, and the import's warnings before the layout opens, and the checklist's Karabiner step carries the same entry. A service that is installed while kanata doesn't answer gets its own step after the permissions, with Restart kanata's service (a fixed root script that checks the service is setup's, then `launchctl kickstart -k`, then waits for kanata to answer) and Show kanata's log (its last lines, read through the password dialog, because the log is root's alone). Start waits for the driver step. A refused config with one version says there is nothing earlier to go back to, and `kanata_setup` offers the way back too. Not observed: what kanata does on its first start before macOS allows it, and the driver's activation, which keyloom doesn't do (S30).

BK: "I would like to have the features that karabiner has or if I install karabiner elements kanata, this configurator should be able to configure that as well so that I can get my macbook keyboard to behave like the other keyboards."

A MacBook's built-in keyboard can't be flashed, but a software remapper on the Mac can give it layers, home-row mods, combos and tap dances. keyloom treats it as one more board, whose "firmware" is the remapper's config file (D-230). Applying a change writes the file and tells the remapper to reload it. That's instant, with no build and no flash, which is the "just change the keys and that's it" BK asked for, by a shorter road than [17](17-keyboard-sync.md).

The research, with pinned sources and the experiments to run, is [../research/software-remappers.md](../research/software-remappers.md).

## kanata first, Karabiner-Elements later

BK chose kanata (D-231). Its config is closest to keyloom's model:

- **Layers line up with keyloom's.** A `deflayer` is a positional list, the same "binding N is key N" shape keyloom uses.
- **Hold-taps keep their feel.** Its tap-hold variants line up with QMK's hold-tap options, so home-row mods can feel the same as on his boards.
- **Changes can be checked before and after.** It has `--check`, a headless simulator to test against keyloom's emulator scripts, and a TCP reload that reports success.

The cost is a one-time install of kanata as a root LaunchDaemon, with Karabiner's VirtualHIDDevice driver. The person runs that one command, from the CLI's printed line or from the app's **Set up and start kanata**, which asks through macOS's own password dialog (D-493); keyloom never holds the password. Spikes S30 and S31 decide it with BK present. If they fail, Karabiner-Elements goes first instead. Karabiner needs no root service, but it has no permissive hold and no read-back.

The two remappers can't both grab the built-in keyboard. kanata takes it, named with `macos-dev-names-include ("Apple Internal Keyboard / Trackpad")`, and Karabiner is set to ignore it. Karabiner keeps running for anything else BK uses it for.

## BK's existing Karabiner rules become the starting layout

BK already has a hand-written Karabiner config on this MacBook, tracked in his dotfiles: a Space-hold layer, home-row mods, six combos and a Hyper rule. keyloom imports it, recognising those patterns, as the MacBook's first layout. It then disables those rules for the built-in keyboard, and never deletes them, so BK can switch back (D-232). Anything keyloom can't read stays as passthrough, listed, never dropped.

keyloom never writes into `karabiner.json`, or anything else in BK's dotfiles. It owns its own file, `~/Library/Application Support/kanata/keyloom.kbd` (D-233). Disabling the old rules is one edit, which keyloom shows BK and BK applies, the way D-070 handed him a one-liner. The import card shows it, with the entry to copy, before the layout opens, and so does the keyboard's status while Karabiner still takes the keyboard (D-558).

Space stays a hold-layer key on the MacBook (D-234). When BK's thumb-layer keys are mapped over from the Moonlander or Glove80, they land on Space-hold first, then on the other thumb-reachable keys.

## The board

`apple/macbook-ansi` is a board with `firmware: "kanata"`. That makes "software remapper" a new firmware family, with three things in place of a build and flash recipe:

- **An apply recipe:** write the file, check it, reload it.
- **A device matcher.**
- **Hand-written geometry.**

77 ANSI keys, with hands, fingers and rows. The geometry comes from Apple's proportions and is confirmed on BK's keyboard in S36. The fn/globe and Touch ID keys are listed with what the remapper can see (S32). Today `firmware` is `"qmk" | "zmk"` in about 40 files, so widening it is the first slice.

## Apply, verify and safety

- **Apply.** Write `keyloom.kbd` atomically, run `kanata --check`, then send `ReloadFile` with `wait` to kanata's local TCP port. It takes under a second and needs no sudo once the daemon runs with `-p`.
- **Verify.** The reload result is `ok`, the layer names match, and a fake key carries the revision marker. The sync states in [17](17-keyboard-sync.md) apply unchanged. "Not connected" means kanata isn't running; "Not keyloom's" means another file is loaded.
- **Never lock BK out** (D-235):
  - kanata's own exit chord, Left Control + Space + Escape, works before any remapping. keyloom's plist keeps the default so launchd leaves it stopped. BK proves the chord once during setup, before auto-apply turns on, which mirrors [17](17-keyboard-sync.md)'s rule. The proof counts only when kanata's port refuses within ten minutes of keyloom seeing kanata run its config (D-509), so a kanata that never started can't stand in for the chord.
  - A bad file can't be loaded, because kanata keeps the old config, and keyloom runs `--check` first.
  - "Disable remapping" reloads `safe.kbd`, an identity map, with no sudo.
  - The validator treats Esc, Control and every layer's way back as functions that must stay reachable.
  - `--release-grab-on-lock` gives the lock screen a plain keyboard.
  - keyloom never emits kanata's `cmd` action or `danger-enable-cmd`, because the daemon runs as root.
  - The daemon runs keyloom's root-owned copy of kanata, `/Library/Application Support/keyloom/kanata`, and setup refuses a kanata that accepts a `cmd` config (D-498). keyloom.kbd stays in the home folder, so a changed config can only remap keys.
- **Setup doctor.** `keyloom doctor` reads the kanata and driver versions, the Input Monitoring and Accessibility state, the daemon, whether its kanata copy matches the kanata on PATH, and the port, and prints the one root command when one is needed. Upgrading Karabiner-Elements to 16.x replaces the driver with one kanata 1.12 can't use. The doctor says so before it happens.
- **Open-file limit.** The plist raises the daemon's soft open-file limit from launchd's 256 to 4096. kanata 1.12.0 keeps a file descriptor for every TCP client that disconnects, and when it runs out its TCP thread panics and the whole process aborts until launchd restarts it ([issue](../issues/kanata-tcp-leaks-file-handles.md)). A daemon installed earlier keeps the old limit until it is reinstalled.

## Copying the other boards' setup onto it

Rung 19's cross-board mapping ([20](20-cross-board.md)) does the work, and a put runs it over every layer at once (D-383): "put my Glove80 config on this keyboard" makes a new config here, like on any other board.

- **Matched by function.** Most of the typing block matches by what the keys do.
- **No counterpart.** Thumb clusters and extra layer keys have none on a MacBook, which has two Command keys, two Option keys and one Space for both thumbs. Those come back as placement proposals among Space-hold, Caps Lock and right Option. BK picks, the way D-019's "make room" works.
- **Combos** are translated through the mapping.
- **What kanata or keyloom's output can't say** is left off with a reason (a macro that holds a non-modifier, a tap dance with a hold, native ZMK or QMK code, a key kanata can't send on macOS such as Print Screen), never a refusal. The validator refuses the same keys set by hand (`firmware_unsupported`). kanata's `tap-dance` accepts a nested `tap-hold` (checked with `kanata --check` on v1.12.0); keyloom's generator now writes it (D-383), and every carried layer is held from a key the board lists, or is left out.
- **Hold-tap profiles** are translated from QMK/ZMK option names to kanata's variants and timings. Nothing is dropped silently (D-024).

## Karabiner-Elements later

A second target in the same family, with the same editor (D-231). keyloom would own a separate Karabiner profile, not BK's tracked file. It's built only if kanata fails S30 or S31, or BK asks for it.

## Hold-tap translation

Hold-tap profiles from QMK and ZMK boards become kanata ones with this table (D-242). The code is `src/layout/kanata/profiles.ts`. kanata's variants are from `docs/config.adoc` at `jtroo/kanata@02242ef` (v1.12.0). The QMK and ZMK sides are the research's reading of their options; S33 checked the QMK rows against kanata's simulator (144 of 150 scenario pairs agree; [../research/spikes/S33.md](../research/spikes/S33.md)). The ZMK rows marked (S6) were not exercised.

| From | To kanata |
|---|---|
| QMK `TAPPING_TERM` | `hold-ms` (default 200) |
| QMK `QUICK_TAP_TERM` | `tap-repress-ms` (QMK defaults it to the tapping term). kanata counts from the first press, QMK from its release, so a set `QUICK_TAP_TERM` comes with a note (S33) |
| QMK `PERMISSIVE_HOLD` | `tap-hold-release` |
| QMK `HOLD_ON_OTHER_KEY_PRESS` | `tap-hold-press`; it wins when both are on, as in QMK |
| QMK `CHORDAL_HOLD` | `tap-hold-tap-keys` over the key's own hand (`tap-keys: same-hand`); with `HOLD_ON_OTHER_KEY_PRESS` `tap-hold-opposite-hand`; with `PERMISSIVE_HOLD` `tap-hold-opposite-hand-release` (S33, D-390) |
| QMK `FLOW_TAP_TERM` | `require-prior-idle-ms` |
| ZMK flavor `hold-preferred` | `tap-hold-press` |
| ZMK flavor `balanced` | `tap-hold-release` |
| ZMK flavor `tap-preferred` | `tap-hold-tap-keys` over every key (S6) |
| ZMK flavor `tap-unless-interrupted` | `tap-hold-press-timeout` with the tap as the timeout action |
| ZMK `tapping-term-ms`, `quick-tap-ms`, `require-prior-idle-ms` | `hold-ms`, `tap-repress-ms`, `require-prior-idle-ms` |
| ZMK `hold-trigger-key-positions` that are the other hand's keys and thumbs | `tap-hold-opposite-hand`, or `-release` with `balanced` or `hold-trigger-on-release` |
| QMK `RETRO_TAPPING`, ZMK `retro-tap`, any other trigger list | no kanata form: reported, not carried |

The opposite-hand variants are written with `(timeout hold)` and `(same-hand tap)`: a key held past the time is a hold, as on QMK and ZMK, and a same-hand key makes it a tap.

## Built in rung 20

The board, the key names, the generator, apply with verify and "Disable remapping", the setup doctor, the validator rule and the Karabiner import are built and tested against a fake kanata server and the real `kanata --check` (v1.12.0). A sync to the keyboard BK types on has since applied and verified (see the status line), but none of the spikes have a recorded result: S30 and S31 (the install and coexistence) are runbooks in [../research/spikes/S30.md](../research/spikes/S30.md) and [S31.md](../research/spikes/S31.md), and S32 and S36 (key capture) in [S32.md](../research/spikes/S32.md) and [S36.md](../research/spikes/S36.md).

## Conditional layers

kanata can't write "when two layers are both held", so a conditional layer in a MacBook layout is left out of the config with a comment and a `conditional_layer_unsupported` warning (D-388).
