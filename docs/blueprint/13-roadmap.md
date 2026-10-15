# 13: Roadmap

## Build philosophy

- **Skateboard → scooter → bicycle → motorbike → car** (vault: `Skateboard MVP`). The roadmap is a ladder of usable releases, not a list of components.
- **Each rung is usable.** It's a working, released product that lets BK do something new from start to finish, sized to one working session (vault: `Shippable Increment Per Session`).
- **Every rung ships through the real release channel:** release-please, then a GitHub release with compiled binaries, then `install.sh` (D-034).
- **At most two new unknowns per rung.** A rung that needs a third is split.
- **Ceremony is named and pulled into the nearest useful turn.** That covers the skeleton, CI, dependency rules and the release chain. There is no foundation turn: rung 1 carries the ceremony and is still usable.
- **Stop after any rung and there's a working product.**
- **Later rungs take letters.** A rung added later gets a letter (3b), so cited numbers keep their meaning.
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

**Previously:** the editor refuses most single-key changes with validator text. **Now:** any key can be changed, and every problem is a sentence with a way forward.

**Promise:** "I click F16, make it F17, and keyloom asks whether to drop F16 or put it somewhere first."

**Build:** the drop-function prompt and "place" mode ([16](16-key-editor.md#replacing-a-key-whose-function-exists-nowhere-else-asks-in-plain-words), D-092). A people sentence for every validator rule (D-101). 1-based key numbers everywhere a person reads them.

**New unknowns:** none.

**Demo:** change F16 to F17 on BK's Moonlander layout, choose Drop F16, apply, undo.

**Done when:** on the installed binary, every key on BK's Moonlander and Glove80 base layers can be changed to an unused key through the editor alone, and no screen shows a layer ID or a 0-based position.

**Left out:** the new key panel (rung 11).

## Rung 10: Scooter: keyloom's chat runs on my Codex subscription or OpenRouter key

**Previously:** the agent needs Anthropic API credits, which ran out. **Now:** BK picks a provider: his Codex subscription, an OpenRouter key, or an Anthropic key.

**Promise:** "I signed in with Codex, asked keyloom about Option–Option, and got the same validated proposals."

**Build:** [19](19-model-providers.md): the provider adapters behind `AgentModel`, provider settings, the evals per provider.

**New unknowns:** whether Codex's agent loop can be limited to keyloom's tools; whether the evals pass on the other providers.

**Demo:** run the four evals in `evals/scenarios` on each configured provider, then ask the Option–Option question in the web app on Codex.

**Done when:** the evals pass on at least one non-Anthropic provider on the installed binary, and the chat works end to end on it.

**Left out:** providers other than the three.

## Rung 11: Scooter: the key panel

**Previously:** a binding editor under the board, picked by kind. **Now:** the Oryx-style key panel beside a board that fills the stage.

**Promise:** "I click A, click held, click Ctrl, and it's a home-row mod, while I can still see the key."

**Build:** the key panel with tap and hold slots, the picker with categories and Any, typed keys filling the tap slot ([16](16-key-editor.md#the-key-panel), D-086, D-087). The new shell: board stage, side panel, chat drawer, header with layout menu, toolbar, toasts ([18](18-visual-design.md#the-board-stays-in-view-while-a-key-is-edited), D-098, D-099). The visual tokens and keycap anatomy for the kinds that exist ([18](18-visual-design.md#visual-system), D-100).

**New unknowns:** scaling the board to the stage for three geometries; the chat drawer's chip selection.

**Demo:** make A a mod-tap, change a layer key, use Any for `LCTL_T(KC_A)`, all on the Moonlander and Glove80.

**Done when:** a mod-tap takes 4 clicks from an empty key and 3 from A, the board never moves while editing, and the screenshot gate passes.

**Left out:** double-tap slots and macros (rung 14).

## Rung 12: Bicycle: flash my Glove80 and Corne without touching them

**Previously:** ZMK flashes need a key combo on each half. **Now:** after one more manual flash, keyloom restarts each half into its bootloader itself.

**Promise:** "I click Flash and the Glove80 updates while my hands stay in my lap."

**Build:** the `keyloom-zmk` module, the host trigger, markers and verification, the `handsFree` board block ([17](17-keyboard-sync.md#hands-free-flash-on-zmk-the-keyloom-zmk-module), D-095).

**New unknowns:** S12 (module and relay on the Glove80); S13 (the Corne).

**Demo:** flash the Glove80 by key combo once, then flash a change with no keypress, with the right half on its cable. Then the same on the Corne.

**Done when:** two hands-free flashes in a row are verified on both ZMK boards, and a failed trigger falls back to the manual instruction.

**Left out:** auto-sync (rung 13).

## Rung 13: Bicycle: Apply puts it on the keyboard

**Previously:** Apply, then a separate Build and flash dialog. **Now:** Apply ends on the keyboard, with the sync state in the header.

**Promise:** "I click a key, pick what it should be, and a minute later I'm typing with it, without another click."

**Build:** sync states, auto-sync per board, batching, last good image, Pause ([17](17-keyboard-sync.md#apply-sync-and-the-keyboards-state), D-094).

**New unknowns:** how often a burst of edits collides with a running flash; how long the wait feels in use (it decides rung 17).

**Demo:** three edits in a row on the Moonlander, one build, verified; the same on the Glove80; unplug mid-sync and recover.

**Done when:** a week of BK's real use with auto-sync on, and his answer to "does the wait bother you?" recorded in the ledger.

**Left out:** live writes (rung 17).

## Rung 14: Motorbike: tap dances and macros on the key

**Previously:** tap dance is impossible and macros need the CLI. **Now:** double-tap, tap-then-hold and macros are built on the key.

**Promise:** "I made Esc double-tap to Caps Lock, and a copy-switch-paste macro, without leaving the key."

**Build:** the `tapDance` kind, both generators and the importer for Oryx tap dances ([16](16-key-editor.md#tap-dance-is-a-key-with-a-double-tap-slot), D-093). The Macro tab ([16](16-key-editor.md#macros-are-made-in-the-picker-and-each-pick-adds-a-step), D-088). The library list.

**New unknowns:** S16 (tap dance equivalence and import).

**Demo:** the Esc/Caps tap dance and a three-key macro on both boards, checked in the emulators, synced, and typed.

**Done when:** BK's imported TD0, TD1 and DF0 show as editable tap dances, and a three-key macro takes 6 clicks.

**Left out:** combos (rung 15).

## Rung 15: Motorbike: combos, layers and moving keys

**Previously:** combos are read-only and layers can only be switched. **Now:** combos are made from a selection, layers are managed in their tabs, and keys swap, drag, copy and paste.

**Promise:** "I selected J and K, made them Esc, renamed Layer 2 to Nav, and swapped two keys across layers."

**Build:** [16](16-key-editor.md#combos-are-made-from-a-selection) (D-089), [layers](16-key-editor.md#layers-are-managed-in-their-tabs) (D-090), [moving keys](16-key-editor.md#moving-and-copying-keys) (D-091), short layer labels on caps ([18](18-visual-design.md#legends-stay-readable-at-every-size)).

**New unknowns:** combo lines on rotated thumb clusters; drag on touch screens.

**Demo:** the J+K combo, a renamed and reordered layer, a cross-layer swap, all synced.

**Done when:** a two-key combo takes 5 clicks, no Glove80 legend renders below 11 px, and deleting a referenced layer is refused with the keys listed.

**Left out:** conditional layers.

## Rung 16: Motorbike: history, states, themes and phones

**Previously:** History lists chats, the theme follows the OS, and a phone scrolls the board sideways. **Now:** the rest of [18](18-visual-design.md).

**Promise:** "I scrolled back through my revisions and flashed last Tuesday's, in dark mode, from my phone."

**Build:** revision history (D-102), the import screen per board, tips, visible disabled reasons, the theme toggle, glyph sets, the phone layout ([18](18-visual-design.md#phones-and-narrow-windows)), shortcuts.

**New unknowns:** none beyond layout work.

**Demo:** undo three revisions back, flash one, then import a Glove80 export from the empty state, then edit a key on a 390 px screen.

**Done when:** the screenshot gate passes for every screen at both widths and themes.

**Left out:** settings and lighting (rung 18).

## Rung 17: Car: live writes (only if rung 13 says the wait hurts)

**Previously:** every change flashes. **Now:** a binding-only change goes live in under a second, and everything else still syncs by flash.

**Promise:** "I swapped two keys and they were swapped before I lifted my hand."

**Build:** [17](17-keyboard-sync.md#live-writes-are-built-only-if-auto-sync-is-too-slow-in-use) (D-096, D-097): the Moonlander set-keycode command and the ZMK Studio client, live writes recorded as revisions, reset after flash, drift detection.

**New unknowns:** S15 (Moonlander dynamic keymap); S14 (Studio on the Glove80).

**Demo:** a live swap on each board, then a hold-tap change that falls back to a flash, then a flash that resets the live state.

**Done when:** live writes are verified by reading the key back from the board, and a reboot after a flash shows the flashed keymap.

**Left out:** live combos and macros on ZMK, which Studio can't do.

## Rung 18: Car: settings and lighting

**Previously:** firmware options are only in the timing tuner and passthrough. **Now:** a settings page and per-key and per-layer colours.

**Promise:** "I set Caps Word and the combo term on one page that explained them, and coloured my Nav layer."

**Build:** [16](16-key-editor.md#settings-and-lighting) (D-103, D-104).

**New unknowns:** which settings Oryx's generated source already sets that keyloom must not override; RGB generation in ZSA's fork.

**Demo:** change three settings and two layer colours on the Moonlander, synced.

**Done when:** every option on the page round-trips through import and generation unchanged when untouched.

**Left out:** everything in [16](16-key-editor.md#what-keyloom-doesnt-take-and-why).

## Rung 19: Car: copy from my other keyboard

**Previously:** the agent sees only the layout it is working on, so "make this like my Moonlander" gets a request for an Oryx link. **Now:** it sees every layout, knows what each board can do, and copies colours, behaviours and combos across boards that differ in size and shape.

**Promise:** "I said copy my home row mods from my Moonlander, and it looked at the Moonlander itself and put them on the right keys of the Glove80."

**Build:** [20](20-cross-board.md) (D-220 to D-229): `list_layouts`, `get_layout` of another layout, `map_keys`, board capabilities, the layer and key correspondence.

**New unknowns:** whether MoErgo's firmware can show a colour per key (S21: no); whether the live model uses the tools instead of asking.

**Demo:** in the CLI chat on the Glove80, ask for the Moonlander's key lights (a plain explanation with the reason), then for its home row mods (a proposal), and show the web chat doing the first.

**Done when:** the live evals pass on OpenRouter, the mapping tests hold across the Moonlander, Glove80 and Corne, and the demo transcripts show the agent reading the Moonlander layout itself.

**Left out:** Glove80 lighting (Q24); carrying a typing profile inferred from habits rather than a named thing.

## Rung 20: Car: my MacBook keyboard behaves like my other keyboards

**Previously:** keyloom configures QMK and ZMK boards. **Now:** the MacBook's built-in keyboard is a keyloom board through kanata, and changes apply instantly.

**Promise:** "My MacBook keyboard has my home-row mods and layers, and when I change a key it just changes."

**Build:** [21](21-macbook-keyboard.md) (D-230 to D-235): the software-remapper firmware family, the `apple/macbook-ansi` board, kanata key names and generator, apply by reload with verify, the setup doctor and safety, import of BK's Karabiner rules, and mapping his Moonlander or Glove80 layout onto it.

**New unknowns:** S30 and S31 (kanata on the built-in keyboard, next to Karabiner).

**Demo:** run setup with BK (one sudo command), prove the exit chord, import his Karabiner rules, apply a home-row-mod timing change and type with it within a second, then map his Moonlander layout onto the MacBook and apply it.

**Done when:** BK types on the MacBook with keyloom's layout, an Apply changes it in under a second, "Disable remapping" and the exit chord both work, and his external boards are untouched.

**Left out:** the Karabiner-Elements target (D-231); ISO MacBooks.

## Rung 21: Car: connect a new keyboard and put my config on it

**Previously:** a board needs a contributed definition. **Now:** keyloom recognises a QMK or ZMK keyboard on USB, builds its definition, and puts BK's config on it.

**Promise:** "I plugged in a keyboard keyloom had never seen, confirmed which board it was, and put my Glove80 setup on it."

**Build:** [22](22-new-keyboard.md) (D-236, D-237): USB detection with candidates, definition from the firmware tree plus confirmed heuristics, generalised keyboard detection, new QMK flash recipes (atmel-dfu, stm32-dfu), and "put my config on this" through the cross-board mapping.

**New unknowns:** S42 (detection on BK's boards); S40 (finger heuristics).

**Demo:** with BK's Corne treated as unknown (its definition hidden), detect it, confirm it, put the Glove80 layout on it, first flash, then a hands-free change.

**Done when:** the Corne goes from "unknown keyboard" to running BK's mapped config with only the confirmations the chapter lists.

**Left out:** reading the keymap off boards without Vial, VIA or Studio; hands-free flashing for non-ZSA QMK boards (S41).

## After the car (not planned yet)

- Conditional layers (tri-layer) in the editor.
- The features [16](16-key-editor.md#what-keyloom-doesnt-take-and-why) defers (D-105).
- Pulling a layout from Oryx's GraphQL endpoint (D-041, S4).
- Key-frequency statistics (Q5).
- Other model providers for other users (Q3).
