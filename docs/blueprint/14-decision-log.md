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
