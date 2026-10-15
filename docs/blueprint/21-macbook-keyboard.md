# 21: The MacBook keyboard, through kanata

Status: proposal, 2026-10-15. Source baseline: origin/main after v0.19.1.

BK: "I would like to have the features that karabiner has or if I install karabiner elements kanata, this configurator should be able to configure that as well so that I can get my macbook keyboard to behave like the other keyboards."

A MacBook's built-in keyboard can't be flashed, but a software remapper on the Mac can give it layers, home-row mods, combos and tap dances. keyloom treats it as one more board, whose "firmware" is the remapper's config file (D-230). Applying a change writes the file and tells the remapper to reload it. That's instant, with no build and no flash, which is the "just change the keys and that's it" BK asked for, by a shorter road than [17](17-keyboard-sync.md).

The research, with pinned sources and the experiments to run, is [../research/software-remappers.md](../research/software-remappers.md).

## kanata first, Karabiner-Elements later

BK chose kanata (D-231). Its config is closest to keyloom's model:

- **Layers line up with keyloom's.** A `deflayer` is a positional list, the same "binding N is key N" shape keyloom uses.
- **Hold-taps keep their feel.** Its tap-hold variants line up with QMK's hold-tap options, so home-row mods can feel the same as on his boards.
- **Changes can be checked before and after.** It has `--check`, a headless simulator to test against keyloom's emulator scripts, and a TCP reload that reports success.

The cost is a one-time install of kanata as a root LaunchDaemon, with Karabiner's VirtualHIDDevice driver. BK runs that one command himself; keyloom never holds sudo. Spikes S30 and S31 decide it with BK present. If they fail, Karabiner-Elements goes first instead. Karabiner needs no root service, but it has no permissive hold and no read-back.

The two remappers can't both grab the built-in keyboard. kanata takes it, named with `macos-dev-names-include ("Apple Internal Keyboard / Trackpad")`, and Karabiner is set to ignore it. Karabiner keeps running for anything else BK uses it for.

## BK's existing Karabiner rules become the starting layout

BK already has a hand-written Karabiner config on this MacBook, tracked in his dotfiles: a Space-hold layer, home-row mods, six combos and a Hyper rule. keyloom imports it, recognising those patterns, as the MacBook's first layout. It then disables those rules for the built-in keyboard, and never deletes them, so BK can switch back (D-232). Anything keyloom can't read stays as passthrough, listed, never dropped.

keyloom never writes into `karabiner.json`, or anything else in BK's dotfiles. It owns its own file, `~/Library/Application Support/kanata/keyloom.kbd` (D-233). Disabling the old rules is one edit, which keyloom shows BK and BK applies, the way D-070 handed him a one-liner.

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
  - kanata's own exit chord, Left Control + Space + Escape, works before any remapping. keyloom's plist keeps the default so launchd leaves it stopped. BK proves the chord once during setup, before auto-apply turns on, which mirrors [17](17-keyboard-sync.md)'s rule.
  - A bad file can't be loaded, because kanata keeps the old config, and keyloom runs `--check` first.
  - "Disable remapping" reloads `safe.kbd`, an identity map, with no sudo.
  - The validator treats Esc, Control and every layer's way back as functions that must stay reachable.
  - `--release-grab-on-lock` gives the lock screen a plain keyboard.
  - keyloom never emits kanata's `cmd` action or `danger-enable-cmd`, because the daemon runs as root.
- **Setup doctor.** `keyloom doctor` reads the kanata and driver versions, the Input Monitoring and Accessibility state, the daemon and the port, and prints the one root command when one is needed. Upgrading Karabiner-Elements to 16.x replaces the driver with one kanata 1.12 can't use. The doctor says so before it happens.

## Copying the other boards' setup onto it

Rung 19's cross-board mapping ([20](20-cross-board.md)) does the work.

- **Matched by function.** Most of the typing block matches by what the keys do.
- **No counterpart.** Thumb clusters and extra layer keys have none on a MacBook, which has two Command keys, two Option keys and one Space for both thumbs. Those come back as placement proposals among Space-hold, Caps Lock and right Option. BK picks, the way D-019's "make room" works.
- **Combos** are translated through the mapping.
- **Hold-tap profiles** are translated from QMK/ZMK option names to kanata's variants and timings. Nothing is dropped silently (D-024).

## Karabiner-Elements later

A second target in the same family, with the same editor (D-231). keyloom would own a separate Karabiner profile, not BK's tracked file. It's built only if kanata fails S30 or S31, or BK asks for it.
