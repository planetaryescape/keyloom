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

## After the car (not planned yet)

- Runtime updates through ZMK Studio for binding-only changes (D-039).
- Pulling a layout from Oryx's GraphQL endpoint (D-041, S4).
- A typing profile carried between boards (Q4).
- Key-frequency statistics (Q5).
- Other model providers for other users (Q3).
