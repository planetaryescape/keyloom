# 13: Roadmap

## Build philosophy

- **Skateboard → scooter → bicycle → motorbike → car** (vault: `Skateboard MVP`). The roadmap is a ladder of usable releases, not a list of components.
- **Each rung is usable.** It's a working, released product that lets BK do something new from start to finish, sized to one working session (vault: `Shippable Increment Per Session`).
- **Every rung ships through the real release channel:** release-please, then a GitHub release with compiled binaries, then `install.sh` (D-034).
- **At most two new unknowns per rung.** A rung that needs a third is split.
- **Ceremony is named and pulled into the nearest useful turn.** That covers the skeleton, CI, dependency rules and the release chain. There is no foundation turn: rung 1 carries the ceremony and is still usable.
- **Stop after any rung and there's a working product.**
- **Later rungs take letters.** A rung added later gets a letter (3b), so cited numbers keep their meaning.
- **Each rung opens with a status line.** It names the release that built it, then says whether its done-when check was observed. "Not recorded" means no spike, decision, log or ledger in this repo shows the check, which is different from showing it failed. Written at v0.36.1, 2026-10-17.
- **Tests pass, but that isn't done.** Every rung is done only when its completion check is observed on the **installed release binary** against BK's real layout and, from rung 2, his real keyboard. Its demo must also have been run.

## Phase 0: accounts and spikes (before product code)

Only BK can do these. The coding agent asks which are done and doesn't create accounts, keys or repos itself.

| # | Action | Needed by |
|---|---|---|
| A1 | Create the GitHub repo `planetaryescape/keyloom` (public or private, Q14) and push this blueprint | Rung 1 (release channel) |
| A2 | Download the Oryx source zip of the current Moonlander layout | Rung 1 (S3) |
| A3 | Make an Anthropic API credential available to keyloom: an `ANTHROPIC_API_KEY` from 1Password through `op run`, or `ant auth login` | Rung 3 |
| A4 | Install Docker Desktop and `brew install zapp` | Rung 2 |
| A5 | Export the Glove80 layout from MoErgo's Layout Editor as `.keymap` (Q9) | Rung 5 (S6) |

Spikes that gate rungs are listed with their `Blocks` column in [15](15-open-questions.md). Before rung 1, run S3 and S10 (C grammar). Before rung 2, run S1, S5, S9 and S11, plus S2 if S1 says rev B.

## Rung 1: Skateboard: see my Moonlander layout in keyloom

**Status:** Built in v0.1.0. Done when: not recorded. S3 and the compiled-binary import (S10) were run.

**Previously:** nothing. **Now:** keyloom installs, imports BK's Oryx export, and shows every layer on a picture of the Moonlander in the browser and as grids in the terminal.

**Promise:** "I can install keyloom, give it my Oryx export, and see my whole Moonlander layout, every layer, in my browser and my terminal."

**Build:**

- Ceremony:
  - repo skeleton per [01](01-architecture.md#modules)
  - `dependency-cruiser` rules
  - CI running `tsc --noEmit`, `bun test` and dependency-cruiser
  - release-please, `bun build --compile` for three targets, and `install.sh`
- Layout IR and keycodes ([02](02-layout-model.md)); the database with `layouts` and `revisions` only.
- The `zsa/moonlander` board definition ([04](04-boards-and-contributions.md)).
- The QMK importer for BK's real export ([05](05-firmware-qmk.md#import-reads-the-oryx-source-download)), with `native` and `Passthrough` for what it doesn't model.
- CLI: `import`, `layout list|show`, `boards list|show`, `doctor` (database only for now), `--format` ([10](10-cli.md)).
- `keyloom serve`: the read-only keyboard view with a layer switcher ([09](09-web-editor.md)) and the launch token ([01](01-architecture.md#server-and-transport)).

**New unknowns:** parsing Oryx's C with tree-sitter (S3, S10); embedding the web app and WASM in the compiled binary.

**Demo:** `curl … install.sh | sh`, then `keyloom import --board zsa/moonlander ~/Downloads/<oryx>.zip`, `keyloom layout show <name>`, and `keyloom serve`, then click through the layers.

**Done when:**

- The release installs with `install.sh` on BK's Mac.
- `keyloom layout show <name> --format json` lists every layer of BK's layout with the right binding count (72 per layer).
- The browser shows each layer on the Moonlander picture. BK checks the base layer, his number layer and his home row mods against Oryx and finds no difference.
- The import report lists every `native` and `Passthrough` item, and BK recognises each one.

**Left out:** editing, building, flashing, the agent and the Glove80.

## Rung 2: Scooter: change a key by hand and type with it

**Status:** Built in v0.2.0. Done when: partly observed. BK's unchanged layout, built by keyloom, flashed to his Moonlander and he typed on it (S9, 2026-10-15). The one-key change, undo plus reflash and `flash --build` are not recorded.

**Previously:** read-only. **Now:** BK edits a key in the browser or CLI, keyloom builds firmware in Docker and flashes the Moonlander through Zapp, and he types with the change. Undo and reflash work.

**Promise:** "I can change a key in keyloom and type with it on my Moonlander a few minutes later, and put it back if I don't like it."

**Build:**

- `change_sets` with `source = 'editor'`; `apply-ops`; the validator's structural errors (`schema`, `binding_count`, `unknown_ref`, `firmware_unsupported`, `qmk_modtap_*`) ([07](07-change-validation.md)); apply and undo ([02](02-layout-model.md#applying-undoing-and-stale-bases)).
- The editor's key picker and binding editor ([09](09-web-editor.md)).
- QMK generation, the Docker build, Zapp flash, `builds` and `flashes`, and the pinned checkout ([05](05-firmware-qmk.md)). `doctor` checks Docker, `zapp` and the checkout.
- CLI: `change check|propose|apply|reject`, `undo`, `generate`, `build`, `flash`.

**New unknowns:** the QMK build from ZSA's fork in Docker (S5, S9); Zapp under keyloom's control (S1, S11).

**Demo:** In the browser, change one rarely used key, then build and flash, and type it. Then `keyloom undo` and `keyloom flash`, and the key is back.

**Done when:**

- A no-change build of BK's imported layout, flashed, behaves exactly like his current Oryx firmware (S9). BK types normally for 10 minutes, and his home row mods, macros and layers work.
- A one-key change made in the browser, built and flashed, produces that key on the keyboard.
- `keyloom undo` followed by `keyloom flash` restores it.
- `keyloom flash --build <first build>` reflashes a known-good artifact ([11](11-observability-and-evals.md#recovering-from-a-bad-flash)).

**Left out:** chat, reachability and decisions.

## Rung 3: Bicycle: fix Option–Option by describing it

**Status:** Built in v0.3.0. Done when: partly observed. The Option–Option eval passes on OpenRouter and Codex (S19, S20). Option–Option working on the keyboard, in the app BK names, is not recorded.

**Previously:** hand edits. **Now:** BK describes the Option–Option problem in the chat panel. The agent asks what it needs and proposes valid alternatives, shown on the keyboard with their trade-offs. BK applies one, flashes, and presses Option–Option.

**Promise:** "I can tell keyloom I can't press Option–Option because Option lives on S, get a fix I understand, and use it on my keyboard."

**Build:**

- The agent ([03](03-agent.md)): prompt assembly, the tools `get_layout`, `find_function`, `analyse_change` and `propose_changes`, the Tool Runner loop, streaming, and refusal handling.
- `conversations` and `messages`. The chat panel with the proposal cards and diff highlighting ([09](09-web-editor.md)).
- The validator's reachability rules: `function_lost`, `layer_unreachable`, `layer_trap`, and the `doubled_letter_tapdance` warning ([07](07-change-validation.md)).
- CLI `chat`, logs per agent turn ([11](11-observability-and-evals.md)), and the first eval scenario (Option–Option).

**New unknowns:** the agent producing valid change sets reliably through the Tool Runner; the reachability analysis on BK's real layout.

**Demo:** "Some apps want Option–Option, and I can't do it because Option is my S home row mod." The agent asks which app and which hand is free, proposes alternatives, and BK applies one. Then he builds, flashes, and presses Option–Option in that app (Q11).

**Done when:**

- The scenario runs through the installed binary, and Option–Option works on the keyboard in the app BK names.
- The Option–Option eval passes against the configured model.
- A deliberately bad op (removing BK's only route to his number layer) is rejected with `layer_unreachable` in `keyloom change check`.

**Left out:** displacement alternatives, priorities, decisions and the Glove80.

## Rung 4: Bicycle: make room for Command–Shift

**Status:** Built in v0.6.0. Done when: not recorded.

**Previously:** single-purpose fixes. **Now:** BK asks for a Command–Shift key on a full layout. keyloom asks what matters, remembers it, and offers two or three placements, each showing what moves and what it costs. Applying one moves everything together, and one undo reverts it all.

**Promise:** "I can ask for a Command–Shift key on a full keyboard and choose between real options that show me what moves and what gets worse."

**Build:**

- `record_priority` and decisions of kind `priority`, with the chat chips ([08](08-decision-memory.md)).
- Multiple alternatives per `proposal_group`, `diff.displaced`, `relearnCount`, and the `moved_pinned` and `large_relearn` warnings ([07](07-change-validation.md)).
- Proposal comparison in the editor ([09](09-web-editor.md)). The Command–Shift eval.

**New unknowns:** the agent's quality at weighing displacement against priorities; capturing priorities in conversation without misrecording them.

**Demo:** "I press Command–Shift a lot; give me one key for it." BK answers the agent's questions ("I barely use Caps Lock; keep Backspace"), compares the alternatives, applies one, flashes, and uses it. Then he undoes it and the whole rearrangement reverts.

**Done when:**

- At least two valid alternatives are shown, each with displaced functions and their new homes.
- The applied one works on the keyboard.
- `keyloom undo` restores every moved key in one step.
- The stated priorities appear in `keyloom decisions list --kind priority`.

**Left out:** choice decisions, reminders and the Glove80.

## Rung 5: Motorbike: the same on the Glove80

**Status:** Built in v0.4.0. Done when: partly observed. The import, generate, import round trip is identical and the unmodified build is byte-identical to BK's own (S6). A build flashed to both halves booted and BK typed on it (S8). The Option–Option fix on the Glove80 is not recorded.

**Previously:** the Moonlander only. **Now:** BK imports his Glove80 layout, edits it by hand and by chat, and builds and flashes it, with the same flows on ZMK.

**Promise:** "I can do everything I do for my Moonlander on my Glove80 too."

**Build:**

- The `moergo/glove80` board definition ([04](04-boards-and-contributions.md)).
- The ZMK importer, generator, Docker/Nix build and two-half UF2 flash flow ([06](06-firmware-zmk.md)).
- The firmware capability lists for the agent. The ZMK variants of the evals.

**New unknowns:** parsing ZMK devicetree from the Layout Editor export (S6, S10); the MoErgo build and UF2 flash (S7, S8).

**Demo:** Import the `.keymap`, view it, then fix Option–Option on the Glove80 by chat, build, flash both halves, and press it.

**Done when:**

- The import → generate → import round trip gives an identical IR.
- A no-change build flashed to both halves behaves like the current firmware.
- The Option–Option fix works on the Glove80.

**Left out:** decision memory.

## Rung 6: Motorbike: keyloom remembers why, and hears how it feels

**Status:** Built in v0.8.0. Done when: not recorded.

**Previously:** changes without memory. **Now:** every applied change records its goal and reason. Changing a key with a recorded reason brings that reason up. BK can tell keyloom how a change feels ("Command is slow to trigger now"), which updates the decision and leads to tap-hold tuning through hold-tap profiles.

**Promise:** "When I go to move something I set up months ago, keyloom reminds me why I put it there, and I can tell it how a change feels and have it tuned."

**Build:**

- Choice decisions written on apply from `decisionDraft`, reminders in validation, supersession, the 7-day outcome question (Q6) and `update_decision_outcome` ([08](08-decision-memory.md)).
- The decisions view and `keyloom decisions …`.
- Hold-tap profile editing by chat and in the editor, plus the `homerow_same_hand_mods` warning (D-017).

**New unknowns:** whether reminders surface at the right moments without nagging; tuning tap-hold through profiles on both firmwares.

**Demo:** Ask to replace the Command–Shift key from rung 4. keyloom quotes the stored reason and asks whether it still holds. Then say "holding F for Command feels slow", and keyloom proposes a profile change, which BK applies and flashes.

**Done when:**

- The reminder appears in the preview and in the agent's reply.
- Applying anyway marks the old decision `superseded`.
- The tuning change flashes and BK reports the difference.
- The "remembered reason" eval passes.

**Left out:** bulk selection edits.

## Rung 7: Motorbike: do that here too

**Status:** Built in v0.7.0. Done when: not recorded.

**Previously:** one change at a time. **Now:** BK selects keys on the picture and asks for something across them ("same hold behaviour as F", "mirror this onto the right hand"). Or he repeats his last edit on a selection.

**Promise:** "I can do something once and say 'do the same thing on these keys', without describing every position."

**Build:**

- Multi-select on the keyboard, the selection sent with chat messages (`messages.selection`), and "repeat last change on selection" in the editor ([09](09-web-editor.md)).
- Mirror maps in board definitions ([04](04-boards-and-contributions.md)). The "do that here too" eval.

**New unknowns:** a selection UX that's precise on split and rotated layouts; mirror mapping per board.

**Demo:** Select the home row on the right hand and say "give these the same home row mods as the left, mirrored". Apply, build and flash.

**Done when:** the change touches exactly the selected slots, and it works on both boards.

**Left out:** contributions.

## Rung 8: Car: someone else can add their keyboard

**Status:** Built in v0.5.0. Done when: partly observed. The Corne went in as a data-only board in PR #6 with the board check in CI (Q10). Building and flashing it end to end is not recorded, and S13 has not run.

**Previously:** BK's two boards. **Now:** the board format is documented, `keyloom boards check` validates a contribution, and a contributor can add a board with a pull request containing only data and an optional skill.

**Promise:** "Someone with a keyboard I don't own can add it to keyloom without asking me how."

**Build:**

- `CONTRIBUTING.md` with the board guide ([04](04-boards-and-contributions.md#contributing-a-board)), `boards check`, and a CI job that checks every board in `boards/`.
- A template board. BK's Corne as the first contributed board, following the guide literally (Q10).

**New unknowns:** whether the format is enough for a third board without changing code; whether the guide is followable by someone who isn't us.

**Demo:** Add the Corne by following `CONTRIBUTING.md` alone, then import, view, build and flash it.

**Done when:** the Corne is added through a data-only PR that passes `boards check` in CI, and it works end to end.

**Left out:** everything after the car.

## Rungs 9 to 18: configurator parity and a UI BK enjoys (planned 2026-10-15)

The car is built and released (v0.10.1). These rungs take what keymap-editor, Oryx and Vial do well into keyloom ([16](16-key-editor.md)), make Apply end on the keyboard ([17](17-keyboard-sync.md)), let BK run the agent on his Codex subscription or an OpenRouter key ([19](19-model-providers.md)), and redo the look ([18](18-visual-design.md)). Every rung keeps the build philosophy above, and every rung that changes the UI passes the screenshot gate in [18](18-visual-design.md#how-a-rung-proves-it-looks-good).

Only BK can do these:

| # | Action | Needed by |
|---|---|---|
| A6 | Create an OpenRouter key with credit and make it available as `OPENROUTER_API_KEY` | Rung 10 (S19) |
| A7 | Keep `codex login` signed in to his ChatGPT account (it was on 2026-10-15) | Rung 10 (S20) |
| A8 | Connect both Glove80 halves by USB and do one key-combo bootloader entry per half for the first module flash | Rung 12 (S12) |
| A9 | Connect the Corne and put each half in its bootloader once | Rung 12 (S13) |

## Rung 9: Fix: change any key in the editor

**Status:** Built in v0.11.0. Done when: not recorded.

**Previously:** the editor refuses most single-key changes with validator text. **Now:** any key can be changed, and every problem is a sentence with a way forward.

**Promise:** "I click F16, make it F17, and keyloom asks whether to drop F16 or put it somewhere first."

**Build:** the drop-function prompt and "place" mode ([16](16-key-editor.md#replacing-a-key-whose-function-exists-nowhere-else-asks-in-plain-words), D-092). A people sentence for every validator rule (D-101). 1-based key numbers everywhere a person reads them.

**New unknowns:** none.

**Demo:** change F16 to F17 on BK's Moonlander layout, choose Drop F16, apply, undo.

**Done when:** on the installed binary, every key on BK's Moonlander and Glove80 base layers can be changed to an unused key through the editor alone, and no screen shows a layer ID or a 0-based position.

**Left out:** the new key panel (rung 11).

## Rung 10: Scooter: keyloom's chat runs on my Codex subscription or OpenRouter key

**Status:** Built in v0.12.0. Done when: partly observed. All four evals pass through OpenRouter (S19) and the Option–Option and hostile-prompt probes pass through Codex (S20). Both ran on the rung's branch, not the installed binary.

**Previously:** the agent needs Anthropic API credits, which ran out. **Now:** BK picks a provider: his Codex subscription, an OpenRouter key, or an Anthropic key.

**Promise:** "I signed in with Codex, asked keyloom about Option–Option, and got the same validated proposals."

**Build:** [19](19-model-providers.md): the provider adapters behind `AgentModel`, provider settings, the evals per provider.

**New unknowns:** whether Codex's agent loop can be limited to keyloom's tools; whether the evals pass on the other providers.

**Demo:** run the four evals in `evals/scenarios` on each configured provider, then ask the Option–Option question in the web app on Codex.

**Done when:** the evals pass on at least one non-Anthropic provider on the installed binary, and the chat works end to end on it.

**Left out:** providers other than the three.

## Rung 11: Scooter: the key panel

**Status:** Built in v0.13.0. Done when: not recorded (click counts, screenshot gate).

**Previously:** a binding editor under the board, picked by kind. **Now:** the Oryx-style key panel beside a board that fills the stage.

**Promise:** "I click A, click held, click Ctrl, and it's a home-row mod, while I can still see the key."

**Build:** the key panel with tap and hold slots, the picker with categories and Any, typed keys filling the tap slot ([16](16-key-editor.md#the-key-panel), D-086, D-087). The new shell: board stage, side panel, chat drawer, header with layout menu, toolbar, toasts ([18](18-visual-design.md#the-board-stays-in-view-while-a-key-is-edited), D-098, D-099). The visual tokens and keycap anatomy for the kinds that exist ([18](18-visual-design.md#visual-system), D-100).

**New unknowns:** scaling the board to the stage for three geometries; the chat drawer's chip selection.

**Demo:** make A a mod-tap, change a layer key, use Any for `LCTL_T(KC_A)`, all on the Moonlander and Glove80.

**Done when:** a mod-tap takes 4 clicks from an empty key and 3 from A, the board never moves while editing, and the screenshot gate passes.

**Left out:** double-tap slots and macros (rung 14).

## Rung 12: Bicycle: flash my Glove80 and Corne without touching them

**Status:** Built in v0.12.0 (the `keyloom-zmk` module and the host flasher), with proof reporting in v0.14.0. Done when: partly observed on the Glove80, not on the Corne. keyloom restarted both halves at 1200 baud with no keypress and verified both on one build (S12, 2026-10-16). It took three attempts and two fixes (v0.34.6, v0.34.7), and two fault-free hands-free flashes in a row have not been observed. S13 (the Corne) has not run.

**Previously:** ZMK flashes need a key combo on each half. **Now:** after one more manual flash, keyloom restarts each half into its bootloader itself.

**Promise:** "I click Flash and the Glove80 updates while my hands stay in my lap."

**Build:** the `keyloom-zmk` module, the host trigger, markers and verification, the `handsFree` board block ([17](17-keyboard-sync.md#hands-free-flash-on-zmk-the-keyloom-zmk-module), D-095).

**New unknowns:** S12 (module and relay on the Glove80); S13 (the Corne).

**Demo:** flash the Glove80 by key combo once, then flash a change with no keypress, with the right half on its cable. Then the same on the Corne.

**Done when:** two hands-free flashes in a row are verified on both ZMK boards, and a failed trigger falls back to the manual instruction.

**Left out:** auto-sync (rung 13).

## Rung 13: Bicycle: Apply puts it on the keyboard

**Status:** Built in v0.14.0. Done when: not observed. The week of use and BK's answer on the wait are not recorded. On 2026-10-17 `keyloom sync status` shows auto-sync on and proven for the Glove80, which is in sync.

**Previously:** Apply, then a separate Build and flash dialog. **Now:** Apply ends on the keyboard, with the sync state in the header.

**Promise:** "I click a key, pick what it should be, and a minute later I'm typing with it, without another click."

**Build:** sync states, auto-sync per board, batching, last good image, Pause ([17](17-keyboard-sync.md#apply-sync-and-the-keyboards-state), D-094).

**New unknowns:** how often a burst of edits collides with a running flash; how long the wait feels in use (it decides rung 17).

**Demo:** three edits in a row on the Moonlander, one build, verified; the same on the Glove80; unplug mid-sync and recover.

**Done when:** a week of BK's real use with auto-sync on, and his answer to "does the wait bother you?" recorded in the ledger.

**Left out:** live writes (rung 17).

## Rung 14: Motorbike: tap dances and macros on the key

**Status:** Built in v0.15.0 (tap dance model, generators, Oryx importer) and v0.18.0 (slots, Macro tab, library). Done when: partly observed. TD0 and TD1 import and send identical reports on QMK's real core (S16). DF0 stays native on purpose. The click counts are not recorded.

**Previously:** tap dance is impossible and macros need the CLI. **Now:** double-tap, tap-then-hold and macros are built on the key.

**Promise:** "I made Esc double-tap to Caps Lock, and a copy-switch-paste macro, without leaving the key."

**Build:** the `tapDance` kind, both generators and the importer for Oryx tap dances ([16](16-key-editor.md#tap-dance-is-a-key-with-a-double-tap-slot), D-093). The Macro tab ([16](16-key-editor.md#macros-are-made-in-the-picker-and-each-pick-adds-a-step), D-088). The library list.

**New unknowns:** S16 (tap dance equivalence and import).

**Demo:** the Esc/Caps tap dance and a three-key macro on both boards, checked in the emulators, synced, and typed.

**Done when:** BK's imported TD0, TD1 and DF0 show as editable tap dances, and a three-key macro takes 6 clicks.

**Left out:** combos (rung 15).

## Rung 15: Motorbike: combos, layers and moving keys

**Status:** Built in v0.17.0. Done when: not recorded.

**Previously:** combos are read-only and layers can only be switched. **Now:** combos are made from a selection, layers are managed in their tabs, and keys swap, drag, copy and paste.

**Promise:** "I selected J and K, made them Esc, renamed Layer 2 to Nav, and swapped two keys across layers."

**Build:** [16](16-key-editor.md#combos-are-made-from-a-selection) (D-089), [layers](16-key-editor.md#layers-are-managed-in-their-tabs) (D-090), [moving keys](16-key-editor.md#moving-and-copying-keys) (D-091), short layer labels on caps ([18](18-visual-design.md#legends-stay-readable-at-every-size)).

**New unknowns:** combo lines on rotated thumb clusters; drag on touch screens.

**Demo:** the J+K combo, a renamed and reordered layer, a cross-layer swap, all synced.

**Done when:** a two-key combo takes 5 clicks, no Glove80 legend renders below 11 px, and deleting a referenced layer is refused with the keys listed.

**Left out:** conditional layers (built after the car, D-385 to D-389).

## Rung 16: Motorbike: history, states, themes and phones

**Status:** Built in v0.16.0 (history, go back, import screen, provider picker, phone sheet). Done when: not recorded.

**Previously:** History lists chats, the theme follows the OS, and a phone scrolls the board sideways. **Now:** the rest of [18](18-visual-design.md).

**Promise:** "I scrolled back through my revisions and flashed last Tuesday's, in dark mode, from my phone."

**Build:** revision history (D-102), the import screen per board, tips, visible disabled reasons, the theme toggle, glyph sets, the phone layout ([18](18-visual-design.md#phones-and-narrow-windows)), shortcuts.

**New unknowns:** none beyond layout work.

**Demo:** undo three revisions back, flash one, then import a Glove80 export from the empty state, then edit a key on a 390 px screen.

**Done when:** the screenshot gate passes for every screen at both widths and themes.

**Left out:** settings and lighting (rung 18).

## Rung 17: Car: live writes (only if rung 13 says the wait hurts)

**Status:** Not built, by design. Rung 13's verdict on the wait decides it, and no code for Moonlander set-keycode or ZMK Studio exists at v0.36.1. S14 and S15 have not run.

**Previously:** every change flashes. **Now:** a binding-only change goes live in under a second, and everything else still syncs by flash.

**Promise:** "I swapped two keys and they were swapped before I lifted my hand."

**Build:** [17](17-keyboard-sync.md#live-writes-are-built-only-if-auto-sync-is-too-slow-in-use) (D-096, D-097): the Moonlander set-keycode command and the ZMK Studio client, live writes recorded as revisions, reset after flash, drift detection.

**New unknowns:** S15 (Moonlander dynamic keymap); S14 (Studio on the Glove80).

**Demo:** a live swap on each board, then a hold-tap change that falls back to a flash, then a flash that resets the live state.

**Done when:** live writes are verified by reading the key back from the board, and a reboot after a flash shows the flashed keymap.

**Left out:** live combos and macros on ZMK, which Studio can't do.

## Rung 18: Car: settings and lighting

**Status:** Built in v0.19.0. Done when: partly observed. Oryx's ledmap is read in and regenerated identically (v0.19.0 changelog). The settings round trip is not recorded.

**Previously:** firmware options are only in the timing tuner and passthrough. **Now:** a settings page and per-key and per-layer colours.

**Promise:** "I set Caps Word and the combo term on one page that explained them, and coloured my Nav layer."

**Build:** [16](16-key-editor.md#settings-and-lighting) (D-103, D-104).

**New unknowns:** which settings Oryx's generated source already sets that keyloom must not override; RGB generation in ZSA's fork.

**Demo:** change three settings and two layer colours on the Moonlander, synced.

**Done when:** every option on the page round-trips through import and generation unchanged when untouched.

**Left out:** everything in [16](16-key-editor.md#what-keyloom-doesnt-take-and-why).

## Rung 19: Car: copy from my other keyboard

**Status:** Built in v0.20.0. Done when: not recorded. S21 answered the lighting question (no).

**Previously:** the agent sees only the layout it is working on, so "make this like my Moonlander" gets a request for an Oryx link. **Now:** it sees every layout, knows what each board can do, and copies colours, behaviours and combos across boards that differ in size and shape.

**Promise:** "I said copy my home row mods from my Moonlander, and it looked at the Moonlander itself and put them on the right keys of the Glove80."

**Build:** [20](20-cross-board.md) (D-220 to D-229): `list_layouts`, `get_layout` of another layout, `map_keys`, board capabilities, the layer and key correspondence.

**New unknowns:** whether MoErgo's firmware can show a colour per key (S21: no); whether the live model uses the tools instead of asking.

**Demo:** in the CLI chat on the Glove80, ask for the Moonlander's key lights (a plain explanation with the reason), then for its home row mods (a proposal), and show the web chat doing the first.

**Done when:** the live evals pass on OpenRouter, the mapping tests hold across the Moonlander, Glove80 and Corne, and the demo transcripts show the agent reading the Moonlander layout itself.

**Left out:** Glove80 lighting (Q24); carrying a typing profile inferred from habits rather than a named thing.

## Rung 20: Car: my MacBook keyboard behaves like my other keyboards

**Status:** Built in v0.21.0. Done when: mostly observed. kanata runs keyloom's config on BK's Mac and one automatic sync applied and verified (`syn_01M53B4CQBCACRJDCTGJJG799H`, 2026-10-16, 5.1 s), which is not the under-a-second target. The exit chord stopped kanata on 2026-10-16 (`keyloom remap confirm-exit-chord` recorded it). BK typed on the remapped MacBook keyboard on 2026-10-18 and said "I tried the macbook keyboard and it works". Disable remapping and untouched external boards are unrecorded; S31 is moot since Karabiner-Elements is being removed (D-231's coexistence case no longer applies on BK's Mac).

**Previously:** keyloom configures QMK and ZMK boards. **Now:** the MacBook's built-in keyboard is a keyloom board through kanata, and changes apply instantly.

**Promise:** "My MacBook keyboard has my home-row mods and layers, and when I change a key it just changes."

**Build:** [21](21-macbook-keyboard.md) (D-230 to D-235): the software-remapper firmware family, the `apple/macbook-ansi` board, kanata key names and generator, apply by reload with verify, the setup doctor and safety, import of BK's Karabiner rules, and mapping his Moonlander or Glove80 layout onto it.

**New unknowns:** S30 and S31 (kanata on the built-in keyboard, next to Karabiner).

**Demo:** run setup with BK (one sudo command), prove the exit chord, import his Karabiner rules, apply a home-row-mod timing change and type with it within a second, then map his Moonlander layout onto the MacBook and apply it.

**Done when:** BK types on the MacBook with keyloom's layout, an Apply changes it in under a second, "Disable remapping" and the exit chord both work, and his external boards are untouched.

**Left out:** the Karabiner-Elements target (D-231); ISO MacBooks.

## Rung 21: Car: connect a new keyboard and put my config on it

**Status:** Built in v0.33.0 (engine and CLI), v0.34.0 (screens) and v0.36.1 (gaps the add-keyboard tests found). Done when: not observed. Detection named the Glove80 on the real bus (S42), and the README says the screens have run on fake keyboards only.

**Previously:** a board needs a contributed definition. **Now:** keyloom recognises a QMK or ZMK keyboard on USB, builds its definition, and puts BK's config on it.

**Promise:** "I plugged in a keyboard keyloom had never seen, confirmed which board it was, and put my Glove80 setup on it."

**Build:** [22](22-new-keyboard.md) (D-236, D-237, D-330 to D-335): USB detection with candidates, definition from the firmware tree plus confirmed heuristics, generalised keyboard detection, new QMK flash recipes (atmel-dfu, stm32-dfu), and "put my config on this" through the cross-board mapping.

**New unknowns:** S42 (detection on BK's boards); S40 (finger heuristics).

**Demo:** with BK's Corne treated as unknown (its definition hidden), detect it, confirm it, put the Glove80 layout on it, first flash, then a hands-free change.

**Done when:** the Corne goes from "unknown keyboard" to running BK's mapped config with only the confirmations the chapter lists.

**Left out:** reading the keymap off boards without Vial, VIA or Studio; hands-free flashing for non-ZSA QMK boards (S41).

**Built (part 1, D-330 to D-335, v0.33.0):** detection against a committed index of the QMK and ZMK trees, the generalised keyboard reader, board derivation with the heuristics' accuracy reproduced in tests, local boards in the data directory, "put my config on this" as proposals on a new config, and `keyloom keyboard detect|add|put`. S42 ran on BK's Glove80; S40 is closed.

**Built (part 2, D-336, v0.34.0):** the stage card, the question column and the open proposals screen. **Built (part 2, D-365 to D-369):** the `dfu-tool` flash for `atmel-dfu` (dfu-programmer), `stm32-dfu` (dfu-util) and `caterina` (avrdude), which together cover 76% of the QMK boards with USB IDs, with `keyloom doctor` checking for the tools; and the smoke build (S43), which built four QMK boards and a ZMK Corne in Docker and corrected one submodule list. **Still not built:** a flash on a physical keyboard (the recipes run against fake tools only), and recipes for the other QMK bootloaders (`halfkay`, `usbasploader`, `bootloadhid`, `stm32duino`, `wb32-dfu`), which stay `manual`.

## Rung 22: Car: keyloom watches me type and tunes my home row mods

**Status:** Built in v0.27.0 (capture and analysis engine) and v0.30.0 (screens and routes), with a retune fix in v0.30.1. Done when: not observed. Nothing has run on a keyboard: S50 and S51 are runbooks and S53's keyboard half is not done.

**Previously:** timings are guessed. **Now:** a typing session records what BK's hands do and proves fixes on his own keystrokes.

**Promise:** "I typed for three minutes, keyloom showed me my S→D rolls fire Option, and the fix it suggested removed 7 of 9 misfires before I flashed it."

**Build:** [24](24-typing-lab.md) (D-280 to D-283): the event stream in QMK and ZMK firmware, capture on the host, replay and counterfactuals in the emulators, per-finger analysis, passages, the lab screens, CLI and an agent tool.

**Design:** the lab screen, recording indicator, findings on the caps and the per-finger heat, following [23](23-design-concept.md) and the key moments in 24; comps first.

**New unknowns:** S50/S51 (firmware capture); S53 (replay fidelity).

**Built (part 1, D-284 to D-289, v0.27.0):** the stream in all three boards' firmware, the host readers, the `typing_sessions` table, replay, classification, the counterfactual search, per-finger numbers and sentences, the passages, `keyloom lab` and the agent tool. **Built (part 2, D-314, v0.30.0):** the lab screens, the recording light and the findings on the caps, run on a scripted fake keyboard. S50 and S51 have runbooks and have not run on a keyboard; S53's emulator half is done.

**Demo:** on the Moonlander, record a session, see findings per finger, try a timing fix, see before and after, apply it, and type again.

**Done when:** a real session on BK's Moonlander and Glove80 produces findings he agrees with, and a suggested fix's replayed improvement holds up in a second session.

**Left out:** the MacBook (S52); key-frequency statistics outside a session.

## Rung 23: Car: several configs per board, and versions I can go back to

**Status:** Built in v0.27.0 (engine) and v0.31.0 (screens), with polish in v0.31.1 and v0.32.0. Done when: partly observed. "Editing a non-active config never syncs" is a test. Versions after real syncs on BK's Moonlander are not recorded.

**Previously:** one implicit layout per board, a flat revision list. **Now:** named configs per board, one explicitly on the keyboard, and versions as milestones.

**Promise:** "I keep QWERTY, Colemak and a steno config on my Moonlander, switch with one click, and when last week's change didn't work out I went back to the version from before it."

**Build:** [25](25-configs-and-versions.md) (D-300, D-301): config on the keyboard per board, the sync engine change, new config from current/version/blank/import, rename and archive, versions recorded on verified sync, naming, compare and go back, CLI and agent awareness.

**Design:** the config switcher in the top bar, the "editing X · Y is on your keyboard" line, and History's version milestones with compare-on-board, all in [23](23-design-concept.md)'s language. Comps first.

**New unknowns:** migrating existing data to an explicit on-keyboard config (the newest layout per board, as today).

**Demo:** make a Colemak config from QWERTY, edit it without the keyboard changing, put it on, go back to an earlier version, and compare.

**Done when:** editing a non-active config never syncs (tested), and versions appear after real syncs on BK's Moonlander.

**Left out:** sharing configs between people.

## Rung 24: Car: keyloom is an app on my Mac

**Status:** Not built at v0.36.1. The desktop shell is being built on another branch, and chapter 26 is still a proposal.

**Previously:** a browser tab. **Now:** a desktop app with its own window, shortcuts, and a menu-bar sync status.

**Promise:** "keyloom lives in my Dock, my shortcuts never fight the browser, and the menu bar tells me when my keyboard is behind."

**Build:** [26](26-desktop-app.md) (D-320 to D-329).

**Design:** the menu-bar extra and its menu, the notifications, and the window chrome in [23](23-design-concept.md)'s language.

**New unknowns:** notarisation in CI; the tray glyph's appearance on BK's menu bar.

**Demo:** install from the cask, launch, edit and apply, and watch the menu bar go amber then green.

**Done when:** a signed, notarised `.app` from a release is installed on BK's Mac and used for a full edit, apply and sync.

**Left out:** Windows and Linux builds.

## Device-helper extension (planned 2026-10-20)

Status: 24b diagnostics shipped in v0.46.1; published CLI and signed/notarised desktop-sidecar verification passed. Native transport rungs 24c–24f remain proposed. Rungs 24b–24f extend the local runtime after rung 24 without renumbering shipped work. They are an independent delivery track, not blocked on rungs 27–30. Each rung ships through the normal release process only when BK authorizes publication; this blueprint itself authorizes neither release nor hardware access.

**Build philosophy:** reuse the transport contracts and firmware fakes, ship one usable capability at a time, and keep the previous product working after every rung. At most two new unknowns per rung. If a gate reveals more, split the rung with a letter rather than claiming completion from unit tests.

### Device-helper phase 0: characterize before replacing

Read [31](31-device-helper.md), [32](32-device-helper-protocol.md), [33](33-device-helper-platforms.md) and the [reuse map](../research/rust-device-helper.md). Run S58 and the contract/build/packaging portion of S62. Build a throwaway native-helper prototype and fake backend; do not switch production transports. Set up compile/contract checks for macOS, Linux and Windows from the start. This is research, not a second product foundation rung. The [2026-10-20 report](../research/spikes/device-helper-24b.md) records source/synthetic S58 characterization and local macOS diagnostics S62 evidence; it does not close native transport or other-platform release gates.

| Action | Owner | Needed by |
|---|---|---|
| Confirm initial architectures and minimum-OS policy, Q37 | BK; blueprint assumes macOS arm64/x64, Linux x64, Windows x64 | First target-specific release |
| Confirm the paired extraction/distribution assumption, Q41; identify signing/CI access already available | BK for credentials/approval; agent can inspect existing tooling | 24b packaging gate; Windows half before 24f |
| Name test machines/keyboards and authorize the exact capture/reset/flash actions, Q39 | BK; no permission carried from this planning chat | Physical acceptance of 24c–24f |
| Confirm Windows transport/CLI scope versus full product parity, Q38 | BK; blueprint assumes the former | 24f scope freeze |

Protocol and experience assumptions Q40/Q42 are documented for review; synthetic work may proceed on them. Any change to their safety invariants needs a decision-log entry. A missing hardware host blocks its platform's hardware claim, not the other platforms' work.

## Rung 24b: I can diagnose the installed device helper

Status: shipped in v0.46.1, 2026-10-20 (D-426; PRs 136, 138, 139). Full/native CI, both-Mac signing preflight and published CLI/checksum/helper-signature checks passed. The downloaded signed/notarised desktop bundle's sidecar doctor and scratch update/rollback/re-upgrade also passed. [Published proof](../research/spikes/device-helper-24b.md#published-release-proof) records release hashes, the failed v0.46.0 attempt and the explicitly waived signing-patch review, not a Gemini pass. [Native clock evidence and the real OS-pipe oracle](../research/spikes/device-helper-24b/ci-followup.md#native-clock-proof-and-final-oracle) preserve the resolved development failures. No hardware or native transport adoption is claimed.

**Previously:** device failures are reported by in-process transports. **Now:** the installed CLI can verify the paired helper and explain installation/protocol failures before opening a keyboard.

**Promise:** "I can check whether keyloom's device connection is installed correctly without touching my keyboard."

**Build:** the private protocol supervisor, schema conformance corpus, fake-only test helper, trusted launcher/extraction manifest and doctor row (D-421, D-424). Existing transports remain the production defaults. Implement no real capture merely to demonstrate packaging.

**Design:** doctor retains its compact table/JSON structure. It distinguishes missing/mismatched helper from no device attached and does not claim write permissions from a metadata check. No new web surface.

**New unknowns:** paired installed packaging; bounded process/pipe lifecycle. Both are investigated in S62.

**Demo:** install v0.46.1 through the actual release installer into scratch paths; run `keyloom --version` and `keyloom --data-dir <scratch> doctor --device-helper-only` outside the repo. Normal doctor adds the same helper check while retaining its existing probes. Exercise a deliberately mismatched/corrupt helper in an isolated installation and show a clear refusal. Run the synthetic child through EOF and stalled-pipe shutdown.

**Done when:** S58 and the macOS packaging/contract half of S62 have reports; installed doctor detects the valid and invalid pairs without opening a device; all target builds and shared-contract tests run; a cold extraction/concurrent launch works; the existing CLI/import/editor still works. Unavailable signing/minimum-OS evidence is explicitly blocked, not passed.

**Left out:** production native device access, hardware reliability claims, native Linux/Windows support claims and a default-backend switch.

## Rung 24c: My Moonlander recording survives transport failure honestly

Status: native HID/capture implementation candidate; explicit compile-time installed CLI selection is synthetic-tested. Production adoption remains blocked on the HID half of S59 and installed physical acceptance. The compile-gated macOS adapter, bounded session protocol, explicit TS adapter and QMK incomplete-recording path are implemented in the [24c candidate](../research/spikes/device-helper-24c.md); the 24d TypeScript ZMK interruption path now runs on the legacy serial transport, while the native serial adapter is a compile-gated 24d candidate. Defaults and release builds remain diagnostics/legacy; no physical gate passed.

**Previously:** macOS HID callbacks and lifetimes live in Bun. **Now:** an adopted Rust HID backend owns them, while existing QMK capture and sync policy remain in TS.

**Promise:** "I can start and stop recording, and if the connection breaks keyloom tells me what was lost."

**Build:** macOS HID discovery, exact selection/leases, normalized report I/O and the `HidTransport` adapter. Keep one-shot reboot writes under the existing app safeguards. Remove the adopted macOS HID FFI path only after comparison and acceptance (D-418, D-419, D-423).

**Design:** existing lab running/stopping/interrupted states; reachable Stop, an explicit incomplete result, and a fresh-start action after reconnect. Show new failure copy in the current concept before implementing it; pass both themes/widths. No helper badge.

**New unknowns:** native HID lifecycle/framing; real permission and firmware-stop behavior.

**Demo:** with session-specific permission on a suitably flashed board, use installed `keyloom lab start <layout>` in scratch data, type a synthetic passage, stop and start again. Unplug during capture and kill the helper in separate runs. Confirm ordinary typing remains intact. Separately authorize and verify a one-shot reset before claiming that capability.

**Done when:** S59's HID evidence and S62's installed macOS path pass; no silent loss/replay, native resources close or report bounded failure, and installed UI/CLI agree on complete versus interrupted capture. Full TS tests/types/dependency checks and native checks pass. Complete equivalent native evidence for each advertised macOS architecture; unsupported capabilities remain gated.

**Left out:** serial migration, new firmware protocols and Linux/Windows device claims.

## Rung 24d: My Glove80 uses the same owned device connection

Status: TypeScript capture lifecycle on the legacy stty/polling transport built. [Slice 1](../research/spikes/device-helper-24d.md) adds synthetic Rust serial sessions, the explicit installed `native-serial` selector and a software-only PTY smoke, all passing locally. Slice 2 adds direct macOS registry/POSIX serial ownership (D-431), checked raw 115200/DTR setup and checked close, with pure/PTY tests and source candidate builds. Touch, real-port behavior and physical serial S59 remain pending. The 24c dependency and physical acceptance gates remain open.

**Previously:** macOS serial discovery uses FFI and capture/touch use stty/polling. **Now:** the helper owns CDC sessions and explicit touch operations.

**Promise:** "I can record my Glove80 and stop cleanly, without a recording accidentally restarting it."

**Build:** macOS CDC enumeration and identity, native serial configuration, serial adapter and awaited write/close throughout real/fake capture callers. Integrate per-endpoint busy handling with existing sync serialization; preserve TS firmware parsing and half selection (D-422).

**Design:** reuse 24c's lab interruption pattern and the current sync detail. A busy recording explains why sync cannot restart that endpoint; it is not silently stopped to make room.

**New unknowns:** DTR/baud sequencing, including 1201 relay; asynchronous serial error propagation through existing callers.

**Demo:** installed CLI and web lab capture/stop/reopen on an authorized Glove80, failure mid-line and helper kill; prove capture close never reboots. With separate permission, exercise 1200 local and 1201 relay touches and verify the intended half. Do not flash merely to test the transport.

**Done when:** serial S59 and installed/desktop S62 evidence pass; every write/close is awaited; fragmented lines preserve events; uncertain writes are not retried; selected-half identity and line-state behavior are observed. Unobserved relay behavior remains unsupported rather than reported as verified.

**Left out:** flash-tool rewrites, UF2 handling and changes to ZMK firmware semantics.

## Rung 24e: I can use the device helper on native Linux

Status: not built; depends on 24b's contract/package work and applicable 24c/24d adapter work. It need not wait for unrelated macOS-only desktop credentials.

**Previously:** Linux transport code exists but hardware evidence is limited. **Now:** a named Linux runtime/board matrix has an installed, verified HID/CDC backend.

**Promise:** "On Linux I can connect and record my keyboard, and keyloom tells me exactly which permission is missing."

**Build:** native hidraw/CDC adapters, correct report-ID normalization, USB ancestry, leases, scoped permission guidance and Linux release extraction/dependencies (D-420).

**Design:** same lab/sync journey as macOS, with Linux-specific remedies behind doctor/Details. No instructions to run the entire app as root.

**New unknowns:** native device behavior/permissions, including ModemManager; runtime dependencies and native installed lifetime.

**Demo:** install on the declared runtime floor without development tooling; run doctor and authorized HID/serial capture, stop, unplug and restart. Test denied access and absent by-id links. Verify authorized touch capabilities separately.

**Done when:** S60 and Linux S62 evidence pass, native CI plus installed CLI checks pass, and real hardware proves every advertised capability. Record OS/board/firmware/version evidence and measured regressions against the old transport. Synthetic sysfs tests alone do not close this rung.

**Left out:** Linux desktop packaging, untested distro/architecture claims and generic flash parity beyond already verified capabilities.

## Rung 24f: I can use the device helper on native Windows

Status: not built; depends on 24b's contract, shared adapters, Q38 scope confirmation, S61 and Windows S62.

**Previously:** no Windows transport or release target exists. **Now:** the native CLI can diagnose and use the helper for HID/CDC capture on a declared Windows matrix.

**Promise:** "On Windows I can connect my keyboard and record a session without WSL or replacing its keyboard driver."

**Build:** Windows HID collection/COM identity, bounded I/O and cancellation, Windows leases, the minimal native Bun CLI path, and checksum-verified per-user PowerShell installation. Gate unsupported general USB/build/flash/remap workflows explicitly (D-420, Q38).

**Design:** reuse the same CLI and lab wording; distinguish missing driver, busy device and unsupported app capability. No administrator-first setup or blanket SmartScreen/antivirus bypass.

**New unknowns:** native Windows HID/CDC behavior; installed Windows parent/helper portability. If the app-port audit adds a third, split this rung before implementation.

**Demo:** install the release on native Windows with no source tree, import a synthetic/public layout into scratch data, run doctor, authorize a lab recording, stop with Ctrl-C, then repeat with COM renumbering and helper termination. Test paths with spaces/non-ASCII characters and a busy port. Reset tests require their own permission.

**Done when:** S61/Windows S62 record native and physical evidence, every claimed device capability works, incomplete captures stay incomplete, and unavailable app workflows fail clearly. Windows-only compile success, WSL or a helper-only demo do not satisfy the installed CLI gate.

**Left out:** full Windows product parity, Windows Tauri packaging, general bootloader/UF2 support, kanata and Windows ARM unless Q38/Q37 explicitly expand scope.

## Rung 25: Car: keyloom looks over my board without being asked

**Previously:** warnings appeared only in a proposal's validation, and BK had to ask the agent what it thought of a layout. **Now:** every revision of every config gets a review: the checks at once, the agent's suggestions after, shown as a marker, marks on the keys and a review in the side column.

**Promise:** "I connected my keyboard and keyloom had already told me which keys do nothing and what it would change, without my asking."

**Build:** [27](27-board-review.md) (D-340, D-343, D-344): `board_reviews` and `review_items`, the standing checks plus `keys_do_nothing`, the agent's run through `submit_review`, level-triggered triggers, hiding and the fixed tick, `GET /api/layouts/:ref/review`, the events stream and `keyloom review`, then the screens.

**New unknowns:** whether the agent's suggestions earn their cost (about $0.25 to $0.40 a review on OpenRouter in the logged runs); whether the triggers fire at the right moments.

**Demo:** connect the Glove80, watch the marker go from "Looking over your change…" to a count, open the review, show a suggestion on the board and apply it.

**Done when:** a review appears on BK's real configs without a request, survives a restart, and a suggestion applies through the ordinary change-set path.

**Status:** Built in v0.35.0 (engine, checks, agent part, triggers, routes, events, CLI) and v0.36.0 (screens), with fixes in v0.36.1. Done when: partly observed. `keyloom.log` records two completed reviews on BK's Glove80 and MacBook layouts on 2026-10-16 (`rvw_01M53GZ1XET8E4SZ4XZ709143D`, 61 s, $0.39; `rvw_01M53H0XHFJQCJ54ADPDC4S8Z2`, $0.26). A review surviving a restart and a suggestion applied from the panel are not recorded.

**Left out:** reviews of configs nothing touched while their keyboard was away, which run only when asked (D-343).

## Agent-native extension (planned 2026-10-18)

These are follow-on rungs for an existing product (D-406), not evidence that they shipped. Each rung must be usable without the next. Keep the existing release channel and design gate. Read [28](28-agent-experience.md), [29](29-agent-app-control.md) and [30](30-agent-keyboard-context.md) as one experience.

No new accounts or credentials are required by this plan. Use the provider setup already available. S54 to S57 and Q30 to Q36 are in [15](15-open-questions.md). The first build session starts with S54 and the rung 26 comps, not all seven open product questions at once. A rung that exceeds one useful session is split with another letter; do not call a multi-session subsystem a completed rung.

## Rung 26: I can see what the agent is doing

Status: 26a and 26b are released in v0.42.0 and v0.43.0. The bounded public CLI/web journeys passed; no live-provider or hardware validation is claimed. BK's later working-order and independent display/LED configuration corrections are being implemented separately (D-412, D-413). App-wide control remains later work.

Previously, one activity string represents a running turn. Now a request has distinct user/agent hierarchy, real correlated tool progress, a quiet thinking shimmer, and a final answer with routine work folded away.

**Promise:** "I know it's working, I can see what it is checking, and when it's done I can read the answer without all the noise."

**Build:** lifecycle instrumentation, persisted run/event projection, replay and legacy fallback from [29](29-agent-app-control.md); turn composition from [28](28-agent-experience.md). Existing read/proposal tools only. Define event-size and retention bounds with S54/Q36 before persistence ships.

**Design:** approve running, completed, stopped and failed comps in both themes (Q30). Keep the board as hero and reuse the side column. Pending questions and unapplied proposals stay visible.

**New unknowns:** provider-neutral lifecycle/message boundaries; interrupted-stream replay (S54).

**Demo:** ask for a mirrored hold on selected keys using scripted tools, inspect tool results, disconnect/reconnect, stop a second run, then finish another and reopen its folded work. Also run with a configured live provider only if authorized; never call a simulation a live-provider proof.

**Done when:** the served app and installed CLI show the same ordered operations and final outcome; reconnect neither duplicates the turn nor reruns an effect; reduced motion stops shimmer; keyboard focus and scroll survive folding; chapter 28's design gate passes.

**Left out:** new mutating tools, cross-target write routing and new question kinds.

## Rung 26a: I see real work and can read the final answer

Status: built and released in [v0.42.0](https://github.com/planetaryescape/keyloom/releases/tag/v0.42.0), 2026-10-18. Full suites and compiled acceptance passed, followed by checksum-verified installation and the [published CLI/web journeys](../screenshots/agent-experience/published-0.42.0/README.md). This is 26a only, not the original rung's durable-execution promise. Stop stays visible on phones, including when another sidebar replaces chat (D-410). No real-provider or hardware check is claimed.

**Compiled candidate:** completed activity and public message grouping survived reload; the actual composer produced the same saved grouping; desktop Stop and phone shell Stop preserved completed config preparation with non-rollback warnings. Reading history left exactly the original plus two deliberate synthetic copies, with the original unchanged. The actual Hints/Settings/History/Library/Ask controls replaced one another without overlap. This used fake Codex through real MCP and the bundled app, not paid providers, real layouts or hardware. Transient running read rows were too fast to capture; running-turn/Stop behavior was observed with a deliberately hanging preparation request. [Candidate evidence](../screenshots/agent-experience/integrated/README.md).

**Published release:** the downloaded v0.42.0 passed 21 CLI checks and fresh browser journeys for grouping/folding/reload, desktop/phone sidebar replacement, phone shell Stop after one prepared copy, and the corrected question/answer path. History reads retained exactly the original plus that one copy, with the original head and selection unchanged. The observation window recorded no uncaught browser errors; a favicon 404 and one provider-status request without a terminal record are documented. The native desktop ZIP, live providers and hardware were not tested.

Previously, the agent shows one activity string and combines working notes with its final answer. Now the existing layout-scoped conversation shows correlated tool start/result/failure, semantic validation refusal, separate public working notes and final answer, and inspectable bounded completed activity.

**Promise:** "I can see what it checked, tell a failed check from a successful one, and read the answer without all the working in the way."

**Build:** the smallest compatible observation/message-boundary path over existing tools, model replay and questions/proposals. Persist sanitized completed or partial presentation linked to the original turn, not a full new run engine. Expose the same history inspection through CLI. Negotiate new stream events explicitly so old strict parsers keep working. Keep raw tool returns, credentials, recordings and opaque thinking out.

**Design:** approve the running, waiting, completed/collapsed and stopped/failure comps in the current visual world (Q30). Preserve questions and pending proposals as primary actions, and never imply a verified device outcome from a finished reply.

**New unknowns:** provider-neutral public boundaries and semantic result classification; bounded completed-presentation persistence and compatibility. S54 has characterized the existing seams and failures; production behavior still needs tests.

**Demo:** with a scripted provider and scratch layout, inspect keys, reject an invalid proposal, show a valid one, finish and reopen the collapsed working, then reload the saved conversation and inspect it through CLI. Stop a config-preparation request and show the warning that an effect may already have completed. No automatic resend occurs.

**Done when:** live/reloaded public message grouping agrees for new turns; repeated/parallel calls keep distinct identities; invalid validation is not green; old clients receive their supported event shape; completed details and CLI inspection agree; a stopped/lost stream never says preparation was rolled back; ordinary checks, installed-client smoke and the design gate pass after release.

**Left out:** continuing running work after a socket closes, request deduplication/effect recovery, new app actions and cross-board targeting. Connection loss still may end execution. Say so visibly; do not call this durable reconnect.

## Rung 26b: I reload the same work without executing it again

Status: released in [v0.43.0](https://github.com/planetaryescape/keyloom/releases/tag/v0.43.0). The checksum-verified installed public CLI and bundled web app passed [21 preflight checks and four durable-work journeys](../screenshots/agent-experience/26b-published-0.43.0/README.md): early Stop, request deduplication and reload, interrupted recovery with a visible receipt, and consecutive questions with distinct saved answers. This is the existing preparation/question scope in the [26b contract](../research/spikes/26b-contract.md), not app-wide control. The real desktop update is held for BK's subsequent ordering/colour corrections; native runtime, paid providers and hardware are not part of this proof. D-411 records the narrower storage and job scope.

Previously, completed activity is inspectable but a stream interruption may still lose in-flight execution/history. Now execution belongs to a persisted run instead of a subscriber, and a reconnect reads the same work without resending its effects.

**Promise:** "I can close and reopen the agent, see what it already did, and continue without creating or applying the same thing twice."

**Build:** run identity and client request deduplication, sequence/catch-up, atomic local effect receipts, existing-job reconciliation, explicit Stop and restart-as-interrupted recovery from [29](29-agent-app-control.md). Audit all preparation writes: proposals, memory and config creation, not only one tool. Preserve 26a presentation compatibility while extending the execution owner.

**Design:** keep a quiet running/waiting indicator when the column closes. Reopening returns to the same request, context and pending decision. Unknown effects remain visible rather than receiving a guessed checkmark.

**New unknowns:** atomic receipt integration across existing writes; subscriber/process recovery and safe job reconciliation.

**Demo:** disconnect after a synthetic config commits, reconnect by run ID, repeat the request ID and answer ID, and restart the server during another request. Observe one domain effect and its original result, no duplicate execution. Stop before acceptance and after preparation; neither path may forget the cancellation intent. Non-interruptible fake device-job cancellation belongs to rung 28b, when a real agent route can start that job (D-411).

**Done when:** duplicate/out-of-order events project deterministically; a reconnect never repeats a POST effect; local mutations and receipts cannot diverge at a commit boundary; pending questions/approvals survive restart with exact scope; linked jobs retain their real state; release/installed-client and design gates pass. Only now may the original rung 26 be marked complete.

**Left out:** workspace conversation migration, new agent capabilities and independent physical identity for identical-model keyboards.

## Rung 27: I answer on the keyboard and inspect real results

Status: Built on feat/rung27-interactive-questions. Interactive question kinds, typed artifact union, native renderers, selection reopening, confirmation and outcome cards.

Previously, questions have a few buttons and free text. Now a key/layer/config/keyboard choice uses the corresponding app control, and tool results use typed cards and existing previews.

**Promise:** "When it asks where something goes, I click the key; when it finds something, it shows it to me."

**Build:** question and artifact unions, native renderers, message/run ownership and pause/resume from [28](28-agent-experience.md) and [29](29-agent-app-control.md). Preserve the current validated proposal path. Settle Q33's initial kinds.

**Design:** prototype the key-pick mode, the phone sheet handoff, a comparison and a transfer report. Reuse layer chips, board rendering and existing Apply rather than parallel widgets.

**New unknowns:** stale scoped question answers (S55's question half); keyboard-accessible stage/sheet selection.

**Demo:** ask where a layer key should go, choose on the target board, reload before answering another question, and inspect a mapped result with an unsupported item. Complete the same question through the installed CLI.

**Done when:** question IDs and target context survive pause/reload; no model process waits; answered cards remain readable; a stale dependent plan cannot apply; artifacts reveal the correct board/layer; keyboard-only and phone journeys pass the design gate.

**Left out:** arbitrary forms, app-wide mutation and batch execution.

## Rung 28: I manage configs, versions and settings through the agent

Status: not built; depends on rung 27 and Q32's confirmation policy.

Previously, many tasks require another app surface. Now the agent can navigate, create/rename/archive configs, compare/restore versions and manage the existing editable app settings with the same results and safeguards as direct manipulation.

**Promise:** "I can ask it to make a config, compare last week's version, or change a setting without hunting through menus."

**Build:** first capability inventory (S56), typed local UI intents, preparation/confirmation receipts and idempotent effects from [29](29-agent-app-control.md). Reads and safe preparation run directly; consequential config changes use the approved plan. Deletion retains its existing typed-name confirmation.

**Design:** show each action's actual target and result, with one primary action. A local theme setting is not styled like a firmware Apply. The conversation remains readable when a settings/history sheet opens.

**New unknowns:** shared capability-policy enforcement; atomic mutation/effect receipts.

**Demo:** create a separate config, rename it, compare a version, prepare a restore, edit the target via CLI before confirmation and observe refusal. Retry a completed creation after reconnect and see only one config.

**Done when:** the inventory's config/version/settings rows pass through UI, agent and CLI; the same use cases and validation are exercised; stale confirmation writes nothing; effects survive reconnect honestly; the design gate passes.

**Left out:** starting device writes, recording sessions and cross-board destination writes.

## Rung 28b: I control builds, sync and the typing lab without leaving the agent

Status: not built; depends on rung 28.

Previously, the conversation prepares edits but cannot carry the workflow through device/lab controls. Now it can prepare a build or device action, pause sync, guide remapper setup, start/stop an explicitly approved recording and present diagnostics or emulation results.

**Promise:** "I can ask what is blocking my keyboard, approve the next step, and watch its real progress here."

**Build:** firmware/sync/remapper/lab/review/diagnostic inventory rows and linked jobs from [29](29-agent-app-control.md). Keep existing first-flash, exit-chord, recording and deletion safeguards. Preserve auto-sync disclosures on active-config Apply.

**Design:** prototype approved Apply -> sending -> verified, offline/needs-hand, explicit recording and stop-during-write states. Reuse the sync line's sentences and lab's per-finger findings.

**New unknowns:** conversation-to-existing-job recovery; safe cancellation across build/write phases.

**Demo:** on scratch data and fake devices, approve a sync, observe all phases, request Stop during writing, and see the honest outcome. Start/stop a synthetic lab session with explicit consent and open aggregate findings. Hardware validation is a separate authorized demo, never an implicit part of a smoke test.

**Done when:** UI, CLI and agent observe the same job IDs and states; a finished model reply never marks a device verified; no raw recording reaches the model; disconnection does not lose effects; all supported covered actions pass the design gate. Record unobserved real-hardware checks separately.

**Left out:** bypassing OS permissions, unattended first flashes and new cross-board execution.

## Rung 28c: Every existing app workflow has a complete agent route

Status: not built; depends on rung 28b.

Previously, the highest-frequency capabilities are covered. Now the coverage inventory closes the remaining app workflows, including keyboard registration, import/export, all existing review/memory controls and remaining settings or config actions.

**Promise:** "Anything I can do in Keyloom has a way through the agent, including the awkward setup steps."

**Build:** finish S56's action-by-action inventory, file/OS handoffs and the coverage conformance gate. Every row names the real use case and completion evidence, not "supported" inferred from a prompt.

**Design:** prototype import/file selection, keyboard add, an unsupported capability and permission-required continuation. Show what the person must do locally and resume in the same task.

**New unknowns:** browser file-gesture handoff; complete inventory drift detection.

**Demo:** import a synthetic config through the agent, inspect the preservation report, export it, add a fixture-backed board, then use the agent for review/priority maintenance. Exercise provider setup without placing a secret in chat. Compare every inventory row against the direct app and CLI.

**Done when:** no existing app workflow remains an unimplemented agent placeholder; justified OS-only steps have working controls and continuation; adding an unregistered app action fails the explicit coverage test; the installed binary and served-app journeys pass. No broad shell tool fills a gap.

**Left out:** new keyboard firmware support, developer-source editing and physical duplicate-model identity.

## Rung 29: I can send a change to a keyboard I am not looking at

Status: not built; depends on the scoped runtime and confirmation work from rungs 26 to 28; it may precede 28c if its existing capability prerequisites are covered.

Previously, cross-board reads and put-config exist but ordinary proposals target the origin conversation's layout. Now any explicit registered destination can receive a checked proposal, shown in the originating conversation.

**Promise:** "I can tell my Moonlander to send this to my MacBook, see what that means there, and keep talking."

**Build:** [30](30-agent-keyboard-context.md): collection read model, per-request focus, target-specific ports, transfer artifacts over existing mapper results and explicit destination proposals. Resolve Q31 before conversation-continuity migration; run S55's cross-board half.

**Design:** approve source/destination chips, a proposal for a board offstage and the switch-board/return journey. A proposal never changes owner when the stage changes.

**New unknowns:** conversation/context migration; cross-target stale/source-revision semantics.

**Demo:** read a Moonlander layer into a Glove80 proposal, then send a selected macro to a MacBook config. Switch boards during mapping and while a question is open. Change the destination head by CLI before Apply and observe the stale refusal.

**Done when:** source hashes/revisions are unchanged; destinations are explicit in UI/CLI/artifacts; unsupported content is named; old conversations reopen correctly; new focus does not retarget old work; the installed binary and design gate prove both transfer directions.

**Left out:** several targets in one plan and independent hardware control of duplicate-model keyboards (Q35/S57).

## Rung 30: One request prepares changes for several keyboards

Status: not built; depends on rung 29 and Q34's partial-result policy.

Previously, one destination is handled at a time. Now a request expands to exact targets, shows each preview and lets BK approve a ready subset with clear individual outcomes.

**Promise:** "I can send this macro to my keyboards and see which are done, which need a key, and which are offline."

**Build:** immutable target groups, per-target plans/receipts, full preflight and failed-subset retry from [30](30-agent-keyboard-context.md). Reuse global sync serialization, not parallel flash machinery.

**Design:** approve the target/result matrix, ready-subset confirmation and final partial-success result. Successful working can fold; offline, pending or failed targets remain visible.

**New unknowns:** partial-failure retry semantics; explicit subset approval across several heads.

**Demo:** prepare the same macro on a Moonlander, Glove80 and MacBook fixture, leave one offline and force a failure on another, approve only the displayed subset, then retry failures. Register another fixture board after preview and confirm it is not silently added.

**Done when:** each target validates against its own head, successful effects occur once, retry does not repeat them, hardware work follows existing serialization, and the final result never says every keyboard is updated when one is not. UI/CLI and the design gate agree on every target outcome.

**Left out:** atomic hardware rollback, silent target expansion and unapproved first flashes. Independent identical-model device support waits for S57 and a separately specified migration rung.

## After the car (not planned yet)

- ~~Conditional layers (tri-layer) in the editor~~: built, D-385 to D-389.
- The features [16](16-key-editor.md#what-keyloom-doesnt-take-and-why) defers (D-105).
- Pulling a layout from Oryx's GraphQL endpoint (D-041, S4).
- Key-frequency statistics (Q5).
- Other model providers for other users (Q3).
