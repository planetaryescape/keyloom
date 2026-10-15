# 14: Decision log

This log holds every decision from the planning conversation (2026-09-28 and 2026-10-11) and the blueprint session (2026-10-15), **including the options we rejected and the reversals**. It exists so a later agent understands how the design got here and doesn't argue its way back into an option already rejected. BK is the decision-maker:

- **BK:** his own call.
- **BK proposed; agreed:** his idea, refined in conversation.
- **Claude proposed; unchallenged:** raised by the assistant in the chat, built on by BK and never objected to. These are the design's working assumptions, and the easiest to revisit.
- **Claude, in the blueprint:** made while writing this blueprint, where the chat never reached the question. Each one has a product question in [15](15-open-questions.md), or is grounded in a research file.

Change a decision only by adding a new entry that replaces the old one.

## The arc, briefly

1. BK pitched the idea on 2026-09-28. He's a keyboard enthusiast who owns several ergonomic boards. He wants "one configurator to rule them all" for QMK and ZMK, with a chat agent he can describe his habits and layout to, which "is able to just go rip and build the thing for me" and suggest improvements.
2. The assistant researched the field, found two nearby projects (CustomKeymap and keymap-ai), and raised two doubts: whether the idea was a business, and the cost of promising "all keyboards".
3. **BK reset both.** It's an open-source project, not a business. He supports only his own keyboards, and anyone else adds theirs through an extension system, "maybe as a skill".
4. BK named the real pain. He tolerates an annoying layout because diagnosing and reconfiguring is tedious. He wants to describe a frustration and get a recommendation, and to do something once and say "do the same thing on these other areas".
5. Two concrete problems followed. Option–Option is impossible with Option as a home row mod on S. A Command–Shift key has nowhere to go when every key is used. The assistant worked through the remedies, rejected double-tap S, and shaped "make room" proposals with alternatives and trade-offs.
6. BK added memory: keyloom should remember why something was placed, even after he's forgotten.
7. On 2026-10-11 BK asked whether this could be built. The assistant said yes and named the hard parts: accurate import, QMK/ZMK translation, validating rearrangements, and reliable build and flash. Solving BK's two problems on his own boards would prove it.
8. In the blueprint session (2026-10-15), BK chose the name and location, the two target boards, and a local web app plus CLI. Research found that the Moonlander has two revisions and only ZSA's fork builds the newer one. That set the QMK pipeline.
9. Mid-session, BK pointed to `nickcoutsos/keymap-editor` as "a pretty good editor" to learn from (D-044).

## Decisions

### D-001: One configurator for both QMK and ZMK. (BK)
- **Principle (BK):** "in the new agentic era, there's an opportunity to make one configurator to rule them all. So just one configurator that supports both QMK and ZMK"

### D-002: The firmware follows from the chosen keyboard. (BK)
- BK: it "is able to detect which it is based on the keyboard we're talking about … So I'll just select what keyboard I'm talking about."
- **How:** the board definition names its firmware ([04](04-boards-and-contributions.md)).

### D-003: Keep a visual key-by-key editor alongside the chat. (BK)
- BK: "instead of just having, like, a configurator that shows you the keys and you do the thing one by one—you can do this, of course—but it also has, like, a bit of a chat interface".

### D-004: A chat agent builds the layout BK describes. (BK)
- BK: "after I explain all of it, the agent is able to just go rip and build the thing for me."

### D-005: The agent suggests layout changes from BK's habits. (BK)
- BK: "I can even ask for suggestions … this is the key that I use most because I use this program and whatever, right? And it's able to, like, figure it out and suggest some layout things for me."

### D-006: The layout vocabulary covers BK's real layout. (BK)
- BK's examples: QWERTY on the base layer; a number layer with "the numbers are on the home row"; "the symbols are on the number layer, but on the row just above the home row"; "I've got home row modes on layer number one on the home row, and I'm using, you know, J and F, you know, for command, so when I hold, it's command" (the transcript's "modes" is "mods").
- These are v1's minimum vocabulary and eval scenarios ([11](11-observability-and-evals.md)).

### D-007: Open source, not a business. (BK; replaces the assistant's business framing)
- **Earlier framing:** the assistant said the business case "still needs evidence".
- **BK:** "I don't plan for this to be a business, just an open-source project that hopefully other people would be interested in."
- **Consequence:** no accounts, billing or hosting (D-028).

### D-008: BK supports his own boards; others add theirs. (BK; replaces "all keyboards")
- **Earlier framing:** the assistant warned that "all keyboards" was "a much larger commitment".
- **BK:** "I also don't plan to create the support for all keyboards myself. I can just focus on my keyboards, and anyone else who wants another keyboard can come in and add the support themselves."

### D-009: A board is a definition plus an optional skill, with no marketplace. (BK proposed; agreed)
- **BK:** "if we build in some sort of, I don't know, plugin system or some sort of extension system that allows people to bring in their keyboards, maybe as a skill or something like that."
- **Refinement:** the assistant split board facts (physical keys, firmware target, build and flash) from agent guidance (quirks and conventions). The definition is something the app can validate; the skill helps the agent decide well.
- **Option rejected:** "an elaborate plugin marketplace". A folder per board in the repo is enough.

### D-010: Start from the frustration, not the solution. (BK)
- **Principle (BK):** "It would be great if I can just go somewhere, explain what my challenge is, and then get a recommendation of what to do. Not for me to have to figure it out and then configure it myself."
- **Why it matters:** BK has kept known annoyances "because the whole process of reconfiguring is a little— it's tedious."

### D-011: Bulk and pattern edits. (BK)
- BK: "It would be nice if we can just explain, and it does the thing on multiple keys, or maybe I do it once and say, okay, do the same thing on these other areas".
- **How:** expanded into plain per-slot ops, with no pattern op type ([03](03-agent.md#do-that-here-too-is-expanded-into-plain-ops)).

### D-012: A selection on the keyboard is context for the chat. (Claude proposed; unchallenged)
- "Selecting five keys and saying 'give these the same hold behaviour' could be much nicer than describing five positions in words."

### D-013: Chat and the visual editor edit one layout. (Claude proposed; unchallenged)
- Proposed on 2026-09-28 and restated on 2026-10-11: "Both chat and manual editing would operate on the same layout."

### D-014: The agent proposes structured change sets; the app validates, previews and applies them. (Claude proposed; unchallenged)
- "I'd have the agent propose structured changes that the app can validate, preview, and undo."
- **Option rejected (blueprint):** letting the model edit `keymap.c` or `.keymap` text. Nothing could check it before a flash.

### D-015: Every change carries an explanation and undoes as a unit. (Claude proposed; unchallenged)
- "Every change should have a visible explanation and an undo." Also: "apply the entire rearrangement together … and let you undo the change as a whole."

### D-016: Importing the existing layout accurately comes first. (Claude proposed; unchallenged)
- "That makes importing and understanding your existing layout central to the experience." It's the first hard part named on 2026-10-11, "including custom behaviours".

### D-017: Tap-hold feel is a first-class concern. (Claude proposed; unchallenged)
- "The difficult part is getting the feel right … deciding whether a fast sequence was typing or an intentional shortcut is subtler."

### D-018: Recommendations are hypotheses tested through use. (Claude proposed; unchallenged)
- "Recommendations would be hypotheses you test through use." And: "whether a position feels comfortable needs your feedback."

### D-019: Option–Option remedies; double-tap S rejected.
- **BK's problem:** "some softwares have a shortcut of Option-Option. I can't do Option-Option because my Option is holding down the S key."
- **Remedies:** (a) plain Option on another layer; (b) a macro on a key or combo; (c) change the app's shortcut.
- **Option rejected:** a double tap of S, "because you still need to type words like 'class.'" The validator warns on it ([07](07-change-validation.md#warnings)).

### D-020: "Make room": alternatives, displacement and reachability. (BK's problem; shape Claude proposed; unchallenged)
- **BK:** "I press Command Shift a lot … where the hell do I put it on this keyboard, right? … often all of my keys are used, and sometimes I have to replace something or move something else so that I make way for this more important thing".
- **Shape:** two or three concrete alternatives, affected keys highlighted, trade-offs explained, applied together, displaced functions kept reachable, one undo.

### D-021: BK's priorities are captured explicitly. (Claude proposed; unchallenged)
- "Your keymap alone won't tell the agent which assignments you value." Examples: "I barely use that", "keep Backspace where it is", "I'm willing to relearn these two keys".

### D-022: Remember decisions and their reasons. (BK)
- **BK:** "over time, it can remember all of these conversations that we have and all of these preferences. So if later I want to come back and replace something that I previously said was important, it will know that this thing is important because of this reason, even if I have forgotten that reason."

### D-023: The shape of a remembered decision. (Claude proposed; unchallenged)
- **Fields:** goal or frustration; what was chosen and why; scope (keyboard, apps, habits); whether it was tried and helped.
- "'we thought this would be comfortable' and 'you used this for a month and liked it' should carry different weight."
- Memory can be inspected and corrected, links back to the conversation, and "an old decision should prompt a helpful reminder rather than prevent a new one."

### D-024: Firmware differences stay visible; there's no promise of exact translation. (Claude proposed; unchallenged)
- "Firmware-specific features would stay visible where necessary; we shouldn't promise that every behaviour translates perfectly between firmware families."
- **How:** `native` bindings and `Passthrough` blocks ([02](02-layout-model.md)).

### D-025: The proof is BK's two problems solved on his own boards. (Claude proposed; unchallenged)
- "The convincing proof would be solving your two actual problems: making Option–Option accessible and finding a comfortable home for Command–Shift, with the resulting layouts working on your keyboards." Earlier: "get it working on two keyboards you own with different firmware."

### D-026: The name is keyloom, under planetaryescape. (BK, 2026-10-15)
- The repo is `planetaryescape/keyloom` at `~/code/planetaryescape/keyloom`. planetaryescape is where BK's published products go, and this one is meant for others.
- **Options rejected:** the name "layerwise"; placement under `bhekanik/`.

### D-027: The target boards are the Moonlander (QMK) and the Glove80 (ZMK). (BK, 2026-10-15)
- The transcript's "Clave AT" is the Glove80. BK confirmed it on 2026-10-15.
- **Options rejected:** a Corne on ZMK or QMK as the second board. The Corne waits until after the car (Q10).
- The Microsoft Sculpt isn't a target. BK named it as where his journey started. He has never owned a Dygma.

### D-028: A local web app plus a CLI, with no hosted backend. (BK, 2026-10-15)
- A bun server on localhost serves the editor and the agent, and a CLI drives the same core.
- **Options rejected:** (a) a Tauri desktop app, which adds native packaging on every rung for USB access that Zapp and UF2 drives already give; (b) a hosted web app like Oryx, which needs accounts, hosting and a processor contract for other people's layouts and chats.

### D-029: TypeScript, strict, ESM, on bun. (BK's standing rule for new projects)

### D-030: The CLI is the canonical surface. (Taken from spotuify and ms-todo.)
- Anything the web app does, the CLI does. Agents verify their work through it. D-028's "the CLI drives the same core" is the decision's root.

### D-031: The model is Claude, through `@anthropic-ai/sdk`, on the user's own key. (Claude, in the blueprint)
- `claude-opus-5-5`, adaptive thinking, effort `medium`, Tool Runner with strict zod tools.
- **Why:** BK's tools already use Claude, and the SDK's zod tool helpers match keyloom's zod schemas.
- **Revisit:** Q3 (other providers for other users).
- **Replaced in part by D-106** (2026-10-15): the provider is now Anthropic, OpenRouter or Codex. Claude through OpenRouter keeps this entry's model and SDK.

### D-032: Local SQLite, append-only revisions. (Claude, in the blueprint)
- **Option rejected:** layouts as files in a git repo. Diffable, but it adds a second history beside revisions, and conversations and decisions don't fit it. `keyloom layout export` covers sharing. Revisit: Q7.

### D-033: keyloom has its own firmware-neutral layout model. (Claude, in the blueprint)
- **Options rejected:** (a) storing QMK C or ZMK devicetree as the truth, which the agent can't edit safely and which differs per firmware; (b) QMK's `keymap.json` as the model, which can't express combos or tap dance and isn't ZMK.

### D-034: Releases are compiled binaries on GitHub, through release-please and `install.sh`. (Claude, in the blueprint)
- `bun build --compile` embeds the web app (oven-sh/bun `a9c57bd` `docs/bundler/executables.mdx:557-640`).
- **Option rejected:** an npm package. The `keyloom` name is taken there by an unrelated password generator (v1.0.4, checked 2026-10-15). Q2.

### D-035: No keystroke logging in v1. (Claude, in the blueprint)
- Habits come from what BK says (D-005). The chat never discussed recording typing. Deferred, not rejected (Q5).

### D-036: The Glove80 builds on MoErgo's fork at a pinned tag, through its template's Docker route. (Claude, in the blueprint)
- **Options rejected:**
  - MoErgo's cloud Layout Editor builds: needs an account, has unpublished limits, and isn't local.
  - GitHub Actions in a config repo: a push per change and minutes per round trip.
  - Upstream ZMK: has the board, but MoErgo supports only its fork.
  - `main` instead of a tag: unpinned.
- **Source:** [../research/zmk-and-glove80.md](../research/zmk-and-glove80.md).

### D-037: The Glove80 import reads the Layout Editor's `.keymap` export. (Claude, in the blueprint)
- **Option rejected:** the Layout Editor's JSON export. MoErgo says "the JSON format may change" and import isn't guaranteed.

### D-038: The Glove80 flashes by copying the combined UF2 to each half's boot drive, right half first. (Claude, in the blueprint; taken from MoErgo's guide)

### D-039: Runtime updates (ZMK Studio, VIA, Vial) are deferred. v1 always reflashes. (Claude, in the blueprint)
- **Why:** Studio can't change hold-tap properties, macros or combos. It ignores later `.keymap` changes once it manages a keymap. Stock MoErgo builds probably lack it. VIA and Vial support only Moonlander rev A, and ZSA doesn't support them.
- **Revisit:** after the car. Instant binding swaps would make trying changes cheaper.
- **Replaced by D-096** (2026-10-15): live writes become an optimisation of Apply, built only if auto-sync proves too slow in use.

### D-040: The Moonlander builds from ZSA's QMK fork (`firmware25`), pinned. (Claude, in the blueprint)
- **Option rejected:** mainline QMK. It has only rev A, and the rev B PR closed unmerged on 2026-06-22. BK's board may be rev B (S1).
- **Cost:** no Speculative Hold, which `firmware25` lacks.
- **Source:** [../research/qmk-and-moonlander.md](../research/qmk-and-moonlander.md).

### D-041: The Moonlander import reads Oryx's source zip, parsed with tree-sitter C. (Claude, in the blueprint)
- **Options rejected:**
  - Oryx GraphQL: undocumented, introspection off, private layouts return 401. Deferred as a later convenience (S4).
  - `qmk c2json`: reads only the keymaps array, drops macro and tap-dance bodies, and needs Python.

### D-042: keyloom generates QMK C (`keymap.c`, `config.h`, `rules.mk`), not `keymap.json`. (Claude, in the blueprint)
- **Why:** JSON can't define combos or tap dance. Oryx's export is C. A JSON-plus-C hybrid splits one layout over two files.

### D-043: The Moonlander flashes through ZSA's Zapp CLI. (Claude, in the blueprint)
- **Options rejected:** Keymapp (a GUI); `wally-cli` (archived); `qmk flash` or `dfu-util` (rev B needs ZSA's bootloader IDs and offset, which Zapp handles).

### D-044: keymap-editor is the reference editor; take its interaction patterns and geometry math, not its architecture. (BK pointed to it; verdicts Claude, in the blueprint)
- **BK (2026-10-15):** "see what you can learn from https://github.com/nickcoutsos/keymap-editor it's a pretty good editor".
- **Finding:** the public source is a 2023 snapshot (`main` at `e7946792`, MIT). The deployed app BK has used is closed, and its author has stopped publishing source. The code reading and every verdict are in [../research/keymap-editor.md](../research/keymap-editor.md).
- **Adopted:**
  - rotated-key geometry math
  - the keyboard-first fuzzy picker
  - modifier toggles in the picker
  - keeping parameters when the kind changes
  - quick assign by typing
  - drag-select
  - layer duplicate and reorder
  - tree-sitter devicetree parsing
- **Adapted:** the keycode data, generated from ZMK's MIT `keys.h` and QMK's keycode files. keymap-editor's source for it, ZMK's `hid.js`, is CC-BY-NC-SA-4.0, so it's not used (corrected 2026-10-15; the research had called it MIT); editing on double-click, since a click selects for chat; its warnings, turned into validator rules ([09](09-web-editor.md), [07](07-change-validation.md)).
- **Skipped:** a GitHub App with a hosted backend; in-place reformatting of the user's file; builds left to GitHub Actions; geometry from a separate `info.json` (D-045); no undo.

### D-045: Board geometry is generated from the pinned firmware tree, never maintained by hand. (Claude, in the blueprint)
- **Why:** keymap-editor reads geometry from a parallel `info.json` and community metadata, and its issues show that drifting from the firmware and producing off-by-one layouts. QMK's `keyboard.json` and ZMK's `zmk,physical-layout` already define x, y, w, h and rotation in binding order.
- **How:** `keyloom boards geometry` writes `geometry.json`, and `boards check` fails on drift ([04](04-boards-and-contributions.md#geometryjson-is-generated-from-the-firmware-tree)). Display-only rotation for the Moonlander's thumb cluster is the one hand-written exception, and it never affects positions.

### D-046: The core stays in TypeScript; Rust was reconsidered and rejected. (BK, 2026-10-15)
- **BK asked:** "is it not better to write this software in rust? Ofcourse the UI can be a web app but I mean the brains"
- **What Rust would have given:** consistency with mxr, spotuify and ms-todo (CLI contract, release chain, Homebrew); native tree-sitter instead of WASM, removing S10; a natural static binary.
- **Why TypeScript stays:**
  - Anthropic has no official Rust SDK, so the agent loop (the product's core) would be hand-rolled: tools, streaming, input validation and refusal fallback.
  - The pure validator runs in the browser for instant preview (01). Rust would need a WASM build or a server round trip per edit.
  - One zod schema serves the CLI, the server, the browser and the agent's tools. Rust would need generated types across a language boundary.
- **Not a factor:** reusing ZSA's Zapp crates. Zapp is MIT plus the Commons Clause (`zsa/zapp@a1be758` `LICENSE.md`), so linking it would encumber MIT keyloom. keyloom calls the `zapp` binary in either language (D-043).

### D-047: The generated keycode table holds only interoperability facts from GPL QMK files. (Claude, in the blueprint; Q15 for BK)
- **What's taken:** `scripts/gen-keycodes.ts` reads QMK's `data/constants/keycodes/*.hjson` (no header, so the repo's GPL-2.0-or-later applies) and `tmk_core/protocol/report.h` (GPL header) at `qmk/qmk_firmware@7a1bbf3`. From them, `src/layout/keycodes.ts` keeps only keycode identifiers and aliases, HID usage numbers and short key labels. ZMK's names come from its MIT headers.
- **Why it's acceptable:** identifiers and usage numbers are the interface both firmwares and the USB HID spec define. keyloom has to use them to generate source those firmwares compile. No QMK code or prose is copied, and the GPL files are read at generation time, not shipped.
- **Option rejected:** ZMK's `docs/src/data/hid.js`, which is CC-BY-NC-SA-4.0 (D-044, corrected).
- **Revisit:** if BK wants a stricter line, write the labels by hand and take only identifiers and usage numbers from QMK.

### D-048: The ZMK importer doesn't follow `#include`, and a combo with no `layers` is on every layer. (Claude, building rung 5)
- **Changes 06's import step 1.** The blueprint had `#include`s of ZMK's `dt-bindings` headers resolved against the pinned checkout. The importer instead expands only the file's own object-like `#define`s (`#define HYPER LC(LS(LG(LALT)))`, `#define LOWER 1`) and reads key names from the keycode table, which D-044 already generates from the same `keys.h`. Following includes would make `keyloom import` depend on a firmware checkout that doesn't exist before the first build. A key name outside the table becomes a `native` binding, as it would anyway.
- **Corrects an assumption.** ZMK's own docs for older versions say a combo with no `layers` is on layer 0 only. `app/src/combo.c` at `moergo-sc/zmk` `ce69e85` and upstream `4dd95d7` treats an empty layer mask as active everywhere (`combo_active_on_layer`, line 151). `layers = <(-1)>` does not compile on this fork (`BIT(-1)` is not a load-time constant; seen in the first real build, 2026-10-15). So a combo on every layer is written with no `layers`, and `<(-1)>` is read as "all" but never written.
- **Revisit:** when the pin moves to a ZMK that supports `<(-1)>`.

### D-049: Build and flash recipes are strict schemas in `src/boards/`, and a board can use mainline QMK or upstream ZMK with data only. (Claude, building rung 8)
- **Audit of rung 7's code.** The QMK build was already parameterised by repo, SHA, image, submodules, keymaps folder and layout macro, so a mainline QMK board needed no new build kind. Gaps found: geometry only read `keyboards/<target>/keyboard.json` and picked the layout named `LAYOUT` (mainline `crkbd` keeps its layouts in the parent `info.json`, and names its macro `LAYOUT_split_3x6_3`); the build only looked for a `.bin`. The ZMK build was hardcoded to MoErgo's template, `glove80.*` file names and a two-image UF2.
- **Changes.** `build.layoutFile` and `build.artifact` for QMK; geometry reads the layout `build.layoutMacro` names, through `layout_aliases`. A new `zmk-west-docker` build runs `west build` per shield in ZMK's own image against a `west.yml` pinned to the board's ZMK SHA, and bundles one UF2 per half in a zip. This is the generic recipe Q10 deferred "until the first such board arrives". `board.json`'s `build` and `flash` were passthrough objects, so `boards check` could not catch a typo; they are now discriminated unions of strict objects, validated on load.
- **Option rejected:** a `command` flash recipe that runs a tool named in `board.json`. A contributed `board.json` would run arbitrary commands on every user's machine.

### D-050: QMK boards can flash to UF2 drives, and a board keyloom can't flash is `manual`. (Claude, building rung 8)
- **Why:** QMK boards flash with `qmk flash`, `dfu-util`, `avrdude` or UF2 drag-and-drop, not Zapp. UF2 drives share the ZMK flasher. The rest need per-tool code (port discovery, bootloader modes) that no board yet needs.
- **How:** `flash.kind: "manual"` builds the file; `keyloom flash` then fails with the file's path and the board's own instructions, so the contributor flashes by hand and says so in the PR. Adding `dfu-util` or `avrdude` is a code change, and the guide says to open an issue first.

### D-051: The template lives in `boards/_template/`, and an unfinished board folder is skipped, not fatal. (Claude, building rung 8)
- **Why:** a contributor copies a folder, and every `boards/*/*` folder was embedded at bundle time and parsed at start-up. A folder without `geometry.json` (the state between steps 2 and 3) crashed every command, including the `boards check` that reports the problem.
- **How:** folders whose vendor name starts with `_` are not embedded. A folder that fails to parse is skipped with one line on stderr naming the fix. Released builds only carry boards CI has checked.

### D-052: A choice decision's subject is the keys the change affected, and the agent must write a decision draft with every proposal. (Claude, building rung 6)
- **Why:** 08 says the subject "comes from the validator's diff", but a hold-tap tuning changes no binding, so `diff.changed` is empty and the decision would have no keys: nothing could remind BK of it, and the decisions view could not light it.
- **How:** `diff.retuned` lists hold-tap keys whose binding is the same but whose profile options (or a tap-hold setting they don't pin) changed. The subject is `changed` plus `retuned`, with the functions now on those keys. `retuned` is separate from `changed` on purpose: tuning is not a move, so it raises neither `moved_pinned` nor a relearn count. `decisionDraft` is required in `propose_changes`, stored on the change set (`decision_draft`, with the ids of BK's messages it answers), and written as a `hypothesis` decision on apply. An editor change gets a decision only when BK types a reason: the summary as both goal and choice, his words as the reason.

### D-053: Reminders come from active `choice` decisions only, match on keys, and skip a decision BK marked unhelpful. (Claude, building rung 6)
- **Why:** 08 says a change that overlaps "an active decision" is reminded. Read literally that includes priorities, which `moved_pinned` already covers, and decisions BK has said did not work, where a reminder only nags.
- **How:** `contradicts_decision` is raised for `hypothesis` and `tried_helpful` choices; the reminder carries the status, and for `tried_helpful` the warning says to change it only for a reason BK can state. A decision with keys matches when one of them changed, was retuned, or sat on a removed layer. A decision with no keys (written by hand about a function) matches when that function leaves a key it was on. Matching by function is not applied to a decision that has keys, because Command can sit on several keys and losing an unrelated copy is no contradiction. A reminder never blocks (D-023).

### D-054: Applying a change supersedes every active choice it touched, and undo and redo carry the memory with the document. (Claude, building rung 6)
- **Why:** 08 says the old decision becomes `superseded` with `superseded_by` set to the new one. That leaves two gaps: a change applied with no reason has no new decision to point at, and an undo would leave a decision claiming a key is where it no longer is.
- **How:** apply supersedes every touched active choice, including `tried_unhelpful` ones (the new decision is the fix for them). With no new decision, `superseded_by` is null: overridden with no reason recorded. Migration 0006 adds `status_before`. Undoing a revision retires the decisions its change set wrote and restores what it had superseded, to the status they had. Undoing an undo (a redo) does the reverse. Which change sets a revision carries is computed from the revision chain (`liveChangeSets`: an undo revision carries what the revision before the one it undid carried), so undo and redo are one rule. A decision BK retired himself has no `status_before` and is never restored.

### D-055: `update_decision_outcome` records a verdict on a choice in BK's words, and a reminder is a question before it is a proposal. (Claude, building rung 6)
- **Why:** without rules, the model can mark a priority "helpful", record outcomes on a guess, or answer a reminder by proposing at once.
- **How:** the tool takes `tried_helpful` or `tried_unhelpful` and a required note in BK's words. It refuses a priority (BK states and removes those), a decision that is superseded or retired (it no longer applies), and a decision on another layout. The prompt lists each earlier decision with its id and status, and says: a hypothesis is open to revision; `tried_helpful` needs a reason from BK before the agent proposes undoing it; when BK asks to change keys a decision placed, quote the reason, ask whether it still holds, and do not call `propose_changes` in that reply. If he says go ahead, propose; the preview shows the reminder beside the keys and applying replaces the old decision.

### D-056: The 7-day question is per decision, asked once, and answered in the chat panel. (Claude, building rung 6; Q6 stays open)
- **Why:** 08 says to ask when the layout is opened at least 7 days after "a flash". With one clock per layout, a retuning flash two days ago would hide a month-old decision, and there was nowhere to record that a question had been asked.
- **How:** a `hypothesis` choice is due once 7 days have passed since the first successful flash whose build began after the decision was written. `outcome_asked_at` records an answer or a dismissal, so it is asked once. The clock is a parameter (`keyloom decisions due --now`). The chat panel shows one card per due decision with "It helped", "It didn't help" (each takes a note) and "Not now", which ends the question and leaves the decision a hypothesis. The same answer is `keyloom decisions outcome`.

### D-057: Hold-tap profiles are validated against what each generator can write, and a key can be tuned alone. (Claude, building rung 6)
- **Why:** the QMK generator throws on a profile option it can't set per key (anything but `TAPPING_TERM`, `QUICK_TAP_TERM`, `PERMISSIVE_HOLD` and `HOLD_ON_OTHER_KEY_PRESS`), and silently gives two keys with the same tap and hold the same value, because it matches by keycode. A tuning that passed the preview would fail the build.
- **How:** `firmware_unsupported` now covers profile options on both firmwares: QMK's per-key rule and the keys-must-agree rule; ZMK's flavor names, millisecond values and trigger positions. "Feels slow on F" is a new profile for F's key plus a `setBinding`, so the rest of the home row keeps its feel; editing the shared profile retunes all its keys. A change to a QMK tap-hold setting counts as retuning every hold-tap whose profile doesn't pin that option. Both firmwares' generated source was checked: QMK emits `get_tapping_term` over exactly the retuned keycodes, ZMK rewrites the profile node (or the `&mt` override).

### D-058: `homerow_same_hand_mods` means a home-row letter holding a modifier with no opposite-hand rule, and it warns only about what a change adds. (Claude, building rung 6)
- **Why:** 07 defines it as "no opposite-hand constraint (QMK Chordal Hold or ZMK `hold-trigger-key-positions`)". BK's Moonlander already has Chordal Hold, and an imported ZMK layout may already roll, so a warning on every edit would be noise.
- **How:** a hold-tap whose tap is a letter A to Z on a position in the board's `home` row, holding a modifier. QMK is constrained when `CHORDAL_HOLD` is on in the profile or the layout-wide settings. ZMK is constrained when the profile's `hold-trigger-key-positions` is non-empty and holds no position on the key's own hand other than thumb keys. One warning per profile, naming its keys and the fix, shown only when it is not already in the layout before the change.

### D-059: The decisions view and the outcome question live in the chat panel, and the board lights a decision's keys on hover. (Claude, building rung 6)
- **Why:** 09 asks for a decisions view per layout. A new page would take BK away from the board he is pointing at; the chat panel already has a History view to copy.
- **How:** a "Decisions" toggle beside History lists active decisions with status, the keys, the words and the outcome; replaced ones fold away. Pointing at a card lights its keys on the board (a ring and a corner square, apart from the dashed "not applied" mark) and switches to their layer. A card can be edited (words, how it went), retired (one confirmation, the record stays) or opened at its conversation. A previewed proposal shows the stored reason in the card, in a "Remembered reasons" strip under the board, and as the same mark on the keys. The editor's optional "Why this change?" field and the hold-tap tuning panel use the same check and apply routes as every other edit.

### D-060: A mirror partner is the key at the same height on the other half, and mirroring a behaviour keeps each key's own letter. (Claude, building rung 7)
- **Maps checked.** Every shipped board's `mirror` pairs were compared by drawn centre, after display rotation: partners share a height and sit on opposite sides of one vertical axis (Moonlander x = 8.5, Glove80 x = 9, Corne x = 7), including both Glove80 thumb clusters. `test/boards/mirror.test.ts` runs the check on every board, so a contributed `mirror` is held to it.
- **What mirroring copies.** From the partner key it takes the hold, not the tap. A hold-tap brings its hold and profile and the target keeps the letter it types now; a plain key takes the hold off the target; a modifier key, layer key, macro, transparent and none are copied whole. A target with no key of its own to keep as the tap (a layer key, say) is skipped and said so, never overwritten.
- **Which modifiers.** The result carries the modifiers of the target key's hand (Left Command on the left half, Right Command on the right), not a swap of each. Every result is single-handed, so it can't trip `qmk_modtap_mixed_hands` (one right-hand modifier makes a whole QMK mod-tap right-handed), and Hyper on the left becomes all four right-hand modifiers on the right.
- **ZMK profiles.** A ZMK profile with `hold-trigger-key-positions` lists the other hand's keys, so reusing the left profile on the right would trigger a hold on same-hand rolls, the opposite of its purpose. The mirrored copy lists the mirror partner of each position (`<id>-mirrored`). A profile the layout already has with those options is reused, so a second run adds nothing, and the mirror of a mirrored profile is the original. QMK profiles carry no positions and are shared.
- **Who does it.** `src/layout/mirror.ts` is pure; the agent's `mirror_keys` tool (03) runs it and returns ops already checked, and the agent still writes the proposal as one `setBinding` per key (D-011: no pattern op). The model is told to use the tool instead of working out positions and hands itself, because a plausible mirror with one wrong hand or a same-hand trigger list is the mistake a review misses.

### D-061: "Repeat last change on selection" is three transforms, remembered for the page's session. (Claude, building rung 7)
- **Narrow definition.** The editor's last applied change is reduced by `src/layout/repeat.ts` to one of: *rewrap* (the change put a hold on a key, or changed its hold, and left the tap alone: each selected key gets that hold and profile around its own tap), *unwrap* (the change took the hold off and kept the tap: each key loses its hold and keeps its tap) or *copy* (anything else: each key is set to exactly the binding the change produced). A key the transform can't apply to (a layer key can't take a hold) is skipped with its reason; a key that already matches is reported as unchanged.
- **Why not more.** Guessing intent beyond that (change the hold's modifier by one finger, map a letter to its neighbour) would be a mistake the panel can't show. The panel lists every key with before and after before anything is saved.
- **One change set.** The result is `setBinding` per changed key, checked by the server's validator and applied as one change set through the editor path, so it undoes as one step (D-015). Warnings ask for confirmation, as for any editor change.
- **Remembered where.** In the page, until reload. The revision history already holds the change; reading it back to offer "repeat" after a reload would also need the original binding, and nobody asked for it.

### D-062: A proposal made from a selection that edits other keys gets an `outside_selection` warning. (Claude, building rung 7)
- **Rule.** When the message carried a selection, any key in `diff.changed` that is not in it (another position, or the same position on another layer) produces one warning naming those keys, with their slots. It applies to `analyse_change` and `propose_changes` for that turn, so the agent sees it and BK sees it in the preview. It is a warning, not an error, because a proposal can have a good reason (a displaced function needs a home), and the preview should make BK see it, not forbid it (D-023).
- **Not checked.** Selected keys a proposal leaves alone are not a problem (the agent may find one already matches). The editor path and apply don't take a selection: the stored proposal's warnings are what BK saw.
- **Which selection.** The one sent with the latest message; the validator receives it as `EvaluationContext.selection`.

### D-063: The selection reaches the model with key numbers and positions, and the history shows what BK typed. (Claude, building rung 7)
- **Format.** `Selected on Layer 0 (layer id layer-0): key 37 (position 36) H; key 38 (position 37) J/r⌘`. The old `positions 36, 37` header gave a layer id and zero-based numbers while the prompt told the model to name keys "key N", which invites an off-by-one when it repeats them to BK. Both numbers are given; ops use positions and talk uses key numbers.
- **Display.** The header is stored in the message text, so the conversation view returned it with the typed words. It is now stripped for messages that carry a selection, since the bubble already shows the keys as chips. The inspector's "Position N" reads "Key N", the editor's word.

### D-064: "Touches exactly the selected slots" means every changed slot is selected and every selected slot whose mirror differs changed. (Claude, building rung 7)
- **Why this wording.** BK's right home row on the Moonlander has plain D and A on the left, so K and ; would stay plain: a selection of all five can only change three. The demo and the live eval select the keys that have a mod on the left (Moonlander H, J, L; Glove80 J, K, L, ;) so that `diff.changed` equals the selection as a set.
- **Starting state.** BK's own Moonlander already has mods on the right (H/Hyper, J/r⌘, L/r⌥), which leaves nothing to mirror. The demo and eval take them off first with an editor change (`test/helpers/home-row.ts`); the Glove80 template has no hold-taps, so the left home row is given them with a profile that lists the right hand's keys.
- **Not changed.** Selection stays a click-to-toggle on one layer and is cleared when the message is sent (D-012). Drag-select (09) is still to come; nothing in rung 7 needed it.

### D-070: A keyloom ZSA build carries its own marker and a bootloader command, wired in with a linker `--wrap`. (Claude, building flash/handsfree)
- **Why:** flashing needs the board in its bootloader, which needed a keypress. BK allowed unattended flashing, and ZSA's Oryx raw-HID protocol (`modules/zsa/oryx/oryx.h`, commands 0x00-0x0C and 0xFE) has no bootloader command.
- **Marker.** The generated `config.h` replaces Oryx's `SERIAL_NUMBER` ("QxKPz/zLQ3Md") with `keyloom/<last 12 characters of the build ID>` (20 characters). The ID's first 10 characters are a timestamp and its tail is random, so two builds never share a marker. The length is bounded by `oryx.c` (`ORYX_CMD_GET_FW_VERSION`), which copies `sizeof(SERIAL_NUMBER)` bytes plus a stop byte into one 32-byte report. The host reads the serial from `system_profiler` (`USBDeviceKeySerialNumber`, seen on Darwin 27) or sysfs `serial`. Side effect: Oryx's version reply now says `keyloom/...`, and whether Keymapp or Oryx's web app still recognise the keyboard is **unchecked** (nobody has flashed one yet).
- **Command.** A 32-byte raw-HID report whose first byte is 0xE7 (unclaimed by Oryx, and by VIA's 0x01-0x15 and 0xFF in `quantum/via.h`) followed by the eight bytes `KLBOOTLD`. `__wrap_raw_hid_receive` in `keymap.c` checks both and a length of at least 9, then calls `reset_keyboard()` (shutdown hooks, then `bootloader_jump()`, as the Reset key does). Everything else goes to `__real_raw_hid_receive`. The C is compiled and run on the host in `test/firmware/qmk/handsfree.test.ts` with the right packet, near misses and a too-short one.
- **Why `--wrap`.** `oryx.c` defines `raw_hid_receive` itself, so a second definition fails to link and editing the module would fork ZSA's code. `rules.mk` gets `LDFLAGS += -Wl,--wrap=raw_hid_receive`: the linker binds the USB code's call to the wrapper and the wrapper's `__real_` call to Oryx's function.
- **LTO.** `--wrap` can be defeated by link-time optimisation, so `rules.mk` also gets `LTO_ENABLE = no` (appended last, so a layout's own `LTO_ENABLE = yes` cannot win). The Moonlander does not set it today. Evidence (reva, `zsa/qmk_firmware@93b2b9e`, arm-none-eabi-gcc 15.2.0 in the pinned image): `nm` shows `__wrap_raw_hid_receive` at 0x08002054 (52 bytes) and Oryx's `raw_hid_receive` at 0x08001484 (436 bytes); `raw_hid_task` at 0x0800a0b0 does `bl 0x08002054 <__wrap_raw_hid_receive>`, and the wrapper tail-calls `b.w 0x08001484 <raw_hid_receive>`. The build is 84 bytes larger than the plain one (67,352 against 67,268).
- **Opt-in.** `generateQmkSource({ handsFree: { buildId } })` adds all of it; without the option the output is what Oryx's own source builds to, and `docker.test.ts` still pins that byte for byte (reva `ccd90fde...`, revb `fcceb9fb...`). `keyloom generate` has no build, so it never adds it. Only ZSA boards flashed by Zapp get it.
- **Security.** Any process that can open the keyboard's raw HID interface can now reboot it into its bootloader with no keypress. VIA firmware has the same ability (`id_bootloader_jump`, 0x0B, `quantum/via.h`). Before, flashing took a person at the keyboard; now a process running as the user can restart the board and then run Zapp against it. The magic stops accidents, not an attacker. Revisit if the command should need a pairing (Oryx's `rawhid_state.paired`).

### D-071: Raw HID is IOKit through `bun:ffi` on macOS and `/dev/hidrawN` on Linux, and listing never opens a device. (Claude, building flash/handsfree)
- **macOS.** A `bun build --compile` binary cannot load native modules, and IOKit is always present, so `src/firmware/toolchain/hid-macos.ts` calls it with `bun:ffi`. Listing walks the `IOHIDDevice` registry entries and reads their properties (`PrimaryUsagePage` 0xFF60, `PrimaryUsage` 0x61, ids, `SerialNumber`); nothing is opened, so it needs no permission and cannot disturb a keyboard. Only `write` creates a device, opens it, calls `IOHIDDeviceSetReport` (output report, ID 0, 32 bytes) and closes it. Core Foundation objects are declared `u64` and not `ptr`: a short `CFString` is a tagged pointer whose high bits a JS number cannot hold, and a rounded pointer segfaulted bun (seen 2026-10-15).
- **Linux.** `src/firmware/toolchain/hid-linux.ts` scans `/sys/class/hidraw/*/device/report_descriptor` for the items `06 60 FF 09 61`, reads `HID_ID` and `HID_UNIQ` from `uevent`, and writes 32 bytes to `/dev/hidrawN`. A permission error says to install ZSA's udev rules. Untested on hardware; the sysfs reading is tested against a fake tree.
- **Rejected:** `libhidapi` (not part of macOS, so keyloom would have to ship or build it) and `node-hid` (a native module).
- **A write error is not a failure.** The keyboard can reset before the OS reports the write done, so the verdict is whether the bootloader (or the loss of the running keyboard) shows on USB afterwards. After a write error it waits 4 s rather than 15 s, so a permission error is reported quickly.
- **Tests cannot write.** `test/helpers/no-real-flash.ts` replaces `defaultHidTransport()` and the macOS transport's `write` with refusals; tests inject a fake transport.

### D-072: A flash restarts the keyboard once Zapp is waiting, and it is verified against the new build's marker. (Claude, building flash/handsfree)
- **Order.** `keyloom flash` checks what the keyboard runs. Only a `keyloom/` serial gets the command, sent after Zapp prints "Firmware loaded", which is the point where it asked a person to press the key. The bootloader wait is unchanged (2 minutes).
- **Fallback.** Any reason it cannot (Oryx's firmware, no keyboard, no raw HID interface, a refused open, no bootloader within 15 s) is logged and the person gets the old reset-key instruction with the reason, so the first flash is the old flow. Before the flasher has spoken, the instruction is "keyloom is checking whether it can restart the keyboard...", not "press reset", so a person is not told to press a key for the few seconds the check takes.
- **Stranding.** If the command worked and Zapp then never writes (cancelled, or timed out), the error says the keyboard is in its bootloader and must be replugged or flashed, because it does not type.
- **Verification.** If the file being written contains `keyloom/<tail of this build's ID>` (Oryx's version reply keeps `SERIAL_NUMBER` as a string, so it is findable in the `.bin`), then after Zapp exits 0 keyloom waits up to 45 s for the keyboard to re-enumerate with that serial. "Verified: the keyboard is running build X." goes in the log and in the flash's new `note` field (read back from the log, so there is no migration to clash with other work in flight). A keyboard that returns with another serial, or not at all, makes the flash `failed` with both serials named, even though Zapp reported success.
- **Older builds** have no marker, so they are never verified, and a flash of one still gets the hands-free restart if the running firmware is keyloom's.

### D-073: `make` runs with `QMK_USERSPACE` empty, because the image's default made builds fail intermittently. (Claude, building flash/handsfree)
- **Seen:** the QMK image sets `QMK_USERSPACE=/qmk_userspace`, a folder that does not exist, so the last step printed `cp: cannot create regular file '/qmk_userspace/...bin'`. Three of six builds on 2026-10-15 ended `Make finished with errors` (exit 2) after producing a good `.bin`; the others passed with the same message. An earlier build log (`release-0.2.0`) shows the same line on a passing build. The cause of the intermittency is not known; with the variable empty the copy is skipped and three builds in a row passed.

### D-074: Keyboard state is read from USB, `keyloom doctor` reports it, and `keyloom flash --reboot-only` tests the restart on its own. (Claude, building flash/handsfree)
- **doctor** prints, per attached keyboard keyloom can restart: the running build and whether its raw HID interface is visible ("the next flash needs no keypress"), or the foreign serial and "the first flash needs the bootloader key". It prints one line when nothing is attached.
- **`flash --reboot-only [--board B]`** sends the command, waits for the bootloader, prints it and stops. It flashes nothing and leaves the keyboard in its bootloader until it is flashed or replugged. Exit 8 (`flash_failed`) if it could not, exit 2 if no restartable keyboard is attached or several are.


### D-075: `keyloom emulate` runs the firmware itself, with a mock keyboard, and doesn't model it. (Claude, building rung 6 emulation)
- **Why:** hold-tap flavours, `require-prior-idle-ms`, quick-tap, tap dances, combos and sticky keys are the behaviours BK's two problems turn on (D-025). A TypeScript model of them would be a second implementation to keep equal to ZMK's, and would agree with whoever wrote it. ZMK's own tests run the firmware on the host (Zephyr's `native_posix_64` board with a `zmk,kscan-mock` driver replaying `ZMK_MOCK_PRESS/RELEASE` events), so the same route answers "what would my Glove80 type" with the real code.
- **How:** the layout's generated keymap is built for `native_posix_64` in the images the real builds use (06#emulate-runs-zmk-itself-on-the-host-with-a-mock-keyboard). The Glove80 runs in the MoErgo image's Nix store with the gcc already there, so no new image or download; the Corne runs in `zmk-build-arm` against the west workspace the build keeps.
- **Cost:** a build per distinct question (7 s Glove80, 25 s Corne), because a new keymap changes the devicetree everything includes. A saved log answers a repeat.
- **Option rejected:** reimplementing the behaviours in TypeScript, for the divergence above.

### D-076: The mock keyboard is one row of keys numbered by position, and hardware behaviours become `&none` with a warning. (Claude, building rung 6 emulation)
- **Why:** the bindings in a generated keymap are already in position order, so a one-row matrix whose column p is position p makes the board's real wiring irrelevant and works for any ZMK board without reading its transform. Combos' `key-positions` mean the same. (The brief said to map through the board's transform; that is the same mapping with an extra file to read.)
- **Replaced with `&none`:** `&bt`, `&out`, `&rgb_ug`, `&bl`, `&ext_power`, `&bootloader`, `&sys_reset`, `&soft_off`, `&studio_unlock` (no radio, LEDs or power switch on the host) and `&mkp`, `&mmv`, `&msc` (the report contract carries no mouse reports). Every call in every cell array is replaced, so macros that press `&bt BT_SEL 0` and hold-taps that call them still compile. Each is listed in `warnings`.
- **Settings:** only conf settings that change what keys do are applied; the others would fail Kconfig on a board without the hardware and are listed in `warnings`.
- **Revisit:** if a layout's behaviour depends on a replaced binding (a macro that toggles RGB and then types), the warning is the only sign.

### D-077: Reports are read from the firmware's debug log, not from a patched ZMK or a virtual USB device. (Claude, building rung 6 emulation)
- **Why:** ZMK at upstream v0.3.0 and at MoErgo's `ce69e85` both log each keycode state change, each change of the modifier byte (already the sum of explicit, implicit and masked modifiers) and each `zmk_endpoints_send_report`. That is enough to rebuild every report with hid.c's slot rules, and needs nothing added to either tree. A USB/IP device would need the USB stack ZMK's native build leaves out; a `--wrap` shim would be C that has to track `zmk_hid_*` internals across forks.
- **Dedup:** a report equal to the last of its kind (keyboard or consumer) is dropped, the first against an empty report, so the list is the changes a host would see.
- **Guards:** a log with dropped lines, or fewer key events than were sent, is an error, not a partial answer. Errors the firmware prints on every run (`USB endpoint is not supported`) are ignored; any other is a warning.
- **Revisit:** if a ZMK change drops these log lines, the parser's fixtures (captured from real runs) fail first.

### D-078: Time is the firmware's simulated clock, and the mock's delays are compensated so a script's times come back unchanged. (Claude, building rung 6 emulation)
- **Found by running it:** the mock kscan's delay for event k is the wait before event k+1, the first event's delay is also used before event 0, and Zephyr adds one tick to a relative timeout. Used as written, every gap is 1 ms long and the first two events are tied together.
- **How:** an unmapped event (a column past the matrix) goes first and only starts the clock; each real event carries the gap to the next, minus one tick; the last carries a 2 s settle time so tapping terms and sticky-key timers can fire. The binary runs with `-no-rt`, so the clock is simulated and a run takes milliseconds. A report's `at` is its log time minus the first key event's.
- **Limit:** a gap of 32 767 ms or more can't be encoded and is refused; two events 1 ms apart arrive together.

### D-079: Keymap and conf go to the container on standard input, the build lives in the container, and finished runs are cached. (Claude, building rung 6 emulation)
- **Found by running it, twice, on Colima (2026-10-15):** a keymap rewritten on the mounted folder reached the container cut off at the old length (a devicetree parse error mid-file); and a build folder kept on the mount made ninja treat the previous run's binary as current, so a run replayed the last run's keys. Both come from the mount's timestamps and sizes lagging the host.
- **How:** the files travel as base64 lines on stdin and are written to the container's `/tmp`; the build is in `/tmp` too. Only the Corne's west workspace is mounted, and keyloom never rewrites a file in it (`config/west.yml` is written only when it differs).
- **Cache:** the firmware is deterministic, so the log is stored by a hash of the firmware pin, the image, the scripts and the native keymap and conf (the events are in it). 40 are kept.


### D-080: QMK emulation compiles the generated `keymap.c` into QMK's own host test harness, with Oryx's output-only code stubbed. (Claude, building the QMK emulator)
- **Why:** the promise is what the real QMK core would send. `make test:<name>` already builds action processing, tap-hold, layers, one-shot, combos, tap dance and `SEND_STRING` for the host. Compiling the generated `keymap.c` unchanged means the emulator tests the code keyloom generated, including its chordal-hold table, tapping callbacks and macros, not a second description of it.
- **How:** the test platform's keyboard is generic, so the board's `LAYOUT_*` macros come from `qmk generate-keyboard-h` and its config from `qmk generate-config-h`, both run in the pinned image. Positions map to matrix cells by calling the real layout macro with `1..N`. A stand-in `QMK_KEYBOARD_H` header supplies what `moonlander.h` and the Oryx module give the keymap (keyboard config, `rawhid_state`, RGB calls, ZSA's keycodes from `modules/zsa/defaults`).
- **Option rejected:** the fixture's `set_keymap` from keycodes keyloom generates. It would skip `keymap.c`, so combos, tap dance, macros and the chordal-hold table (all in `keymap.c`) would need separate handling.
- **Found while building:** BK's Moonlander holds S as `MT(MOD_LALT, KC_S)`, and with `CHORDAL_HOLD` on, S held and then E (same hand) sends S then E, not Alt+E. S held and then U (other hand) sends Alt+U on release of U. A model written from the layout would have got this wrong.

### D-081: Each emulation gets its own folder in the pinned checkout, deletes it inside the container, and returns the result on stdout. (Claude, building the QMK emulator)
- **Why:** with Docker on Colima, a container read a file the host had just rewritten in place cut to the previous run's length. `events.txt` went from 25 bytes to 54; the container saw 25, so a hold-and-tap script lost its last events and ended with Alt+U held. It happened in one of three full runs of the Docker tests and not when a test ran alone. The layer responsible (the mount, the VM's file cache) was not isolated. A new folder per run has no earlier size to disagree with, so the fix does not depend on finding it. The cleanup runs in the container (as `build.ts` already does for objects) and the output is printed between markers instead of read from a file, for the same reason.
- **Cost:** QMK's objects are rebuilt each run, about 12 s warm; googletest's objects in `.build/gtest` are reused.
- **Checkout change:** the emulator adds `lib/googletest` to the submodules it initialises. The firmware build is unchanged and ignores it.

### D-082: The emulator carries an allowlist of rules.mk features and config.h verbatim; everything else in `rules.mk` is hardware and is reported. (Claude, building the QMK emulator)
- **Why:** `config.h` holds what changes behaviour (`TAPPING_TERM`, `CHORDAL_HOLD`, `PERMISSIVE_HOLD`, `COMBO_COUNT`, layer-state width), so it goes in as generated. `rules.mk` mixes behaviour (`COMBO_ENABLE`, `TAP_DANCE_ENABLE`) with hardware (`ORYX_ENABLE`, `RGB_MATRIX_CUSTOM_KB`) the host build can't use. A denylist would break on the next hardware flag; an allowlist (`CARRIED_FEATURES` in `emulate-harness.ts`) fails soft, and each line it leaves out appears in `warnings`.
- **Always on:** `EXTRAKEY_ENABLE` and `MOUSEKEY_ENABLE`, because every board the project supports has them and a layout can use media and mouse keys without the rules saying so. NKRO stays off, so reports are the 6-key kind.

### D-083: Reports use QMK's own key names and a 1 ms scan clock, and a script ends one second after its last event. (Claude, building the QMK emulator)
- **Names:** the harness prints `get_keycode_string()` for keys and, for media keys, the name of the keycode whose `KEYCODE2CONSUMER` value matches the usage. `fromQmk` maps those to keyloom's names. keyloom has no usage table to join on and the harness already knows QMK's mapping. A key keyloom doesn't name is shown by QMK's name and warned about.
- **Time:** the fixture's own loop runs `keyboard_task()` once per millisecond. Each event is applied at its time and scanned at that millisecond; events with the same time are applied one millisecond apart in the order given. Reports are stamped with the simulated time, relative to the first event.
- **Settle:** `settleMs` (default 1000) runs after the last event so a pending tap-hold or one-shot resolves. A script that ends with a key still down stays down.

## Configurator parity and UI/UX (2026-10-15, after v0.10.1)

After v0.10.1, BK asked us to "got through every feature of nickcoutsos' configurator and every feature of oryx, see how they work and create a /blueprint of it so that we can build those features into keyloom", to "do the same for vial", and to "do a visual assessment of keyloom" and "a UI/UX blueprint". He named his taste: "i love most oryx and vial". Mid-session he added "so is there no way for me to flash without needing to physically interact with the boards, similar to what vial does?", "Not just for glove 80 but for all my boards", and asked to use his Codex subscription and an OpenRouter key for the AI. Five research files and the UI audit back these decisions. They are listed in [README](README.md).

### D-084: Configurator parity and the UI/UX plan extend this blueprint as chapters 16 to 19 and rungs 9 to 18. (Claude, delegated by BK)
- **Option rejected:** a separate feature blueprint under `docs/configurator/`. D-039 and D-031 change, so one decision log keeps the history in one place.
- **Principle (BK, earlier this session):** "I said you can decide on things".

### D-085: Everything about a key is made on the key. Nothing has to be created elsewhere and then assigned. (BK)
- **BK:** "Others need you to first go create a thing somewhere else and then you come and assign the thing to the key, there's no way to click a key and then create the complex thing for the key right there. but I think oryx comes close to this."
- **Evidence:** Vial needs 9 clicks across two tabs for a tap dance and 8 plus a 5 s physical unlock for a macro. keymap-editor creates hold-taps in a separate `behaviors` tab. Oryx builds both on the key ([16](16-key-editor.md#bks-rule-never-create-a-thing-elsewhere-and-come-back-to-assign-it)).
- **Consequence:** the library lists shared things for reuse and editing. It is never a required step.

### D-086: A key is up to four slots (tapped, held, double-tapped, tapped then held), and the filled slots decide its kind. (Claude, from BK's preference for Oryx)
- **Taken from:** Oryx's key popover (`oryx-features.md`, screenshots 06 and 12).
- **Options rejected:** (a) keymap-editor's "pick a behaviour, then its parameters", which costs 8 clicks for a mod-tap and needs a custom behaviour first; (b) Vial's palette of masked keycodes, which moves the selection off the key after the outer pick.
- **Why:** the person thinks "when I hold it, Ctrl", not "it's a hold-tap with parameters".

### D-087: One picker serves every slot, with search, categories and an Any expression field. The hold slot opens on Modifiers and Layers. (Claude, in the blueprint)
- **Taken from:** Oryx's picker and Vial's Any keycode dialog.
- **Fixes:** keymap-editor types `&mt`'s hold as a keycode, so its modifier toggles produce `LC(TAB)` instead of a hold.

### D-088: Macros are built in the picker's Macro tab, and each picked key adds a step without closing anything. (Claude, in the blueprint)
- **Why:** Oryx needs a CLOSE per step (12 clicks for three keys). Vial needs a separate tab, Save and a physical unlock. keyloom's flow is six clicks.

### D-089: Combos are made from a selection on the board, with an optional name. (Claude, in the blueprint)
- **Why:** five clicks, against Oryx's 8 plus a name and keymap-editor's 12. Positions are picked where they are, on the board.

### D-090: Layer tabs add, rename inline, duplicate, reorder, delete with a reference check, and carry a short label and colour. (Claude, in the blueprint)
- **Replaces:** the unbuilt layer actions in [09](09-web-editor.md#interactions), which v0.10.1 never shipped.
- **Avoids:** keymap-editor's index-splice delete, which breaks references.

### D-091: Keys can be swapped, dragged, copied and pasted, each as one change set. (Claude, in the blueprint)
- **Taken from:** Oryx's Swap keys and copy key.

### D-092: A change that drops a function asks "Drop F16" or "Put F16 somewhere first" in plain words, and this ships first. (Claude, from the UI audit)
- **Evidence:** v0.10.1 refuses F16 → F17 with validator text and offers no way to add `dropFunction` (`src/validation/rules.ts:230`; audit screenshot 17). Most single-key edits dead-end.
- **Principle (BK's CLAUDE.md):** "Fix before adding."

### D-093: The layout model gains a `tapDance` binding kind with up to four slot actions and one term. (Claude, in the blueprint)
- **QMK:** `ACTION_TAP_DANCE_FN_ADVANCED`, in the shape Oryx generates, so BK's imported tap dances stop being opaque `native` keys. **ZMK:** `&td` with generated hold-taps. Equivalence is S16.
- **Option rejected:** keeping tap dance as `native` only. BK can't edit what he can't see.

### D-094: Apply puts the change on the keyboard. Each board shows a sync state, and auto-sync turns on per board after one verified hands-free flash. (Claude, from BK's "click a key, click what you want it to be and done")
- **BK:** "vial is really really user friendly in terms of not needing to manually flash".
- **Safety:** firmware keyloom didn't build is never replaced without the flash dialog's confirmation. Only verified flashes count as in sync (D-072).
- **Open:** whether auto-sync is on by default once proven (Q16).

### D-095: ZMK boards get hands-free flashing from a vendored `keyloom-zmk` module: a USB serial port, a 1200-baud touch, a relay from the left half to the right, and a build marker in the USB serial. (Claude, from the research)
- **Evidence:** [../research/handsfree-flash-all-boards.md](../research/handsfree-flash-all-boards.md). The bootloader enters UF2 mode on GPREGRET `0x57` (`bl-moergo@bb68c75` `src/main.c:112-116`). The split relay works on existing right-half firmware (`zmk-fork@ce69e85` `app/src/behavior.c:96-101`).
- **Options rejected:** (a) ZMK Studio, which has no reboot request and can't be extended to add one (`core.proto:10-17`); (b) a ZMK raw HID module, which runs on the central only; (c) BLE OTA DFU, which needs a Nordic DFU client and has no known Glove80 user; (d) tadakado's module as-is, which needs Zephyr boot-mode retention that neither pin has.
- **Cost:** the first keyloom flash of each ZMK half still needs its key combo.

### D-096: Live writes are an optimisation of Apply, built only if auto-sync is too slow in BK's use. (Claude, in the blueprint. Replaces D-039)
- **Why:** they add a second source of truth, and on ZMK they can't change hold-tap timing, combos, macros or tap dances, which BK's two problems need (D-025).
- **Gate:** a week of auto-sync from rung 13, then BK's answer to whether the wait bothers him.

### D-097: The Moonlander stays on ZSA's fork. A live write, if built, is keyloom's own set-keycode command in its raw HID wrapper, not Vial. (Claude, in the blueprint)
- **Options rejected:** Vial firmware. It brings live tap dance, combos and tapping term, but drops ZSA's fork, Oryx's live view, Keymapp and rev B, and its bootloader jump needs a physical unlock (`quantum/via.c:434-446`).
- **Open:** Q18 asks BK whether Vial's extra live reach is worth giving up Oryx.

### D-098: The board is the page. Editing happens in a side panel that never moves the board, and chat is a drawer. (Claude, from the UI audit and BK's preference for Oryx)
- **Evidence:** opening the editor scrolls the board 552 px away at 1440×900 (`src/web/Viewer.tsx:132-137`); the chat column takes 400 px whether used or not.

### D-099: One click, one job. Clicking a key edits it. Keys reach the chat only through its "Asking about" chips. (Claude, from the UI audit)
- **Evidence:** a click inspects and selects for chat at once (`src/web/keyboard/Keyboard.tsx:176-180`).
- **Open:** Q19.

### D-100: The visual system carries kind by shape as well as colour, uses a 1.25 type scale and 4-based spacing only, and every visual rung is gated on screenshots in both themes and widths plus a non-text contrast test. (Claude, from BK's "make sure the UI you build looks good" and "follows good design principles")
- **Evidence:** kind fills differ by 1.17:1 to 1.31:1; empty-key borders are 1.53:1; legends fall to 8.1 px ([../research/keyloom-ui-audit.md](../research/keyloom-ui-audit.md)).

### D-101: Plain words first. Firmware names appear only in an Advanced view, and every validator rule has a sentence for people. (Claude, from the UI audit)
- **Taken from:** Oryx's Simple and Advanced views.

### D-102: History means layout revisions, with undo to any revision and "flash this revision". Chats are "Conversations". (Claude, from the UI audit)
- **Evidence:** v0.10.1's History lists chats, and undo goes back one step (audit screenshots 18 and 19).

### D-103: Firmware-wide options live on one settings page with a filter and a paragraph per option. Per-key timing lives on the key. (Claude, in the blueprint)
- **Taken from:** Oryx's settings page. **Improves on:** Oryx, which sends per-key tapping term to settings.

### D-104: Per-key and per-layer lighting comes last, for boards with per-key RGB. (Claude, in the blueprint)
- **Why:** neither of BK's two problems needs it (D-025).

### D-105: keyloom doesn't take accounts and cloud layouts, GitHub OAuth, encoders, key overrides, MIDI, stenography, audio, a matrix tester, `.vil`, Smart Layers or a macro recorder. (Claude, in the blueprint)
- **Why:** each lacks a validated need or a board that uses it ([16](16-key-editor.md#what-keyloom-doesnt-take-and-why)). Deferred, not rejected. Most are reachable through Any as `native` bindings.
- **Principle (BK's CLAUDE.md):** "Don't ship features just because you can."

### D-106: The agent runs on one of three providers behind `AgentModel`: Anthropic, OpenRouter or Codex. (BK. Replaces D-031's "on the user's own key" for the provider choice)
- **BK:** "use codex cli for AI I think it allow you to use codex sub with it's agent sdk if I'm not mistaken, we can use that. Also make it possible for me to use an openrouter api key".
- **Context:** the Anthropic account behind keyloom's key ran out of credits ("Your credit balance is too low to access the Anthropic API"), which stopped the chat and the live evals.
- **Research:** [../research/model-providers.md](../research/model-providers.md).

### D-107: OpenRouter uses the existing Anthropic adapter, pointed at OpenRouter's Messages endpoint with `baseURL` and `authToken`. (Claude, from the research)
- **Option rejected for now:** a Chat Completions adapter through `openai`. It's needed only for non-Claude models (Q22).
- **Unverified until S19:** the Tool Runner, the fallback beta, `cache_control` and the out-of-credits error through OpenRouter.

### D-108: Codex spawns the installed `codex exec --experimental-json` directly, serves keyloom's tools from a loopback MCP server, and runs with shell off, a read-only sandbox and an empty working directory. (Claude, from the research)
- **Options rejected:** (a) `@openai/codex-sdk`, whose binary lookup through `node_modules` fails in a compiled binary and which doesn't expose `--ignore-user-config` or `--ephemeral`; (b) treating Codex as a drop-in `AgentModel`, since it runs its own loop and keeps its own thread.
- **Costs:** no token streaming, no cost figure, and 24k to 80k tokens of Codex's own prompt per run.
- **Open:** whether other users get it (Q20).

### D-109: A Claude subscription is not offered as a provider. (Claude, from Anthropic's docs)
- **Why:** Anthropic's docs say third-party apps may not route requests through Free, Pro or Max credentials, Agent SDK apps included.

### D-110: Whatever the provider, layouts change only through the validated `propose_changes` path and BK's Apply, and a hostile-prompt eval checks it for Codex. (Claude, in the blueprint; restates D-014 for providers keyloom doesn't control)

### D-111: A conversation is pinned to the provider and model that started it, and stored blocks become provider-neutral. (Claude, from the research)
- **Option rejected:** switching provider mid-conversation, which loses tool results and thinking blocks, and which Codex can't take at all.

### D-112: Each validator issue carries a `plain` sentence beside its raw `message`, and the editor shows only the sentence. (Claude, building D-101)
- **Option rejected:** rewriting `message`. The CLI's JSON and the logs keep the precise text with layer IDs and positions; `plain` is an added optional field, so stored results and old callers still parse.
- **Where:** each rule writes its sentence next to its message (`src/validation/rules.ts`, `hold-tap-rules.ts` and the others), using layer names and one-based key numbers from `src/validation/words.ts`. A stored result without `plain` falls back to the raw message.

### D-113: A lost function is asked about one row at a time, and only for keys the draft touches. (Claude, building D-092)
- **Rows:** "Drop F16" adds a `dropFunction` op with a generated reason ("Replaced by F17 on key 7 of Layer 0"); "Put F16 somewhere first" enters place mode, and the next key clicked gets the binding F16 came from. Both land in one change set, so undo is one step.
- **Layer keys:** when a layer key is the only way to a layer, Drop is not offered, because no `dropFunction` licenses an unreachable layer. The rest of that layer's keys are summarised as one line, since they return once the layer key is kept.
- **Chain:** putting F16 on a key displaces what was there, which raises the same question for that key.


### D-120: The provider comes from `--provider`, then `KEYLOOM_PROVIDER`, then `<data dir>/config.json`, then the first provider with a credential. (Claude, rung 10)
- **Why a file:** keyloom had no config mechanism (`agent.model` in the blueprint was only a comment in `src/agent/anthropic-model.ts`). A JSON file beside the database, with `agent.provider`, `agent.model` and `agent.effort`, is the smallest thing that fits and needs no new table or command. Keys never go in it (03).
- **Default order:** `ANTHROPIC_API_KEY`, then `OPENROUTER_API_KEY`, then a signed-in `codex` (asked last, because it runs a process).
- **Not built:** changing the provider from the web app. It shows the active provider and model and lists the three ways to set one up; the chapter's "lets BK change them" waits for a request.

### D-121: OpenRouter gets the Anthropic fallback beta removed and nothing else. (Claude, from S19)
- **Evidence:** OpenRouter returned 400 `Invalid input: expected array, received string` for `fallbacks: "default"`; `cache_control`, thinking, effort and streaming were accepted ([../research/spikes/S19.md](../research/spikes/S19.md)).

### D-122: Codex runs with its own `HOME` and `CODEX_HOME`, with only `auth.json` linked in, and with the account's apps, shell, plugins and sub-agents turned off. (Claude, from S20)
- **Evidence:** BK's global instructions reached a `--ignore-user-config` run until `HOME` was replaced, and the ChatGPT account's connected apps were in the tool list until `features.apps` was off ([../research/spikes/S20.md](../research/spikes/S20.md)).
- **Kept on:** `features.code_mode_host`. Codex defers MCP tools behind code mode, so keyloom's tools can't be called without it. Code mode has no file, network or `require` access.

### D-123: Codex's MCP server uses the official `@modelcontextprotocol/sdk` in stateless mode, not a hand-written one. (Claude, rung 10)
- **Why:** the SDK's streamable HTTP server runs inside a `bun build --compile` binary, so there was no reason to maintain a protocol implementation. It adds a dependency of about 56 MB of `node_modules` in development; the compiled binary was 67 MB.
- **Option rejected:** about 100 lines of JSON-RPC over `Bun.serve`, which would have avoided the dependency and taken on protocol drift.

### D-124: A Codex conversation is replayed to Codex as text, because the run is `--ephemeral`. (Claude, rung 10)
- **Why:** Codex's session files would hold BK's layout and priorities under `~/.codex`, outside keyloom. The cost is that each turn resends the earlier messages, with tool results cut to 2,000 characters.

### D-130: The `keyloom-zmk` module is vendored at `firmware/zmk/keyloom-zmk/`, embedded in the binary as text and written beside every ZMK build; its serial port comes from an overlay passed as `EXTRA_DTC_OVERLAY_FILE`. (Claude, building rung 12)
- **Embedded:** `src/firmware/zmk/module.ts` imports the six files with `with { type: "text" }`, as `image.ts` does the Dockerfile, so a released keyloom needs no checkout. `writeModule` replaces `<work folder>/keyloom-zmk` on every build, so a file from another version is never built. A test compares the embedded text with the folder on disk.
- **Why an overlay flag and not a snippet:** Zephyr 3.5 has no `snippet_root` in `module.yml`; `SNIPPET_ROOT` is the application folder and Zephyr itself (`cmake/modules/snippets.cmake:59-62` at `zmkfirmware/zephyr@dacab48`), so a module can't carry a snippet. A module also can't add an overlay to a board by itself. `EXTRA_DTC_OVERLAY_FILE` is what a snippet sets, and `-D` on `west build` or `cmakeFlags` in Nix sets it directly.
- **Module Kconfig:** `KEYLOOM_HANDSFREE` (default `y`) selects `USB`, `USB_DEVICE_STACK`, `USB_CDC_ACM`, `SERIAL`, `UART_LINE_CTRL` and `UART_INTERRUPT_DRIVEN`, the Studio snippet's set. It is built only into boards with a `handsFree` recipe.
- **Studio:** not handled in this rung. When rung 13 adds the Studio snippet, the module's own port and Studio's will both exist on the left half; the module should then watch Studio's (`zmk,studio-rpc-uart`) and drop its own. Recorded as a constraint, not built.

### D-131: The Glove80 builds with the module through a `config/default.nix` keyloom writes into its template checkout; the Corne builds with `-DZMK_EXTRA_MODULES`. (Claude, building rung 12)
- **Why a replaced file:** the template's `default.nix` calls `firmware.zmk.override` with a board, keymap and kconfig only, and `extraModules` is the one parameter of `nix/zmk.nix:112` that carries a module. The Dockerfile's entry point builds `./config`, so replacing that file needs no new image (the image tag hashes the Dockerfile, and a rebuild is 5 GB). `ensureCheckout` checks `HEAD`, not the tree, so the change doesn't read as drift. The file is written after the "Docker can see the checkout" probe, which is about the template's own file.
- **What it adds:** `extraModules = [ ../keyloom-zmk ]`, `-DEXTRA_DTC_OVERLAY_FILE=<module>/keyloom-cdc-acm.overlay` through `overrideAttrs`, and `kconfig = "glove80.conf;keyloom-<L|R>.conf"` (CMake takes the list), so each half has its own serial template. It builds the same two halves as the template and joins them with the same `combine_uf2`.
- **Corne:** `westScript` appends `-DZMK_EXTRA_MODULES=/work/keyloom-zmk -DEXTRA_DTC_OVERLAY_FILE=...` to each target when the board has a recipe; `-DZMK_CONFIG` already points at `/work/config`, which carries the conf.

### D-132: A half's marker is `keyloom/<12 of the build ID>-<L|R>:<tail>`; the Glove80 gets one template per half, and the module's serial function is opt-in for boards that have none. (Claude, building rung 12)
- **Glove80:** MoErgo's `usb_update_sn_string_descriptor` keeps the template and overwrites its last 16 characters with the chip ID (`app/boards/arm/glove80/usb_serial_number.c:26-39` at `ce69e85`). The half letter can't come from code that isn't keyloom's, so the generator writes `keyloom-L.conf` and `keyloom-R.conf`, each with `CONFIG_USB_DEVICE_SN="keyloom/<12>-<letter>:GLV80-0123456789ABCDEF"`. The observed serials are `moergo.com:GLV80-<16 hex>`, so the length matches the template's last 16.
- **Others:** Zephyr 3.5's default replaces the whole serial with the chip ID (`subsys/usb/device/usb_descriptor.c:304-331`), so the module defines `usb_update_sn_string_descriptor` when `CONFIG_KEYLOOM_SERIAL_OVERRIDE=y`. It copies the template, sets the letter at index 21 from the half's split role (central `L`, peripheral `R`), and writes the chip ID over the last 16 characters. The generator turns the option on for `serialMarker: "usb-sn-override"`.
- **Tried and dropped:** a Kconfig default of `n` when `$(BOARD)` is a Glove80 board. The first Glove80 build failed to link with `multiple definition of usb_update_sn_string_descriptor` (`evidence/rung12`), so the default didn't apply. Opt-in from the recipe is deterministic.
- **Host:** `parseSerial` reads `^keyloom/([0-9A-Z]{12})-([LR])(?::.*)?$` and ignores the chip ID. A firmware file is checked for `keyloom/<12>-<L|R>:` by joining its UF2 payloads in file order, because the linker can place the string across two 256-byte blocks (the rung's real Glove80 build has one that does: a raw byte search found 3 of its 4 templates, the joined payload all 4); a zip is read image by image and every image must carry the same key.
- **Moonlander's QMK marker is unchanged** (D-070): its serial has no letter and no tail.

### D-133: The relay is 1201 baud, and the firmware sets the rate back to 115200 after acting on it. (Claude, building rung 12; S12 may change it)
- **Why a latch:** the host's touch leaves the port at 1201 baud with DTR low, and Zephyr's CDC ACM driver keeps that state. A poll that only checks "closed at 1201" would relay every 250 ms. The module calls `uart_line_ctrl_set(UART_LINE_CTRL_BAUD_RATE, 115200)` after relaying (`cdc_acm_line_ctrl_set` accepts it, `subsys/usb/device/class/cdc_acm.c:795-800`), so the next touch is a change the poll sees. A peripheral does the same on 1201, to forget it. A host-compiled harness (`test/firmware/zmk/module-c.test.ts`) pins this against a scripted port: one relay per touch, none while DTR is high, none when the port is reopened within the 250 ms debounce.
- **1200 needs no latch:** the half restarts.
- **Linux risk:** GNU `stty` may refuse a non-standard rate such as 1201. The rate is one constant on each side (`RELAY_BAUD`, `RELAY_BAUD` in `handsfree.c`). S17 checks it; if it fails, 1800 is the nearest standard rate nothing else uses.
- **Debounce:** 250 ms, from tadakado's module.

### D-134: ZMK halves are found by the owning USB device's serial number, through IOKit on macOS and sysfs on Linux, and two boards' halves are told apart by USB ID. (Claude, building rung 12)
- **macOS:** `serial-macos.ts` lists `IOSerialBSDClient` entries, reads `IOCalloutDevice`, and searches the parents (`IORegistryEntrySearchCFProperty` with `kIORegistryIterateRecursively | kIORegistryIterateParents`) for `idVendor`, `idProduct` and `USB Serial Number`. It opens nothing. Run against this machine's registry it returned no USB serial port (BK's halves run firmware with no port yet); the same search over `IOHIDDevice` entries returned the Glove80's and the Moonlander's serials, so the parent walk is verified and the CDC listing itself is not, until S12.
- **Linux:** `serial-linux.ts` reads `/sys/class/tty/ttyACM*/device/..` for the same three values and returns the `/dev/serial/by-id` link when udev made one. Tested against a fake tree.
- **Trigger:** `stty -f <port> <baud>` on macOS, `stty -F` on Linux (`touchWithStty`). A permission error names the `dialout` group. The test preload refuses any touch under `/dev/` and replaces the default transport with an empty bus.
- **Two boards on one desk:** the Corne has no known USB IDs, so without a rule it would take the Glove80's left half, which carries the same `-L`. A board without IDs of its own ignores ports that another board's recipe claims by vendor and product (`portOfAnotherBoard`), and two ports with the same letter and different builds or paths are refused as ambiguous. A test flashes the Corne with both Glove80 halves attached and checks neither is touched.
- **Unverified:** the Corne's USB IDs (S13 reads them), and how a Corne and a second Corne would be told apart (they can't be; the ambiguity rule refuses).

### D-135: A ZMK flash restarts each half by itself where it can, falls back to the key combo with the reason, verifies each half, and keeps the last verified image. (Claude, building rung 12; mirrors D-072)
- **Per step:** `Uf2FlashInput.hooks.enterBootloader` runs before the wait for the drive. If the drive is already mounted nothing is touched. If the half has a keyloom port, it gets a 1200 touch; if it has none and the recipe allows a relay, the central's port gets 1201. Then it waits up to 15 s for the drive. Any failure (no port, firmware keyloom didn't build, a refused open, no drive within 15 s, a cable that may be missing) is a reason, logged, and the person sees `keyloom couldn't restart the <half> by itself: <reason>. Flash the <half> (n of m). <the board's key combo>`. The 2-minute wait then starts as before. Until the flasher has looked at the ports the instruction is "keyloom is checking...", as for the Moonlander.
- **Order:** the recipe's step order (the Glove80's right half first, MoErgo's order; the Corne's left then right). A half that was relayed to is reached through the left half's port, so the left half still runs its old firmware at that point.
- **Verify:** after the drive unmounts, each half has up to 45 s to come back with `keyloom/<this build's key>-<its letter>`. A different build, a serial that isn't keyloom's, or nothing is a failed flash that names both markers, and the next half is not touched. The summary line `Verified: the right half is running build X, and the left half is running build X.` becomes the flash's `note`, as for the Moonlander. Only a file that carries the build's key is verified; older builds flash as before.
- **Last good image:** a verified half's image is written to `<data dir>/firmware/last-good/<board>/<L|R>.uf2`. Nothing uses it automatically yet; it is the file to flash by hand if a half is stranded (`keyloom flash --reboot-only` does not support ZMK).
- **Stranding:** a half restarted on its cable waits in its bootloader with no time limit; a half on battery returns to typing after 3 s. `keyloom flash` accepts a half already in its bootloader.
- **The Corne's halves share one volume name:** a drive already mounted when its step starts is taken as that half's. keyloom can't tell which half it is, and the old manual flow had the same property.

### D-136: `handsFree` is a block of the `uf2-drives` flash recipe, naming halves by their flash step's label. (Claude, building rung 12; refines the blueprint's example)
- **Why on the recipe, not the board:** a revision has its own flash steps, and a half is only meaningful beside the step that writes it. The blueprint example repeated each step's `volume`; naming the step's `label` removes the second copy that could drift. The schema rejects a half whose label no step has, two centrals, a repeated marker letter, a relayed central and a `serialTail` that doesn't end in 16 hex characters.
- **Fields:** `trigger` (`cdc-1200`), `usbVendorId?`, `halves[] { role, step, marker, usbProductId?, relay? }`, `serialMarker` (`usb-sn-template` | `usb-sn-override`), `serialTail`. The Glove80 gives its IDs (vendor `0x16c0`, left `0x27db`, right `0x27d9`, observed with `ioreg` on 2026-10-15). The Corne gives none.



### D-140: The side column has one width in every mode, and the board is sized to the stage beside it, so a panel opening cannot move the board. (Claude, building D-098)
- **Evidence:** the board's bounding box at 1440×900 is the same before and after a key panel opens ([../research/keyloom-ui-audit.md](../research/keyloom-ui-audit.md) measured a 552 px scroll in v0.10.1). `useFitUnit` reads the stage's width and height, never the window's or the panel's.
- **Chat:** the chat is the side column's third pane. It stays mounted while hidden, so a reply that is streaming or a message that is half typed survives a look at a key. Opening it closes the key panel when the draft is clean, and is refused with a toast when it isn't.
- **Phones:** at 900 px or less the column becomes a sheet over the lower part of the screen. The heights and the half-switcher stay with rung 16.

### D-141: The key panel's tap and hold slots sit on the editor's Draft, so the kind follows from the filled slots and nothing asks for a kind. (Claude, building D-086)
- **Hold:** it is added from a plain key, or from a lone modifier key (which then becomes the tap). Its picker offers Modifiers and Layers only, because those are the two holds the model has. Picking a hold on a home-row key chooses the layout's home-row profile, a layer hold chooses its layer-tap profile, and a person's own choice of profile is kept.
- **Any:** only the free tap slot has it, because an expression is a whole binding. Its answer fills every slot at once.
- **Tabs:** Letters, Punctuation, Modifiers, Layers, Navigation, Media, Function, Macros, More, Any. There is no Mouse tab, because the keycode table has no mouse keys; they arrive through Any as native bindings. Transparent and Nothing are in More.
- **Typing:** with a panel open and its picker closed, a typed character fills the tap slot, digits included. So 1 to 9 switch layers only when no key panel is open.

### D-142: Any is read on the server by the importers' own mappers, and text that isn't an expression is refused. (Claude, building D-087 against the dependency rule)
- **Why there:** the web can't import `src/firmware` (dependency-cruiser). `POST /api/layouts/:ref/parse-binding` runs `mapKey` (QMK, through tree-sitter) or `mapBinding` (ZMK), so Any and an import agree.
- **Refusals:** an empty string, a parse error, a bare number or two ZMK bindings are `ok: false` with a sentence. An import keeps unreadable text as written because the file is the person's; here nothing is, and garbage kept as native would fail the firmware build.
- **Profiles:** a hold-tap whose profile the layout lacks borrows the closest one it has and says so.

### D-143: Kind is carried by shape, selection, draft and remembered marks are separate elements, and layer keys print at most four letters. (Claude, building D-100)
- **Shapes:** a hold-tap's band, a layer key's left edge in the colour of the layer it points at, a macro's play mark, a transparent key's dashes with the key beneath it at 40%, and a none key's hatching.
- **Layer labels:** initials for several words, a short word as it is, three letters for a long one, four when two would clash, and the position when four clash too. The action is one word: hold, toggle, go, once.
- **Marks:** selection (an accent outline and a tick badge), draft (a dashed outline and a dot) and remembered (a bookmark inside the cap) each draw their own element, so all three can show on one key.

### D-144: The legend floor is 11 px, and a legend that doesn't fit is shortened from a table or wrapped at its seams, never shrunk. (Claude, building D-100)
- **Fit:** `fitLegend` takes the unit size and turns the floor into key units. Names break after an underscore, plus or bracket, and only the longest piece has to fit.
- **Tables:** native labels longer than five letters are split at a slash into a tap and a hold, or shortened from a small table (`MSBTN2` is `Btn2`). Space with modifiers is `␣`, so Hyper+Space is `Hyp␣`.
- **Advanced view:** firmware names are long, so they wrap at their seams instead.

### D-145: Non-text contrast is tested for the cap border, the kind fills and the layer colours, with "neighbouring" read as "against the plain key". (Claude, building D-100)
- **Tests:** the border `keyboard.css` really draws is at least 3:1 against the stage; each kind's fill is at least 1.5:1 against the plain key's; the six layer colours are at least 3:1 against both the layer and the plain fill and differ from each other.
- **Why the plain key:** most keys are plain, so it is what every other kind sits beside. Six fills at 1.5:1 from each other would need a luminance range no calm palette has, and shape carries the rest (D-143).

### D-160: The sync engine lives in the `serve` process and is level-triggered: each tick asks "does the keyboard run the head, and is it time?" from the database and the last USB reading, with no event queue. (Claude, building rung 13)
- **Why not events:** the states that make a sync engine wrong are a burst of Applies, an Apply during a sync, an Apply from the CLI (another process), a restart mid-sync and a keyboard that comes back. With a queue each is a special case; with the question asked every 500 ms, each is a different answer to it. The CLI's `change apply` needs no way to tell the server: the engine reads the head from the database, and `notifyApplied` only makes it look sooner.
- **Reading the keyboards:** USB, serial ports and raw HID are read every 5 s while idle, and fresh before any decision to act. A reading seconds old is never acted on, because the keyboard may have been unplugged or reflashed since.
- **A guest in the server:** the tick never rejects. A database that has gone away is reported once, not every tick, and doesn't end the process (found when a demo's data directory was deleted under a running server).
- **A one-shot is not an engine:** `keyloom sync` runs the same code without its timer, and a sync that finishes in a one-shot never starts another by itself.

### D-161: One sync runs at a time in the whole machine, enforced by a row in the database; a burst waits three seconds after the last Apply, and a build for a revision that is no longer the head is stopped. (Claude, building rung 13; refines the blueprint's "queues exactly one more sync")
- **Claim:** `claimSync` takes the one running slot in a write transaction, after finishing any row whose process has died. The server's engine and a CLI `sync` in another process therefore can't both start. A claim over a live process's row is `busy`, which `keyloom sync --wait` waits out.
- **Quiet time:** three seconds from the head revision's own creation time, not from when the engine first saw it, so an Apply made from the CLI counts and a burst stays one burst while it goes on. The wait to the start of a sync measured 3.3 s in the demo.
- **During a build:** the build is stopped (it has touched nothing) and the next sync takes the head. Waiting for it would flash a revision nobody wants, then build and flash again; on the Moonlander that is two 100 s builds. One sync follows, so "exactly one more" still holds.
- **During a flash:** it is never stopped, because a half-written keyboard is worse than a late sync. When it ends, one more sync takes the head.
- **Pause:** stops auto-sync starting anything, and stops an auto-sync's build or a wait for a hand, never a write.
- **Open for BK:** the stopped build is a departure from the blueprint's wording. Turning it off is one line (`supersedeStale`) if a stopped Docker build proves rough in use.

### D-162: Auto-sync turns on for a board once a flash on it went through the hands-free path and was verified, and is then on unless BK turns it off. (Claude, building rung 13; Q16 as the blueprint assumed)
- **Proof:** recorded by `runFlash`, so a flash from the Build and flash dialog counts too. It requires that keyloom itself restarted every part of the keyboard (a half already in its bootloader doesn't count) and then saw the new marker. A flash after a pressed reset key is verified but proves nothing about reaching the board.
- **Choice and proof are separate:** `board_sync.auto_sync` is empty until BK chooses, and auto-sync then follows the proof. `keyloom autosync on` before the proof is a usage error that says how to get one. Pause is a separate flag, so "off" and "paused for now" stay different in the header.
- **Sync now before the proof:** it works; it is the deliberate path that produces the proof.

### D-163: What a keyboard runs is read from its marker, to a build, to a revision; a keyboard is tracked against the layout it runs, and a keyloom build this copy doesn't know is not replaced by itself. (Claude, building rung 13)
- **Lookup:** the marker holds the last 12 characters of the build ID, so the build is found by that suffix, and a collision names no build rather than the wrong one.
- **In sync:** the keyboard's revision is the head, or has an identical document. An edit that was undone is in sync without a build.
- **Behind (n changes):** the revisions between them, or no number when the running revision isn't in the head's history.
- **Other layouts of the board:** edits to a layout the keyboard doesn't run don't start a sync, because that would replace what the keyboard runs. The header says "Your Glove80 runs 'main'" and offers "Put this layout on it", which is Sync now.
- **Unknown build:** a marker with no build in this database (another machine, another data directory) is keyloom's firmware but not this copy's, so it is treated like someone else's: Sync now may replace it, auto-sync never does.

### D-164: A failed build leaves the keyboard alone and is not retried for the same revision; only a verified flash is in sync, and it is verified twice. (Claude, building rung 13)
- **Retried by themselves:** a sync the world interrupted (keyboard unplugged, keyloom stopped, build stopped for a newer head, paused). **Not retried:** a failed build, a failed flash, a flash that couldn't be verified, and a flash that gave up waiting for a hand. A new Apply is a new revision, so it is tried; Sync now tries any.
- **Verified twice:** the flasher saw the marker come back (D-072), and then the engine reads the keyboard once more, so a keyboard that went back to something else is not reported as in sync. A flash of a build with no marker is not in sync, whatever zapp said.
- **Unplugged:** during a build, nothing is flashed. During a flash, the state is Not connected, and the sync is tried again when the keyboard returns. A keyboard left in its bootloader (QMK only; ZMK boot drives need the volume finder) is "Needs a hand" with the way out.
- **Needs a hand:** the flasher's own words, which already say why it couldn't restart the keyboard. They stay on the sync after the flash gives up, so the header still says what to do.

### D-165: QMK keeps its last good image per board revision after a verified flash, as ZMK does per half. (Claude, building rung 13; D-135 for ZMK)
- **Where:** `firmware/last-good/<board>/<revision>.<ext>` under the data directory, written from the verify step so only an image the keyboard was seen to run is kept.
- **Not built:** writing it back after a failed flash. The blueprint promises that; nothing yet reads these files. It needs the same care as a flash (a bootloader that is already open) and belongs with the first real failure to learn from.

### D-166: A restart mid-sync is recovered from the database: a build is over, a flash is counted only by the keyboard's marker, and a build already made is flashed again, not built again. (Claude, building rung 13)
- **Rows:** each sync names its process and the engine instance that runs it. A row whose process has gone, or whose engine is not this one, is finished at start.
- **A flash in flight:** if the keyboard already shows that build's marker it is counted as succeeded, and nothing is flashed again. If not, the sync is interrupted and the next one starts from the build that exists.
- **Late writes:** finishing a sync is a single update that applies only while it is still running, so an old engine's late result can't overwrite what the new one settled. A test holds a flash across the restart and releases it afterwards.

### D-167: Firmware keyloom didn't build is never replaced by auto-sync or by `keyloom sync`; the deliberate way is the flash dialog's existing confirmation. (Claude, building rung 13; D-094)
- **Header:** "Running firmware keyloom didn't build" with Flash keyloom's build, which opens the Build and flash dialog. No second confirmation was invented.
- **CLI:** `keyloom sync` refuses with exit 2 and names `keyloom build` and `keyloom flash --layout`.
- **Not decided:** whether a ZMK board with only one half marked should count as keyloom's. It does not: any half running firmware keyloom didn't build makes the board "not keyloom's".

### D-168: The web follows the engine through `GET /api/events`, a Server-Sent Events stream whose first frame is the current state; the header shows one pill per board, and its menu holds the reason, Sync now, Pause and the auto-sync switch. (Claude, building rung 13)
- **Stream:** each frame is every board's state, so a dropped frame costs nothing and a reconnect starts from a snapshot. Subscribed before the snapshot is read, so no change is lost between them. A comment every 5 s keeps Bun's 10 s idle timeout away. Read with `fetch`, because `EventSource` can't send the session token.
- **Stale answers:** an action's own response is used only when there is no stream. Otherwise it could arrive after a newer frame and put an old state back.
- **Boards shown:** the board of the layout on screen always, and any other that is connected. On a phone the header keeps the layout menu and the state of the board on screen as an icon, in a tone (green, blue, amber, red) and a shape (check, spinner, arrows, warning, plug).
- **Toasts:** a change reaching a keyboard, a failed sync and a need for a hand. The first state after the page opens says nothing.
- **Left alone:** the Build and flash menu and dialog. They remain the manual path, and the only one for a keyboard that isn't keyloom's.

### D-169: Every sync records the times from Apply to a verified flash, so rung 17 is decided by measurement. (Claude, building rung 13; D-096)
- **Recorded:** per sync, the revision's Apply time, the start, the end of the build, the start of the flash and the end. `keyloom sync status --format json` shows the last as `timings_s` (wait, build, flash, apply to verified); `logs/sync-<id>.log` has a line per step with the milliseconds since Apply.
- **Meaning:** the number that decides rung 17 is `apply_to_verified`, over a week of BK's use. A build that is reused (a retry) shows a build time near zero.



### D-150: `Layout.tapDances` is a new array, `schemaVersion` stays 1, and an old document reads as `[]`. (Claude, building rung 14)
- **Rule the codebase already follows:** `schemaVersion` is `z.literal(1)` and has never changed. Macros, combos and profiles were added to version 1, so a field is added with a default and the version is kept for an incompatible change only.
- **How:** `tapDances: z.array(TapDanceSchema).default([])`. Every read of a stored document goes through `LayoutSchema.parse`, so an old row gains the field when it is read and the next revision writes it. `test/persistence/pre-tap-dance-layout.test.ts` loads a revision stored without the key (the web sample fixture, then a database row) and checks the document and the stored JSON.
- **Demo:** the rung 2 run's database (written before this change, no `tapDances`) loads with the new code (`evidence/rung14/demo-migration.log`).

### D-151: A tap dance slot is a key, modifier, layer or macro action, never a hold-tap or another tap dance, and each slot is a function. (Claude, building rung 14; refines D-093)
- **Why flat:** both firmwares' state machines are flat, and a nested hold-tap would need a profile per slot. `SlotAction` is the four binding kinds that mean one action (`key`, `modifier`, `layer`, `macro`).
- **Functions:** `slotFunction` gives the same string a key of its own would (`key:ESCAPE`, `layer:toggle:num`), so reachability, the drop flow of D-092 and `find_function` treat a slot like any key, with no tap dance case. Replacing a tap dance key asks for a `dropFunction` for each slot function that exists nowhere else.
- **Type guard:** `bindingFunctions(binding)` accepts any binding except `tapDance`; a `tapDance` binding needs the layout's `tapDances` as a second argument. A caller holding a general `Binding` can't compile without passing them, which is how the callers that would have silently returned `[]` were found (`tsc` listed them).
- **Layer graph:** `layerTargets` returns every layer a binding switches to; a tap dance can have one per slot, and each is an edge.

### D-152: QMK tap dances are Oryx's state machine, and an empty slot does nothing, as in Oryx. (Claude, building rung 14)
- **Shape:** per entry `on_dance_n`, `dance_n_finished`, `dance_n_reset` around one shared `dance_step`, in `tap_dance_actions[]` with `ACTION_TAP_DANCE_FN_ADVANCED`. The cases are `SINGLE_TAP` (tap), `SINGLE_HOLD` (hold), `DOUBLE_TAP` (doubleTap), `DOUBLE_HOLD` (tapThenHold, which Oryx's UI calls "tap-hold"), and `DOUBLE_SINGLE_TAP` (two quick taps, written from the tap slot). A count of 3 types the tap three times and each tap after that once, because that is what Oryx's `on_dance_n` does.
- **Slot code:** a key or modifier is `register_code16`/`unregister_code16`; a momentary layer is `layer_on`/`layer_off`; toggle, to and one-shot are `layer_invert`, `layer_move` and `set_oneshot_layer`/`clear_oneshot_layer_state`; a macro is its `SEND_STRING` inline.
- **Term:** ZSA's fork has `ACTION_TAP_DANCE_FN_ADVANCED` and `_WITH_RELEASE` only (checked in `quantum/process_keycode/process_tap_dance.h` at the pinned checkout), no variant with a timeout. A `termMs` is written as a `case TD(DANCE_n): return N;` in `get_tapping_term`, with `TAPPING_TERM_PER_KEY` defined, which is where QMK asks (`GET_TAPPING_TERM(active_td, ...)` in `tap_dance_task`).
- **rules.mk:** `TAP_DANCE_ENABLE = yes` is appended when there are entries and it isn't on; `= no` when there are none, no Oryx tap dance code is kept, and it was on, for the reason COMBO_ENABLE is handled (an enabled feature with no `tap_dance_actions[]` doesn't link).
- **Empty slots:** an unfilled hold or tap-then-hold slot types nothing on QMK, as Oryx's generated code does (no `SINGLE_HOLD` case). ZMK differs (S16).

### D-153: The importer trusts a reading only if keyloom's own generator writes the same code back. (Claude, building rung 14)
- **Why:** a tap dance is code, and "plausible but wrong" is the failure that survives review. The importer reads each `dance_n_finished` into slots, regenerates the whole tap dance block from the entries (`renderTapDances`), and compares it with the original after collapsing spacing and writing every key expression by what it means (Oryx nests `LALT(LCTL(LGUI(LSFT(KC_SPACE))))`; keyloom writes the same key in its own order).
- **All or nothing:** if the block differs anywhere (a third step, `wait_ms(20)`, a case it doesn't know, a `get_tapping_term` with other cases), no tap dance is imported, every `TD()` key stays `native` and the code stays in `Passthrough`, and the report says so. Partial import would need the shared `dance_step` and `dance_state[]` split apart.
- **Names:** an imported entry is `dance-n` / "Tap dance n". The C has no place for a name, so a tap dance made with another id or name is written as `DANCE_n` by position and comes back as `dance-n`. Macros behave the same way (`ST_MACRO_n`).
- **DF0 stays native:** `DUAL_FUNC_0` is `LT(5, KC_4)` with a `process_record_user` case: tap sends F5, hold calls `layer_move(5)` on press and on release. It isn't a tap dance (there is no double-tap), and as a hold-tap it would be `LT(5)` momentary, which is a different behaviour (the layer would leave on release). It stays `native` with its code kept.
- **Per-key terms:** the importer reads `get_tapping_term` into `termMs` only when every case is a `TD(DANCE_n)` and the default is `TAPPING_TERM`.

### D-154: ZMK tap dances are `zmk,behavior-tap-dance` with a generated tap-preferred hold-tap in each position that has a hold, and the ZMK importer does not read them back. (Claude, building rung 14; refines D-093)
- **Positions:** tap, then double-tap. A hold slot makes position one a hold-tap `<id>_hold` (`&kp`/`&kp`, `&mo`/`&kp` and so on, chosen from the slot kinds); a tap-then-hold slot makes position two `<id>_tap_hold` with the double-tap as its tap (`&none` when there is none). A macro or layer slot is its behaviour, and a hold-tap given a behaviour that takes no parameter gets `0`.
- **Terms:** the dance and its hold-taps use `termMs`, 200 ms when it is unset (ZMK has no global tapping term to fall back on).
- **Measured against QMK (S16):** the keys typed agree for tap, double-tap, hold and tap-then-hold. The feel differs in six ways, listed in S16; the generator was not changed to hide them. The one fix tried, a 10 ms hold-tap term in position one, made the hold fire at 211 ms like QMK, but a key pressed while the dance key was held then typed `U` and `Shift+U` instead of `U` and a late Esc, which is worse.
- **Not read back:** the ZMK importer keeps a `zmk,behavior-tap-dance` node as written, as before. Layout Editor exports carry MoErgo's own tap dances (`layer_td`), whose bindings keyloom doesn't model.

### D-155: A macro can have a text step, typed on a US layout. (Claude, building rung 14; completes D-088's model)
- **Model:** `{ op: "text"; text: string }`. QMK writes it as a C string literal in `SEND_STRING` (the firmware adds Shift); the importer reads a literal back, so Oryx's `SEND_STRING("hello")` is now a text macro and no longer native. ZMK writes one `&kp` per character, `LS(...)` where Shift is needed.
- **One check for both:** `textKeys` accepts the US letters, digits, space, tab, newline and the printable punctuation, and names the first character it can't type. `macro_text_untypable` is the validator error; the generators throw the same sentence.

### D-156: What the validator says about tap dances. (Claude, building rung 14)
- **Errors:** `unknown_ref` for a missing entry, layer or macro; `schema` for a repeated id; `firmware_unsupported` for a key keyloom doesn't know; `qmk_tapdance_mixed_hands` for left and right modifiers in one slot (QMK stores one hand bit); `tap_dance_slot` for a momentary layer on the tap slot (it ends when the dance does); `qmk_combo_tapdance` for a combo whose output is a tap dance (QMK combos can't run one; a tap dance key is fine as a combo input); `tap_dance_native_conflict` for adding a tap dance beside Oryx tap dance code that was kept as written.
- **Warnings:** `tap_dance_same_action`, in people's words ("Key 4 on Base: tapping and double-tapping do the same thing, so the extra slot adds nothing."), for any two slots with the same function, only when the change adds or alters it. `doubled_letter_tapdance` now reads a modelled tap dance's tap slot as well as a native one.
- **Diff:** a key whose tap dance entry changed counts as changed, though its binding didn't, so the decision memory, the selection check and the preview see it.

### D-157: A tap dance key is `TDn` in the text grid, with a legend under the grids, as macros are `Mn`. (Claude, building rung 14)
- **Why:** a grid cell is six characters. Two slots don't fit, and a cell that cuts "HypSP…" says nothing. `layout show` and the agent's `get_layout` print `TD0 … TD2` and, below the last grid, one line per entry: `TD2  Esc, Caps Lock on double-tap: Esc tap, CAPS double-tap`. The graphical cap shows the tap large and the other slots small.

### D-158: The QMK emulator counts time with QMK's own clock. (Claude, building rung 14)
- **Found by S16:** the harness kept its own count of elapsed time, so a `wait_ms(10)` inside the firmware (Oryx's tap dance reset has one) pushed every later scripted event 10 ms late, and a run of 20 scenarios drifted 110 ms. Events now wait for `timer_read32()`; nothing else in the harness changed, and the earlier emulator tests give the same reports.


### D-170: Going back to any revision is one new `undo` revision that holds that revision's document; undoing it puts the later work back. (Claude, building rung 16; D-102, D-015)
- **How:** `POST /api/layouts/:ref/undo` takes an optional `to`, with `revisionId` still naming the head the page saw, so a stale tab gets a 409. The new revision's parent is the head and its document is the target's, so history stays append-only and linear. It reads "Back to: <summary>", with any "Back to", "Redo" or "Undo" prefix of the target removed so going back to an undo doesn't stack words.
- **Validation:** the target's document goes through the document rules, and only a problem the head doesn't already have refuses it (`validation_failed`, 409). That is the rule `evaluate` uses for a change, so a layout imported with a flaw stays restorable. No schema change: `undoes_revision_id` names the revision just after the target on the way to the head, which makes the existing memory rule (an undo follows its undone revision's parent) restore the target's decisions.
- **Memory:** decisions of every change set after the target are suspended, newest first. Oldest first left a decision that a later change had superseded active, because suspending the later change returned it to hypothesis after the earlier change had already been passed over. `test/app/choices.test.ts` covers going back two changes and undoing that.
- **Keys:** ⌘Z and ⇧⌘Z are the toolbar's Undo and Redo, so after an undo ⌘Z says "Nothing to undo" and ⇧⌘Z puts the change back (an undo of an undo is a redo, D-015). Going back further is the History panel's job.
- **Not decided:** whether ⌘Z should keep stepping back after an undo, as an editor's does. That needs the undo stack to be separate from the revisions.

### D-171: The browser imports by posting the file's bytes to `POST /api/import?board=&filename=&name=`, which writes them to a private temporary folder and runs the CLI's `importLayout`. (Claude, building rung 16)
- **Why bytes in the body:** `application/octet-stream` is a type a plain HTML form can't send, so the write is as closed to other sites as the JSON ones, on top of the token. The body limit rises to 8 MB for this one route; the JSON routes keep their own 1 MB check.
- **Files:** `.zip` and `.keymap` only, by extension, because that is how the importers tell a source apart. The name is stripped to its last path segment and safe characters. The temporary folder is removed whether the import worked or not.
- **Cards:** `GET /api/boards` lists the boards; each card's words come from the importer ids in `board.json`, so a board with a known importer needs no web change. One file at a time: a `.conf` beside a `.keymap` is not sent, because the importer reads it only for a few firmware settings.

### D-172: "Flash this revision" opens the Build and flash dialog on that revision, and warns when auto-sync would put the head back. (Claude, building rung 16; D-102)
- **How:** the dialog takes the revision to build (`POST /api/layouts/:ref/builds` already took one) and says "From an earlier revision". With auto-sync on for the board, it says auto-sync will put the latest layout back soon after the flash and offers Pause, which calls the existing pause route. Paused, it says the keyboard keeps the revision and where to resume.
- **Not done:** pausing is not automatic, and nothing stops a sync of the head from running between a flash and the click on Pause. The warning is shown first, before any build.

### D-173: The provider picker writes `<data dir>/config.json` through `POST /api/chat/provider` and applies to the next conversation; a flag or `KEYLOOM_PROVIDER` outranks it and the picker says so. (Claude, building rung 16; D-111, 19)
- **Why:** BK asked for the provider to be changeable in the web app (`provider-picker-in-web`). The file already existed for this and `--provider` and the environment already outranked it, so the status carries `lockedBy` instead of the picker pretending a choice applied.
- **Choice:** any of the three, with or without a credential; one without says what it needs and still saves, since keys are read at start. A model BK didn't type is not written, so the default can change later. Effort and other keys in the file are kept, a file keyloom can't read is left untouched and reported, and the write goes through a rename.

### D-174: On a phone the side panel is a bottom sheet of three heights, and a split board shows one hand with a Left and Right switcher and a swipe. (Claude, building rung 16; 18#phones-and-narrow-windows)
- **Sheet:** peek, half (under half the window, 460 px at most) and full. A drag on the grabber snaps to the nearest, a tap on it steps, the arrow keys and two buttons in its bar do the same, and the sheet's height is the room the board keeps below it, so a key opened under the sheet is scrolled above it. Half is the height a panel opens at.
- **Halves:** the canvas, trays, caps and arrow-key movement follow the one hand; the half follows the key being edited. A swipe is a mostly sideways touch drag (48 px and twice the vertical). The board does not scroll sideways on a phone, so the swipe has nothing to fight.
- **Caps:** a cap is drawn 40 px wide at the board's 44 px key unit, which is the size one hand fits at 390 px, and hit as 44 px by an invisible rim on touch devices. Making the drawn cap 44 px means a Moonlander hand scrolls sideways at 390 px.

### D-175: States say what to do next: skeleton caps from the last board seen, the tip in the stage's flow, a missing credential before anything is typed, and disabled reasons as text. (Claude, building rung 16; 18#states-say-what-to-do-next)
- **Skeleton:** the shape of each board is kept in the browser after it first loads, so every later first load draws that board's own caps (one hand on a phone). The first visit gets a generic split board.
- **Tip:** it sits above the board instead of over it. At 1280×577 it covered the top row of keys; now the board is a row shorter while it shows. A notice that appears while editing (why Undo is off) goes in the toolbar's own row on a wide screen and over the stage's top edge on a phone, so it never pushes the board.
- **Credential:** the chat drawer shows the three ways to set one up as soon as it opens, and Send says why it is off. A conversation already started keeps working on its own provider.

### D-176: A stored assistant message with no text is not a turn. (Claude, building rung 16)
- **Why:** an assistant turn made only of tool calls rendered as an empty "keyloom" label when a conversation was reopened (`tool-only-messages-blank`). `fromConversation` drops them before it hangs proposals and priorities on the last reply, so neither lands on a message nobody sees.

### D-177: ⌘C and ⌘V on keys are left to rung 15, and the glyph sets to a later pass. (Claude, building rung 16)
- **Why:** copying and moving keys is rung 15's scope. The theme toggle already exists, and a glyph setting has no reader until the Advanced view's names are settled.

### D-180: A layer may carry a short label (at most four characters) and a colour (one of six), stored in the layout document as two optional fields, and three ops edit layers: `setLayerStyle`, `duplicateLayer` and `moveLayer`. (Claude, building rung 15; D-090)
- **Schema:** `LayerSchema` gains optional `shortLabel` and `color`. A document without them parses as before and `schemaVersion` stays 1, so nothing was migrated. No generator reads either field; they are display only, like the position-picked colour they replace. A layer re-imported from firmware loses them, because firmware has nowhere to keep them.
- **Why in the document, not the browser:** the tabs, the layer keys on caps and the agent's descriptions all read the same label, and a label kept in one browser would differ between the laptop and the phone.
- **Ops:** `moveLayer` names the layer to go after, by id, and refuses to move the base layer or put anything before it. `duplicateLayer` copies the bindings under a new id and name, and not the look. `setLayerStyle` sets both fields, `null` clearing one. Bulk convert needs no op: it is a `setBinding` for each transparent (or none) key, in one change set.
- **Default colour:** the layer's place in the list picks one of six, as before. A chosen colour is kept when layers move.

### D-181: A layer a change adds is a warning when nothing switches to it yet, and a layer that was reachable and stops being so stays an error. (Claude, building rung 15; D-090)
- **Why:** `layer_unreachable` refused every added or duplicated layer, so the tabs' "+" and Duplicate could never succeed on their own. A new layer has lost nothing by being out of reach. The warning says "Add a key that switches to it before you rely on it", and once the layer exists, putting keys on it is no worse than before, so it stays editable.
- **New layers go last.** Add and Duplicate append, because a layer inserted earlier moves every layer after it and custom code that names layers by number would point at the wrong ones.
- **Observed on BK's layouts:** both his Moonlander and his Glove80 carry custom code that numbers layers (`refersToLayerIndices`), so Move left, Move right and Delete are refused with "Your custom code refers to layers by number" (`passthrough_layer_index`). That includes deleting a layer just added at the end. The refusal is the validator's and is shown as it words it. Reordering works on a layout without such code (the Corne sample).

### D-182: A key is dragged onto another on the same layer to swap them, or with Option to copy; a mouse starts after 5 px and a finger after a 380 ms long press, and a cap does not scroll on a touch screen. (Claude, building rung 15; D-091)
- **Touch:** a finger that moves before the long press is a swipe or a tap, so the phone's half switcher keeps working. On a coarse pointer a cap sets `touch-action: none`, so the browser doesn't scroll away under the drag, and the context menu is suppressed.
- **Across layers:** drag does not cross layers. Swap in the key panel does, in two clicks from an open panel, and the board lets the layer tabs be used while it waits.
- **Why a hook, not HTML drag and drop:** that API doesn't fire for a long press on most touch browsers, and the same code has to serve the mouse.

### D-183: Selecting several keys is Shift-click or Cmd-click, or taps in "Select keys" mode on a screen with no Shift, and it is the same selection the chat shows as chips. (Claude, building rung 15; D-089)
- **First Shift-click:** it takes in the key whose panel is open, so "click J, Shift-click K" selects both, which is what makes a combo five clicks.
- **One selection:** the chat's "Asking about" chips and the selection bar are one set of keys on one layer. Keys picked with the chat closed are there when it opens.
- **Order:** positions are kept in board order, whatever order they were clicked in.

### D-184: The combo panel opens its output picker on Navigation, names the combo from its output, refuses a second combo on the same keys and layers, and draws a combo as a pill on a line that stops short of the key legends. (Claude, building rung 15; D-089)
- **Navigation first:** Esc, Enter, Tab and Backspace are what combos usually send, and they are on that tab, so two keys and Esc is five clicks with no search: select key 1, Shift-click key 2, Make a combo, Esc, Add combo.
- **Name:** "Esc combo", then "Esc combo 2". The name is editable under More.
- **Conflicts:** two combos on the same keys on overlapping layers can only be honoured once by the firmware, so the panel says which one already exists. The same keys on layers that don't overlap are two combos. BK's own J+K already makes `{` on his Moonlander, so the demo uses N+M.
- **Lines:** each side of the shape stops 0.3 key units short of a key's middle so it doesn't strike through the legend. Two keys make a line and three or more a loop joined in angular order around their middle. The label is upright at 11 px, so it reads on the Moonlander's tilted and the Glove80's fanned thumb keys. A phone draws a combo only when all its keys are on the hand showing.

### D-185: A move that would drop the only copy of a function asks first, in the key panel's words, and one that is refused says why. (Claude, building rung 15; D-092)
- **Why:** paste, drop, typed keys and deleting a layer can overwrite or remove a function that exists nowhere else. The change is tried first; if the only thing wrong is `function_lost`, a dialog names the functions and "Replace and drop" sends the same change with `dropFunction` ops. Any other refusal is shown as the validator words it.
- **Deleting a layer** lists everything that points at it (keys, hold-tap holds, tap dance slots, combo outputs and combos limited to it) and the validator refuses while any is left, so the list and the refusal agree.

### D-186: Quick assign is a mode the selection bar starts with "Type to assign", and a run is one change set applied with Enter. (Claude, building rung 15; 09)
- **Why not always on:** a stray key typed with keys still selected would rewrite them and make a revision. The typed keys show on the board as a draft; Backspace takes one back, Esc cancels, and keys beyond the selection are refused with a note.
- **Which keys:** a printable character is the key of that name; anything else is ignored with a note. A shifted character is the plain key, as the key panel's typing already does.

### D-187: A layer key's toggle is "tog", legends never break inside a word, and a phone's legend floor is 10 px. (Claude, building rung 15; D-144)
- **Fixes:** `docs/issues/legend-breaks-mid-word.md`. "toggle" needs 3.6 em and a 1 u cap has 31 px at the phone's 40 px unit, so it wrapped as "toggl / e". The stylesheet no longer breaks anywhere but a legend's seams. Every action word is tested to fit a 1 u cap at both floors.
- **Measured:** at 1440 × 900 no Glove80 legend renders below 11 px (96 legends, smallest 11 px).

### D-188: A layer name written with underscores reads as words (one_shot is "One shot"), wherever the layer is named for a person. (Claude, building rung 15; D-090)
- **Scope:** the tabs, the layout summary, the dialogs and the sentences the viewer builds. The stored name is untouched and the rename field shows it as stored. A name with spaces, or none, is left as written.

### D-189: Copy and paste use keyloom's own clipboard, not the system one. (Claude, building rung 15; D-091)
- **Why:** what is copied is a binding, which has no text form that pastes anywhere else. Cmd-C and Cmd-V act on the selected keys or the open key and leave the browser's copy alone when text is selected or a field has focus. Paste reaches the selected keys, or the open key when none are selected, and a key that already does it is skipped.

### D-159: The key panel makes tap dances and macros from slots, and the macro builder saves as it goes. (Claude, rung 14 part 2)
- **One change set:** the draft keeps the tap slot's kind and adds `doubleTap`, `tapThenHold`, the dance's id and term, and the macros made in the picker. `keyChange` turns it into `upsertMacro`, `upsertTapDance`, the key's `setBinding`, and a `removeTapDance` for the dance the key had if nothing else uses it, in that order. Clearing both extra slots goes back to the plain or hold-tap key with the tap and hold as they were; a function the dance alone held asks to be dropped through the existing flow (D-092), since every slot is a function (D-151).
- **Shared items change for this key only, unless told otherwise:** a tap dance or macro that other keys use is copied under a new id when this key changes it. "Every key that uses it" is a switch beside the timing sentence (dance) or a choice in the Macro tab, and shows only when other keys use the item. The spec's modal question became an inline choice because the builder saves as it goes.
- **The builder saves as it goes:** each pick updates the draft, so Apply works without Done and a three-key macro is six clicks (key, Macros, three picks, Apply) where the spec counted Done and left Apply out. Done only closes the picker. A chord is one pick when typed ("cmd tab, wait 100": modifiers, key and the wait after it), so the modifier buttons are for the mouse. Macros the builder can't show (press and release steps) are listed in words and used as they are.
- **Caps:** `Legend` gains `double` and `tapHold`. The double-tap is bottom-right after a ⇈ mark, a tapped-then-held slot is three dots at the top centre (the corners are taken by the macro mark, the draft dot, the bookmark and the tick), and a tap dance has its own fill (`--cap-dance`). The 11 px test now measures the double-tap at half a cap's width.
- **Library:** a toolbar button opens a pane of macros, tap dances and timing profiles with each one's keys; hovering a row outlines its keys on the board. It shares the side column with History, so opening one closes the other. Reuse is from the picker: "From library" in the Macro tab and a Tap dances tab.
- **`macro_looks_like_secret` did not exist** despite 07 and 16 saying keyloom already warned. It is now a warning on a text step of eight or more characters with no spaces and three of the four character kinds, shown once per macro and only when a change adds it.
- **Not done:** a stored layout whose Oryx tap dances are native still can't gain a tap dance; the panel says so on those keys and how to import again. Upgrading on read stays BK's call.

### D-190: A layer's LED colours are stored on the layer as a colour for the whole layer and colours for single keys, in QMK's HSV, and the board says which LED sits under which key. (Claude, building rung 18; D-104)
- **Model:** `Layer.lighting` is `{ layer?: [h,s,v], keys?: { "<position>": [h,s,v] } }`. A key's colour is its own, else the layer's, else dark. Absent `lighting` means the layer sets no colours and the keys show the board's light effect; `lighting: {}` is a layer that is dark on purpose. `board.json` gains `lighting.ledPositions`, LED number to key position, which for the Moonlander is read from `rgb_matrix.layout` and `layouts.LAYOUT` in the pinned ZSA `keyboard.json` (firmware25, 93b2b9e) by matching matrix coordinates, the same table for rev A and rev B. Ordering the colours by LED number instead of by position would colour the wrong keys and build fine, which is why the table is data and a test pins it.
- **Generation:** the ledmap, `set_layer_color()` and `rgb_matrix_indicators_user()` are written in Oryx's own text, whitespace included, with one `case` per coloured layer by its index in `keymaps[]`. The helper and post-init (`hsv_to_rgb_with_value`, `keyboard_post_init_user`) stay passthrough when they came from Oryx and are added when the first colour is made in keyloom. With every colour removed the ledmap and indicators go and the helper stays, so the matrix is still switched on.
- **Import reads Oryx's colours only when they write back exactly:** the three blocks are read into the model, rendered again, and compared with the text read. Anything else (a hand-edited ledmap, a changed `set_layer_color`) stays passthrough with a warning, and keyloom refuses to add colours beside it, because the C would define the names twice. On BK's export the four coloured layers import and the regenerated section is identical to Oryx's, character for character (`test/firmware/qmk/lighting.test.ts`). A bonus: layers can now be reordered without the ledmap pinning the order.

### D-191: The settings page offers options whose defaults were read from the pinned firmware, writes feature switches to rules.mk, and keeps hold-tap profiles that copied an option in step with it. (Claude, building rung 18; D-103)
- **Which options:** QMK: tapping term, permissive hold, hold on other key press, chordal hold, retro tapping, combo term, one-shot timeout, Caps Word and its timeout, Auto Shift and its timeout, mouse keys. ZMK: combos held at once, macro wait and tap length, idle timeout, deep sleep and its timeout, pairing passkey, mouse keys. Each default is from ZSA's firmware25 (`action_tapping.h`, `process_combo.h`, `caps_word.h`, `process_auto_shift.h`, `action_util.c`) or MoErgo's Kconfig as built into the Glove80 image; none is remembered. A QMK board never sees a ZMK option and the reverse. The Moonlander's mouse keys default to on (`settingDefaults` in `board.json`), because its `keyboard.json` enables the feature.
- **Caps Word, Auto Shift and mouse keys are rules.mk switches in QMK,** not config.h defines, so the generator writes them to rules.mk as `KEY = yes` after Oryx's lines (make takes the last) and never to config.h, where they would do nothing. What the layout does with no setting is Oryx's rules.mk where it says, else the default; turning a switch off that Oryx's rules.mk turns on writes an explicit `no`, since removing the setting would leave it on.
- **Untouched options write nothing:** an option at its baseline is removed (`removeFirmwareSetting`), not written as its default. Options Oryx already sets (`CHORDAL_HOLD`, `PERMISSIVE_HOLD`, `USB_SUSPEND_WAKEUP_DELAY`, `LAYER_STATE_8BIT`, `RGB_MATRIX_STARTUP_SPD`) import as settings as before, and the page lists the ones it has no control for read only, with rules.mk's switches and the code kept as written, so nothing is hidden.
- **Profiles that copied the old value follow the edit.** Import copies tap-hold options into the profiles, and QMK would otherwise emit `get_tapping_term` per key to undo a change of the layout-wide one on exactly the keys the person meant to change. A profile whose value differs from the old setting keeps it, and the page says so.
- **One change set:** the sliders and switches stage; Apply sends every staged option and layer colour in one check and one revision.

### D-192: An LED colour shows on its cap as a 6% wash and a bar along the top edge. (Claude, building rung 18; D-104)
- **Why 6%:** `test/web/led-contrast.test.ts` mixes every hue (every fourth hue at full, half and no saturation, and two brightnesses) into every cap tone in both themes and holds the legend to 4.5:1. At 8% the worst case is 4.46:1 and at 12% it is 4.08:1, both on the dark theme's custom-code tone (6% gives 4.67:1); the bar carries the colour. The key panel's Colour control is a separate footer control beside Swap, Copy and Paste and saves on its own, since a colour has nothing to do with what the key sends.

### D-193: A stored layout's Oryx colours and tap dances are read into the model only when asked, with one button or `keyloom layout upgrade`, as one revision. (Claude, building rung 18; rung 14)
- **Never on read:** `getLayout` and every other read leave a stored layout as it is. keyloom does not change BK's layout without an action from him; a first draft that wrote a revision on the first read was replaced by this.
- **The offer:** when the head still holds Oryx code the current importer models, the layout summary says "This layout has Oryx colours and tap dances keyloom can now edit." (only the part that applies) with an "Update layout" button. The settings page shows it above the layer colours and a native `TD()` key's panel shows it, so the place that needs it points at it. Two readings count: the layer colours (`import-lighting.ts`, trusted only when the ledmap and its helpers re-render to the same text) and the tap dances (`import-tap-dance.ts`, trusted only when keyloom's generator writes the same code back). The check is read-only and rides in the layout detail the page already loads.
- **The action:** `upgradeLayout` appends one revision, "Read colours and tap dances from the Oryx code" (or just "colours", or just "tap dances"), origin editor, so it appears in History and undoes like any change. It refuses, and writes nothing, if the upgraded document doesn't parse, breaks a rule the old one kept, or no longer generates. Native `TD(DANCE_n)` keys and combo outputs become tap dance bindings and the consumed passthrough goes; if any `TD()` key would be left native it reads nothing. On a layout with nothing left to read it writes nothing and says so.
- **Replaces** `docs/issues/stored-oryx-tap-dances-stay-native.md`, which asked for exactly this and left the question of asking first to BK.

### D-194: The Glove80 has no lighting in the model. (Claude, building rung 18; D-104)
- **Why:** its lights are ZMK underglow, which is a strip with effects and no per-key colour, and the model has nothing to hold it. Its page shows the ZMK Kconfig options only, and the Layer colours section appears only for boards with `lighting`.

### D-220: The agent sees every layout, and BK can say "copy this from my other keyboard". Q4 is answered. (BK. Reverses Q4's "deferred")
- **BK:** "I think the agent shoudl be able to see the layouts of other keyboards. and it should be possible for me to say copy this thing from my other keyboard and apply it here and it should have the smarts to figure out the best way to do it even if the keyboards have differnt number of keys or differnt layouts".
- **Context:** in his v0.19.0 Glove80 chat he asked for the key lights to be like his Moonlander's. The agent said it couldn't see the Moonlander, asked for an Oryx link or screenshots, and offered to "set per-key colours on each layer here", which the Glove80 can't show.
- **What it adds:** `list_layouts`, `get_layout` with a `layout` argument, and `map_keys`. Other layouts are read-only; every proposal targets only the conversation's layout and validation is unchanged (D-014).
- **Q4** ("carry a typing profile from one board to another") was deferred, not rejected. This is it, narrowed to what BK asked for: copying a named thing, not inferring a typing profile.

### D-221: Which key corresponds to which is decided by pure code, not by the model. (Claude, building rung 19)
- **Why:** counting positions across a 72-key, an 80-key and a 42-key board is where a plausible mapping is wrong and passes review. `mapKeys` returns each match with a method, a reason in words and a confidence, and lists keys with no counterpart instead of forcing them.
- **Strategies:** `function` (the key that does the same thing), `position` (hand, finger, row from the home row, column from the finger's home key, thumbs by rank from the middle) and `auto` (function, then position on target keys nothing claimed).
- **Deterministic:** slots come from geometry and the board's facts, rows are ordered by height, and ties break by position number. Shuffling `hands`, `fingers`, `rows` and `mirror` changes nothing, and a test shuffles them.
- **Option rejected:** letting the model match keys from two grids. It is what the old chat would have done, and it cannot check itself.

### D-222: Another layout is shown the way a fresh import would read it, in memory only. (Claude, building rung 19; D-193)
- **Why:** BK's stored Moonlander holds its colours and two tap dances as Oryx code until he clicks "Update layout". The agent would see no colours to copy. `upgradeStoredOryx` is pure, so the port applies it to the copy it hands the agent.
- **What does not change:** nothing is saved. D-193's "never on read" is about changing the stored layout, and this changes nothing stored. The conversation's own layout is not previewed, because its head is what proposals apply to.

### D-223: Layers correspond by name, role and what they do, one-to-one, best first. (Claude, building rung 19)
- **Signals:** name (equal 1, shared stem 0.7, a name with a number only exactly), role (base is base), and Jaccard overlap of functions leaving out layer switches, macros and native code. The strongest sets the score; under 0.3 is no match.
- **Why one-to-one:** two source layers claiming one target would copy both onto it.
- **Layer keys follow the match:** a layer key copied across points at the matching layer, or is skipped with the layer's name.

### D-224: What a board cannot do is a fact in `board.json` that the agent, the prompt and the validator quote. (Claude, building rung 19)
- **Where:** `limits.lighting`, one sentence, present when `lighting` is absent. `src/boards/capabilities.ts` derives per-board capabilities; the prompt and `list_layouts` state them; `lighting_unsupported` now says "<board> can't show per-key colours because <reason>".
- **Agent rule:** never offer or propose what the board can't do. State the reason and stop.
- **Not added:** a validator error for combos, tap dance or macros. Both firmwares model them, so there is nothing to refuse.

### D-225: The Glove80 does not get lighting. (Claude, building rung 19, S21; D-194)
- **Evidence:** MoErgo's fork at `ce69e85` fills one pixel buffer with one effect and overlays fixed-colour status LEDs, on the left half only; the layer indicator is magenta. Per-key, per-layer colour exists only in the open community pull request `moergo-sc/zmk#36`, on a different base. See [../research/spikes/S21.md](../research/spikes/S21.md).
- **Result:** no model, no generator, no Docker proof. Copying colours onto the Glove80 ends in the board's sentence and no proposal.
- **Open:** whether BK wants the community fork (Q24).

### D-226: Copying a behaviour keeps the target key's letter, takes the target's hand, and never replaces what the key already does. (Claude, building rung 19)
- **Rules:** a hold-tap keeps the target's own tap and takes the source's hold, with modifiers of the hand the key is on (D-060). Layer keys map through D-223. Macros and tap dances come along, reused when the target already has the same steps. Native code is never copied (D-024).
- **Profiles:** the key's own, else its finger's, else its hand's. With none, a ZMK profile per hand that waits for the other hand and the thumbs, with the source's tapping term when it has one; a QMK target reuses what it has. A skipped key leaves no macro, dance or profile op behind.
- **Replacing:** if the copy would remove a function the target key has, the key is skipped and named, so the agent asks BK where it should go.

### D-227: The Corne's finger table was one column off and is fixed. (Claude, building rung 19)
- **What was wrong:** `boards/foostan/corne/board.json` marked its outer column as the pinky and the pinky column as the ring finger, so A, S, D, F were ring, middle, index, index. Nothing read it until key correspondence did. Q, W, E on the Corne's top row sit on the pinky, ring and middle fingers.
- **Found by:** a test that asks the letters A S D F for their fingers on all three boards. It fails on the old file.

### D-228: A position match is weaker evidence than a function match, and a guess is not applied without BK. (Claude, building rung 19)
- **Numbers:** function 0.95 under the same finger, 0.85 elsewhere, 0.8 and 0.7 for first-function matches; position 0.7 for an exact slot, 0.5 down to 0.3 for a nearer column, thumbs 0.5 or 0.4 (0.4 when the two boards have different thumb counts).
- **Floor:** `carry` applies matches of 0.6 and over. The rest are shown with their confidence so the agent can ask.
- **Why:** an earlier first draft gave exact positions 0.9, and put Moonlander F12 on Glove80 F13 because they sit in the same place.

### D-229: The agent asks only where a copy is genuinely ambiguous, and says which mapping it used. (Claude, building rung 19)
- **Ask when:** a match is under 60%, several keys fit equally, a layer has no counterpart, or a key's target already does something else. Ask together, and say the default.
- **Always say:** the mapping used, in plain words, in the reply and in the proposal's explanation; what didn't carry over.
- **Evals:** three live scenarios on OpenRouter, all passing (see [20](20-cross-board.md#evals)). Colours onto the Glove80: it explains why, proposes nothing and asks for no link. Colours onto a second Moonlander: a valid proposal, every colour on the same key. Home row mods onto the Glove80: a valid proposal on home-row keys only with each finger's modifiers in profiles that wait for the other hand.

## BK's promise, the MacBook keyboard and new keyboards (2026-10-15, after v0.19.1)

BK stated the product in his own words: "I can now configure all my keyboards from one software. You know how nice Oryx is to use, I took that UX and now configuring any of my boards feels like oryx. And then you know how you don't have to reboot of anything when using vial? I added that so now for any of the keyboards I just change the keys and that's it, not bootloader nonsense. When I don't like something I don't have to break my brain trying to think how to do it or whee to put the key and all that. I just tell it what I want and because it can see my keyboard it will figure it out and make some suggestions to me. If I get a new keyboard I just connect it and say put my config on this. Doesn't matter what keyboard it is as long as it uses ZMK or QMK." Then: "I would like to have the features that karabiner has or if I install karabiner elements kanata, this configurator should be able to configure that as well so that I can get my macbook keyboard to behave like the other keyboards."

### D-230: A MacBook's built-in keyboard is a keyloom board whose firmware is a software remapper's config, applied by writing the file and reloading it. (BK)
- **Why:** it gives the laptop keyboard the same layers, home-row mods and combos, and applying is instant with no flash.
- **Research:** [../research/software-remappers.md](../research/software-remappers.md). Chapter [21](21-macbook-keyboard.md).

### D-231: kanata first; Karabiner-Elements only if kanata fails its spikes or BK asks. (BK, from the research's recommendation)
- **BK chose:** "kanata (Recommended)".
- **Why:** positional layers like keyloom's, tap-hold variants that match QMK's, `--check`, a simulator and a reload that reports success. Karabiner has no permissive hold and no read-back.
- **Cost:** a one-time root LaunchDaemon install that BK runs himself; keyloom never holds sudo.

### D-232: BK's hand-written Karabiner rules are imported as the MacBook's starting layout, then disabled for the built-in keyboard, never deleted. (BK)
- **BK chose:** "Replace with keyloom's (Recommended)".

### D-233: keyloom writes its own `keyloom.kbd` outside BK's dotfiles and never edits `karabiner.json`. (BK)
- **BK chose:** "No, keep it separate (Recommended if kanata)".

### D-234: Space stays a hold-layer key on the MacBook. (BK)
- **BK chose:** "Yes, Space-hold layer (Recommended)". Thumb-layer keys mapped from his other boards land there first.

### D-235: The MacBook remapper can never lock BK out. (Claude, from the research)
- kanata's exit chord stays active and is proven once with BK before auto-apply; `--check` before every reload; `safe.kbd` disables remapping without sudo; the validator treats Esc, Control and every layer's way back as required; `--release-grab-on-lock`; keyloom never emits kanata's `cmd`.

### D-236: keyloom builds a board definition from a keyboard it sees on USB, asks BK only what it can't derive, and puts a chosen layout on it through the cross-board mapping. (BK)
- **Research:** [../research/new-keyboard.md](../research/new-keyboard.md). Chapter [22](22-new-keyboard.md).
- **Stays manual:** the first flash of any new board, and naming a ZMK board when its product string doesn't settle it.

### D-237: Two corrections from the new-keyboard research: VIA has no bootloader-jump command (only Vial does), and the keyboard-state reader's ZSA-only vendor check is generalised in rung 21. (Claude, from the research)
