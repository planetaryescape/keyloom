# 00: Overview

## What keyloom is

keyloom is an open-source configurator for programmable keyboards that runs on your own machine. It handles both QMK and ZMK boards (D-001), with an agent you talk to about how you type. You pick your keyboard and keyloom knows its firmware (D-002). It imports the layout you already have. You describe a frustration ("I can't press Option–Option because Option lives on S") or a goal ("I want one key for Command–Shift"), and the agent proposes a concrete change. keyloom shows the change on the keyboard picture with the reason and trade-off beside it. You accept it, and keyloom builds firmware and flashes the board.

It has two surfaces over one core (D-028, D-030):

- **A local web app.** A bun server on `localhost` serves a visual keyboard editor with a chat panel beside it. Both edit the same layout (D-013).
- **A CLI.** Every operation the web app can do, the CLI can do. Coding agents, tests and scripts use it.

The keyboard's firmware is what you type on. keyloom's local database holds the layouts, their revision history, the conversations and the remembered decisions (D-032). There's no hosted backend and no account.

## Who it's for

The first user is BK. He owns a ZSA Moonlander (QMK), a MoErgo Glove80 (ZMK) and a Corne, and started on a Microsoft Sculpt. He has kept a layout with known annoyances because reconfiguring it is tedious (D-010).

keyloom is open source and meant to interest other keyboard owners (D-007). BK supports his own boards. Anyone with another board adds it through the board format in [04](04-boards-and-contributions.md) (D-008, D-009).

## The loop

1. **Pick the board.** keyloom loads its definition, which includes the firmware (D-002).
2. **Import the current layout** from the source the board uses today (D-016, [05](05-firmware-qmk.md), [06](06-firmware-zmk.md)).
3. **Say what's wrong or what you want**, in chat, optionally with keys selected on the picture (D-010, D-012).
4. **The agent asks what it needs**, such as which functions you barely use and which keys must not move (D-021). Then it proposes one to three alternatives as change sets (D-014, D-020).
5. **Preview.** The changed and displaced keys are highlighted, with each alternative's explanation and trade-off (D-015).
6. **Accept.** The change set is applied as one revision, and the decision and its reason are recorded (D-022, D-023).
7. **Build and flash** ([05](05-firmware-qmk.md), [06](06-firmware-zmk.md)).
8. **Use it and report back.** "That fixed the accidental shortcuts, but now holding Command feels slow" starts the next turn, and the outcome is recorded against the decision (D-018).

## BK's promise

BK, 2026-10-15, after v0.19: "I can now configure all my keyboards from one software. You know how nice Oryx is to use, I took that UX and now configuring any of my boards feels like oryx. And then you know how you don't have to reboot of anything when using vial? I added that so now for any of the keyboards I just change the keys and that's it, not bootloader nonsense. When I don't like something I don't have to break my brain trying to think how to do it or whee to put the key and all that. I just tell it what I want and because it can see my keyboard it will figure it out and make some suggestions to me. If I get a new keyboard I just connect it and say put my config on this. Doesn't matter what keyboard it is as long as it uses ZMK or QMK."

Every rung from 9 on is measured against it: the Oryx feel is [16](16-key-editor.md) and [18](18-visual-design.md), no bootloader is [17](17-keyboard-sync.md) and [21](21-macbook-keyboard.md), "it can see my keyboard" is the agent and [20](20-cross-board.md), and a new keyboard is [22](22-new-keyboard.md). His MacBook keyboard is in scope too (D-230).

## Principles

1. **Start from the frustration, not the solution.** BK knows what annoys him before he knows the fix. The agent's job is to diagnose and recommend, not only to execute (D-010).
2. **The agent proposes; the app decides what's valid.** The agent emits structured change sets. keyloom validates, previews and applies them. The model never writes `keymap.c` or `.keymap` text (D-014). A wrong suggestion should be impossible to flash without someone seeing it.
3. **One layout, two ways in.** Chat and the visual editor change the same document, and each sees the other's changes immediately (D-013). Pointing at keys is often more precise than describing them (D-012).
4. **Every change explains itself and undoes as a unit.** A rearrangement that moves four keys is one revision with one reason and one undo (D-015).
5. **Nothing gets lost silently.** A change that displaces a function must re-home it or say plainly that it's being dropped (D-020). The validator checks this, not the model.
6. **Remember why.** The reason a key is where it is outlives BK's memory of it. keyloom keeps it and brings it up when the key is about to change (D-022).
7. **Recommendations are hypotheses.** Whether a position feels right is something only use can show. keyloom says so, and weighs "you used it for a month and liked it" above "we thought it would be comfortable" (D-018, D-023).
8. **Firmware differences stay visible.** QMK and ZMK are not the same. keyloom shows where a behaviour is specific to one, and never pretends a translation is exact (D-024).
9. **Contributions are data, not code.** A new board is a definition that keyloom can validate, plus an optional skill. Adding one doesn't mean writing another configurator (D-009).

## Scope

v1 covers:

- **Boards:** the ZSA Moonlander on QMK and the MoErgo Glove80 on ZMK (D-027).
- **Layout vocabulary** (D-006): layers; plain keys; modifiers; mod-tap and hold-tap (home row mods, such as F and J as Command on hold); layer-tap and momentary layers; macros; combos; and the tap-hold timing settings each firmware offers (D-017).
- **Operations:** import the current layout, view it, edit it by hand, edit it by chat, edit a selection in bulk (D-011), propose alternatives that make room (D-020), undo, build, flash, and remember decisions.
- **Platforms:** macOS first, since BK's machine is a Mac. Linux is expected to work, because nothing in the design is Mac-specific beyond flashing tools, but it isn't tested in v1.

### What each firmware gives keyloom

| Capability | QMK (Moonlander) | ZMK (Glove80) | keyloom's approach | Doc |
|---|---|---|---|---|
| Import current layout | Oryx's source zip is C (`keymap.c`, `config.h`, `rules.mk`); no JSON | MoErgo Layout Editor exports a `.keymap`; its JSON is unstable | Parse the exported source into the IR with tree-sitter (D-037, D-041) | [05](05-firmware-qmk.md), [06](06-firmware-zmk.md) |
| Home row mods | Mod-tap plus tap-hold options | Hold-tap behaviour with flavors | One IR concept, firmware-specific tuning fields | [02](02-layout-model.md) |
| Macros | Yes | Yes | IR macro, rendered per firmware | [02](02-layout-model.md) |
| Runtime change without reflash | VIA and Vial, rev A only, not supported by ZSA | ZMK Studio, bindings only, probably not enabled in stock MoErgo builds | v1 always reflashes; runtime update is deferred (D-039) | [06](06-firmware-zmk.md) |

## Non-goals

- **Supporting every keyboard.** BK supports his boards; others contribute theirs (D-008).
- **A plugin marketplace.** A folder per board in the repo is the extension system (D-009).
- **A business.** No accounts, billing or hosting (D-007).
- **A hosted service.** keyloom runs locally (D-028).
- **Always-on keystroke logging.** keyloom records key events only in a typing session BK starts (D-280, which replaced D-035 for those sessions; built in v0.27.0 and v0.30.0, [24](24-typing-lab.md)). Nothing records in the background.
- **Inferring a profile from habits and carrying it between keyboards.** BK can say "copy this thing from my other keyboard" and the agent does it (D-220, built in v0.20.0, [20](20-cross-board.md)). "Adapt my Moonlander habits to the Glove80" without naming a thing is still not built (Q4).
- **Exact translation between QMK and ZMK.** Where a behaviour has no equivalent, keyloom says so (D-024).
- **Runtime keymap updates (ZMK Studio, VIA/Vial).** v1 builds and flashes firmware (D-039). Replaced on 2026-10-15 by D-096: Apply ends on the keyboard through hands-free flashing, and live writes come only if the wait proves too long ([17](17-keyboard-sync.md)).

## Glossary

| Term | Meaning |
|---|---|
| Board definition | The data describing one keyboard: physical keys, firmware target, build and flash recipe ([04](04-boards-and-contributions.md)) |
| Board skill | Optional agent guidance for a board: quirks and conventions, in Markdown |
| Layout | keyloom's firmware-neutral description of what every key does on every layer ([02](02-layout-model.md)) |
| Revision | An immutable snapshot of a layout. Every applied change set creates one |
| Change set | A list of structured operations the agent or editor proposes against one revision |
| Binding | What one key position does on one layer: a keycode, a hold-tap, a layer action, a macro reference and so on |
| Home row mods (HRM) | Modifiers on the home-row letters, sent when the key is held |
| Displaced function | A binding a change set removes from its position. It must be re-homed or explicitly dropped |
| Decision | A remembered choice with its goal, reason, scope and later outcome ([08](08-decision-memory.md)) |
