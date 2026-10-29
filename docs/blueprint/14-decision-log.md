# 14: Decision log

This log holds every decision from the planning conversation (2026-09-28 and 2026-10-11) and the blueprint session (2026-10-15), **including the options we rejected and the reversals**. It exists so a later agent understands how the design got here and doesn't argue its way back into an option already rejected. BK is the decision-maker:

- **BK:** his own call.
- **BK proposed; agreed:** his idea, refined in conversation.
- **Claude proposed; unchallenged:** raised by the assistant in the chat, built on by BK and never objected to. These are the design's working assumptions, and the easiest to revisit.
- **Claude, in the blueprint:** made while writing this blueprint, where the chat never reached the question. Each one has a product question in [15](15-open-questions.md), or is grounded in a research file.

Change a decision only by adding a new entry that replaces the old one.

Numbers are not contiguous. Ranges were set aside for parallel workers and some went unused (the largest gap is 25 numbers in the D-190s and D-200s). A missing number is not a lost decision.

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
- **Shape:** two or three concrete alternatives, affected keys highlighted, trade-offs explained, applied together, displaced functions kept reachable, one undo. **Replaced in part by D-452 (2026-10-28):** one best proposal first, refined by questions; displacement, reachability and one undo stand.

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
- **Proposed partial amendment:** D-418 keeps the TypeScript core but evaluates a Rust device helper. It changes no production transport until D-419's adoption gate passes.
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
- **Last good image:** a verified half's image is written to `<data dir>/firmware/last-good/<board>/<L|R>.uf2`. D-437 supersedes the per-half promotion timing and adds automatic rollback after a partial split flash (`keyloom flash --reboot-only` does not support ZMK).
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
- **Not built at this decision:** writing it back after a failed flash. D-437 supersedes this note for split ZMK flashes after the 2026-10-22 Glove80 failure. QMK rollback remains unbuilt.

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
- **Proposed extension:** D-401 replaces the restriction to proposing against only the conversation's layout. It does not change validation or grant hardware permission. The extension is not built.
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

### D-250: The Moonlander's thumb clusters are drawn at 30 degrees, with the red key above the three-key arc, from ZSA's own renderings. (BK's report, Claude)
- **Why:** QMK's `keyboard.json` has no rotation, so the 2u red key sat on the bottom row beside the board and the three thumb keys stood upright. Oryx's rendering (`docs/research/configurators/oryx/17-swap-keys.png`, measured: the key edges run at 30 degrees, the three keys step 1u apart, the red key sits over the first two) and ZSA's top-down product image of the right half (`moonlander/legacy/3-columnar.webp` on zsa.io, checked 2026-10-16: rotating it 33 degrees puts all four keys upright) agree. The old 15 degrees was a guess.
- **Shape:** the red key is drawn as a 2u by 1u rectangle. ZSA's is a hexagon with one cut corner and a little taller; a polygon would need a second shape model for one key.

### D-251: Looks the firmware doesn't carry go in `display` in `board.json`, applied only when drawing, and a test ties them to the generated geometry. (Claude)
- **Why:** BK asked that generated output not be hand-edited. `display.rotate` already existed for this; `display.shift` is added because QMK's 4u gap between the halves is too small for clusters tilted inward (they overlapped in the first render). `boards check` rejects positions past `keyCount`, and `test/boards/display-overrides.test.ts` checks that the overridden keys are the 2u and 1.5u keys they were measured against, that the two halves mirror, and that no key overlaps another as drawn.
- **Rejected:** a second geometry file with the corrected numbers. It would be a copy of generated output that can drift in silence.

### D-252: A physical keycap colour is `display.keycaps` and is drawn as a rim and a 12% tint, never as the kind's fill. (BK's report, Claude)
- **Why:** kind is carried by fill and shape (18, D-100). A red fill would hide hold-tap, layer and macro on the very keys BK uses most. A 2px red rim plus a faint tint says "this is the red key" and leaves the legend at the contrast the kind fills were tested for. `test/web/contrast.test.ts` holds the rim at 3:1 and every kind's ink at 4.5:1 on the tinted fill, in both themes. The palette has one colour, `red`, because no other board needs one.

### D-253: Glove80 and Corne keep their generated geometry. (Claude)
- **Why:** both come from vendor-authored ZMK physical layouts (MoErgo's `glove80-layouts.dtsi`, upstream ZMK's `foostan/corne/6column.dtsi`), not from QMK data that lacks rotation. The Corne's tall inner thumb keys match QMK's `crkbd/info.json` (`h: 1.5` on the innermost thumb). Nothing in the pictures contradicts the real boards' shape.
- **Not checked:** a top-down product photo of either board. Neither vendor publishes one that could be fetched; the comparison is against the vendors' own layout data.

### D-254: On a phone, the Moonlander's left half scrolls sideways by a few pixels. (Claude)
- **Why:** the tilted cluster makes a half about 9 units wide, and the board stops shrinking at 44px a unit (18). Scrolling is the existing fallback for a board that is too wide. Shrinking the keys below 44px would cost more than the scroll.

## Rung 20: the MacBook keyboard through kanata (2026-10-16)

### D-240: A software remapper is a board, not a new kind of board file. Its revision names the kanata release, a `kanata-config` build, a `kanata-reload` flash and a `device` matcher. (Claude, building D-230)
- **Why:** `build`, `flash` and `source` already carry what a revision needs; adding variants kept `BoardDefinition` one type, so the roughly 40 places that read a board didn't each grow a second shape. `source` pins kanata's own release (`jtroo/kanata` v1.12.0, `02242ef`), which also pins the key names. `detect` stays `null` and `device.name` carries the product string, because the built-in keyboard has USB IDs of 0.
- **Geometry:** hand-authored, with `source.kind: "hand-authored"` and a `verified` flag. `boards check` skips the firmware-tree comparison, checks that no two keys overlap, and warns while `verified` is false (S36). `mirror` stays empty, because a staggered unibody has no mirror image.
- **`physicalKeys`:** a software board lists the key each position is on, because kanata grabs keys by name. `FN` is the one entry that isn't a KeyCode.

### D-241: kanata key names come from kanata's own source at a pinned SHA, joined to the key table on the HID usage macOS sends. (Claude)
- `scripts/gen-keycodes.ts` reads `parser/src/keys/mod.rs` and `macos.rs` at `02242ef` (v1.12.0), takes the name arms that a macOS build accepts (a `#[cfg]` that leaves macOS out, such as `prtsc`, is skipped), and joins them to the existing keys on usage. 136 of 197 keys have a name; the 61 without are keys kanata has no macOS name for. Names only: no kanata code is copied (LGPL-3.0).
- **Tested:** every key the MacBook board uses has a name, and `kanata --check` accepts every name the generator writes.

### D-242: Hold-tap profiles reach kanata through a written translation table, and what has no equivalent is reported. (Claude)
- A kanata profile holds a `variant` (kanata's own tap-hold names), `hold-ms`, `tap-repress-ms` and optionally `require-prior-idle-ms`. The table in [21](21-macbook-keyboard.md#hold-tap-translation) maps QMK's `PERMISSIVE_HOLD`, `HOLD_ON_OTHER_KEY_PRESS`, `CHORDAL_HOLD`, `FLOW_TAP_TERM`, `TAPPING_TERM` and `QUICK_TAP_TERM`, and ZMK's flavors, `tapping-term-ms`, `quick-tap-ms`, `require-prior-idle-ms` and an opposite-hand `hold-trigger-key-positions`. `RETRO_TAPPING`, `retro-tap` and a trigger list that isn't "the other hand" have no kanata form and come back as notes the agent tells BK.
- "Roll equals tap" (BK's Karabiner home-row rule, ZMK's `tap-preferred`) is `tap-hold-tap-keys` over every key: another key's press makes the held key a tap, and only the time makes it a hold.
- **Proved for QMK by S33** (D-390): the QMK rows were run against kanata's simulator. The ZMK rows marked (S6) in `src/layout/kanata/profiles.ts` remain inferences from the docs.

### D-243: `keyloom.kbd` is written whole, with a header, a hash and a revision marker, and the generator refuses what kanata can't say. (Claude)
- The header names the layout and revision and hashes everything after it, so a file BK edited by hand is "not keyloom's". A virtual key `keyloom-<revision id>` is the marker `RequestFakeKeyNames` reports. `safe.kbd` is the identity map with the marker `keyloom-safe`.
- **Refused, not dropped (D-024):** a tap dance with a hold or tap-then-hold slot (kanata's tap-dance counts taps), a macro that holds a key that isn't a modifier, a QMK or ZMK `native` binding with no kanata form, and any kept kanata source with a `cmd` action, `danger-enable-cmd`, `include` or text that would change the config's structure. The validator reports each as `firmware_unsupported` before Apply.

### D-244: Apply checks the candidate first, replaces the file atomically, reloads with `wait`, reads back, and undoes a failed reload. (Claude)
- Order: write the candidate under its own name, `kanata --check` it, write `safe.kbd`, rename the candidate over `keyloom.kbd`, send `ReloadFile` with `wait: true`, then compare `RequestLayerNames` and `RequestFakeKeyNames` with what was written. A refused reload puts the previous file back. A `keyloom.kbd` that keyloom didn't write is left alone unless the person asks (`--overwrite`), and a copy is kept.
- **Measured:** a sync on the demo (real `kanata --check`, fake TCP server) took 219 ms from the start of the write to the verified read-back.

### D-245: The MacBook uses the sync engine's states, with `remapping_off` as one more reason for "behind", and auto-apply waits for the exit-chord proof. (Claude, from D-235 and 17)
- There is no build and no flash: the engine's remapper path runs one apply, then re-reads kanata. States come from kanata's TCP port: not running is "Not connected", another config is "Not keyloom's", `safe.kbd` loaded is "Remapping is off".
- Auto-apply turns on only after `keyloom remap confirm-exit-chord`, which BK runs after holding Left Control + Space + Escape and seeing kanata stop. "Disable remapping" is in the header menu, `keyloom remap disable`, and `POST /api/sync/disable-remapping`. Auto-apply never undoes it.
- `keyloom remap setup` writes the LaunchDaemon plist and an identity `keyloom.kbd` into keyloom's own folder, so the daemon has something to start on, and prints the one root command. keyloom never runs it.

### D-246: The doctor only reads. (Claude)
- It reports the kanata version, the driver version and its protocol (6.x is 5, 8.x is 7), the built-in keyboard's product string, whether Karabiner's config still lets it grab the built-in keyboard, the daemon, the TCP port and the file's header. It says macOS keeps Input Monitoring and Accessibility out of reach, and warns that a Karabiner-Elements 16.x upgrade replaces the driver with one kanata 1.12 can't use. `keyloom doctor` includes it as warnings, so a machine that never set it up doesn't fail.

### D-247: On the MacBook the validator requires Escape and a Control key to be reachable. (Claude, D-235)
- `remapper_lockout` is an error in the document rules. kanata's exit chord reads raw keys, so this protects the keys, not the chord. A layer's way back is already `layer_trap`.

### D-248: The Karabiner importer reads five shapes, imports a rule whole or not at all, and hands BK the disable edit as text. (Claude, D-232 and D-233)
- **Read:** the Space-hold layer (a `set_variable` pair with a `variable_if` sibling set), hold-taps (`to_if_held_down` with `to_if_alone`), `simultaneous` combos, a plain key-to-key remap, and `simple_modifications` and `fn_function_keys`. The last two go beyond the brief's list because they are exact and BK's file uses both (Caps Lock to Backspace, F6 to F13).
- **Not read:** anything else, including a rule with one unreadable manipulator among readable ones, stays in Karabiner and is listed. A rule switched off in Karabiner is listed and not imported.
- **The edit:** an `ignore: true` entry for vendor 0, product 0 in the profile's `devices`, printed with the instruction to confirm the identifiers with `karabiner_cli --list-connected-devices`. keyloom never applies it, and never writes the file. Rules not imported stop applying to the built-in keyboard once it is ignored, and the report says so.

### D-249: Copying onto the MacBook offers hold keys instead of forcing them. (Claude, D-234 and 20)
- `board.json` can list `holdKeyPreference`: positions where a layer or hold key lands first when the board it came from had more thumb keys. The MacBook lists Space, Caps Lock and right Option. `map_keys` shows them for each layer key with no counterpart and says to ask BK, suggesting the first. A hold-tap copied onto a kanata board gets a translated kanata profile (D-242).

### D-260: keyloom's look is "the keyboard under the light", and the shell is the top bar, the stage and one sheet. (BK approved the comps, Claude)
- BK, 2026-10-16, on the comps in `evidence/concept/`: "Yes, build it". The concept and its rules are [23](23-design-concept.md).
- The toolbar row, the permanent side panel with its layout summary, and the bottom chat bar are removed. History, Library, Combos, Settings, Advanced view, select mode, shortcuts, theme and Build and flash are in the top bar's menu; the chat opens from Ask keyloom (⌘K). The side column appears only while something is open, as a sheet beside the board.
- **Replaces** 18's toolbar, side panel and chat bar layout.

### D-261: One typeface, Instrument Sans, using its width axis for long legends. (Claude)
- Real keycap legends are set in a slightly condensed grotesk; the width axis (75 to 100) lets "command" or "Space" get narrower instead of smaller, so the 11 px floor holds. Loaded from Google Fonts without blocking, as Inter was; the system font stands in offline.
- **Replaces** 18's Inter.

### D-262: The theme is the room, and the board's colourway follows it. (BK, Claude)
- BK chose "the case colour follows the theme": black caps and case in the dark room, white in the light one. The Moonlander's red thumb caps stay red in both. A setting to pin the colourway to the board BK owns is deferred.
- The pin is built (D-395): following the theme stays the default.

### D-263: Light carries meaning: a layer's colour, amber for a change not on the keyboard, green for one that is. (Claude)
- A layer's light is its dominant LED colour when it has LEDs (BK's Oryx colours), else its chosen colour, else the colour its place picks; the first layer with neither is unlit (`src/web/light/layer-light.ts`). It is the underglow, the strip's miniature and the dot on every key that reaches the layer.
- Per-key LED colours bleed under the cap and tint its skirt at `--led-wash` (12%); every hue keeps the front print at 4.5:1 (`test/web/led-contrast.test.ts`).
- Chrome has no accent colour: ink is primary. The older `--color-accent` name now holds ink.
- **Replaces** 18's one blue accent and "no gradients, glow or decorative motion": glow is now the meaning-carrier, kept off the chrome.

### D-264: Key kinds are hidden at rest and shown by Inspect. (Claude)
- At rest a cap shows its tap legend on the top face and its hold printed on the front skirt, like a real dual-legend cap. Inspect (`i`, or the toggle at the stage's foot) tints faces by kind, shows what transparent keys pass through to, marks combo keys and draws combo lines. The kind is always said in words in the key's name and its panel.
- The kind tints keep their ink at 4.5:1; they differ from a plain key by 1.2:1 or more, since at rest they are not shown and under Inspect the words carry the kind.
- **Replaces** D-100's "kind is a shape and a fill" and the 1.5:1 kind-fill rule.

### D-265: A layer change ripples out from the key that holds the layer; keys never move. (Claude)
- The underglow crossfades first; each key's legend and light then change after a delay of 18 ms per key unit from the key that reaches the layer on the first layer (a held thumb key first). The old legend fades as the new arrives. Reduced motion switches at once.

### D-266: Each board's case is drawn from its geometry, with an optional `display.surface` hint. (Claude)
- A display rotation group is a module drawn square in its own frame and turned (the Moonlander's thumb clusters). Each hand's other keys make one body: a box when they are all square, a filleted hull when any key turns. Hands that interleave make one body. `display.surface` is `wells` (the Glove80: a sunken well per column and thumb key) or `deck` (the MacBook: an aluminium deck and a recess). `src/web/keyboard/case-shape.ts`.
- **Replaces** 18's trays.

### D-267: The front print spells a lone modifier the way Apple's caps do, and a modifier key prints its symbol. (Claude)
- A hold of one modifier prints "⌥ option", or "⌥ opt" when that wouldn't fit at the legend's size; Hyper prints "✦ hyper". Which side's modifier it is stays in the key's name and panel. A key that is itself a modifier prints ⇧, ⌃, ⌥ or ⌘ instead of LSFT or LGUI.

### D-268: Applying presses the key down. (Claude)
- The applied key's cap travels down 0.08 key units past rest and springs back over 0.42 s (Motion). Reduced motion skips it.

### D-269: The top bar's board switcher draws each board's silhouette from `GET /api/boards`. (Claude)
- The boards list now carries each board's geometry keys and display hints, so a board BK hasn't opened yet still shows its shape. A connected keyboard that isn't on screen shows its sync light on its silhouette. The sync line covers the board on screen only.

### D-270: A cap prints words a person reads; firmware spelling is for Advanced view only. (P1 design review, Claude)
- `src/layout/legend.ts` and `src/layout/native-legend.ts` print, at rest: shifted keys as the character they type (`!`), modifiers in Apple's order either side alike (`⌃B`, not `r⌃B`), Hyper and Meh as ✦ and ◆, media and paging keys as words (Bri−, Vol+, PgDn, Play), layer keys by the layer's name as people read it (sentence case, no underscores; first word or three letters when the name is longer than eight characters) with the action spelled out (hold, toggle, go to, once), and a macro named only after its firmware slot by what it sends (⇧⌘4).
- Every kind of kept firmware binding in BK's Moonlander and Glove80 layouts has a human legend read from its source: one-shot modifiers (⇧ / once), Oryx dual-function keys read from the kept `process_record_user` (F5 / Game), ZMK `&layer_on_hold` (⏎ / Numbers), `&magic`, lighting (Hue− / lights), mouse (Click / mouse), Bluetooth (BT 1, Unpair), output (USB / output) and bootloader (Boot / flash). Anything else keeps a label that is already a word, or reads "Custom". The source is in Advanced view and the panel; `advanced-legend.ts` is reached only when Advanced view is on.
- Layer names are shown in display form everywhere (`niceLayerName` is now `layerDisplayName`); the stored name is unchanged.
- **Replaces** D-187's "tog" and "go" (the condensed width fits "toggle" and "go to") and 18's upper-case layer short labels on caps.

### D-271: Cap type steps down with length, sits at about 480 weight, and a key is at most 58 px. (P1 design review, Claude)
- A tap legend is 0.28u for one glyph, 0.23u for two, 0.2u for three and 0.18u for a word, never under the 11 px floor (`tapRange` in `fit.ts`). Words of four or more characters and every front print are set at the font's 75% width; fit.ts estimates them at 0.74 of the regular width, measured in the browser (0.65 to 0.72).
- Front prints spell their words ("option", "command", "control"); on a cap too small for symbol and word, the word alone. Never an abbreviation.
- `MAX_UNIT` is 58 px, so a Corne or a laptop renders at about a Moonlander's cap size instead of filling the stage.

### D-272: Status LEDs on a case come from `display.statusLeds` and light in the layer's colour. (P1 design review, Claude)
- Positions are in key units after `rotate` and `shift`. The Moonlander lists three per half; they change with the layer ripple.

### D-273: Inspect is ⌥I and a menu item, and uses three hues. (P1 design review, Claude)
- A plain I is free to find the I key by pressing it. On a phone Inspect is only in the menu.
- Amber for a key that does more than one thing (hold-tap, tap dance), blue for one that changes layer, violet for one that runs something kept as written (macro, firmware binding). Plain keys and modifiers stay untinted. Combo dots are gone; Inspect draws the combo lines instead.
- Amends D-264.

### D-274: Front prints carry their modifier's symbol on every cap of a board or on none, and combos rest as dots. (P1 final pass, Claude)
- The board measures "⌘ command", its widest print, in the loaded font at the front's size; if it fits a 1u cap, every cap prints symbol and word ("⌥ option"), otherwise every cap prints the word alone. At 1440×900 the Moonlander (57 px keys) carries symbols; the Glove80 (54 px) and phones don't. Amends D-271.
- Under Inspect a combo is a dot on its line; its full output appears in a pill while it is pointed at, focused or edited.
- One undo arrow in the top bar; redo is ⇧⌘Z and a menu item.

### D-275: The key card never covers the board: the halves part for it when needed, and the key is drawn large as its hero. (BK's decision, P2, Claude)
- BK: "the halves part only when needed". Clicking a key opens a card (a bottom sheet on a narrow screen) that never covers any part of the board. If it fits in the stage beside the board, nothing moves. Otherwise a split board parts: the half without the key slides away by what the card needs, the card sits in the gap with a thread to the key, and the board recentres. If the parted board is wider than the stage it scales down (to 0.8 at least), and only then slides. A one-piece board (the MacBook) slides instead. The parting follows the card's spring; reduced motion moves it at once (`src/web/card/card-seat.ts`). Measured at 1440×900, 1366×768 and 1280×577 for all four boards: no part of the board under the card, nothing off the stage.
- The hero is the key in the board's five layers. Its parts are its slots: the top face is the tap, the front skirt the hold ("hold…" when empty), the top corners a double tap and a tap-then-hold. Clicking a part opens that slot's picker under the cap. Four symbol toggles (⌘ ⌥ ⌃ ⇧) beside it act on the slot being edited; Advanced view adds the side-by-side toggles.
- The title names the key by what it does ("I, or hold for Control", "Go to Navigation", "F5, or hold for Layer 5"); the key number is only in Advanced view. Swap, copy, paste and colour are icons in the header. "Also on …" chips light the other key on hover and show its layer on click.
- Apply appears only when there is a change and says it in words ("Hold I for Control", "Make it a tap dance", "Send Esc from X + B"). A clean check says nothing; problems and warnings show in the card. Only the slots a change touches are lit amber on the hero.
- The hold's picker opens on two groups, modifiers and layers, with every key behind "Any key…"; its timing is a link in the picker's head. A tap dance says itself in a sentence with a "Tune the wait" chip. A macro lists "Sends, in order"; one that taps a single shortcut is shown as that key, with what macOS does with it. "Why this change?" is a quiet link.
- Combos use the same card: their keys, an arrow, and the output as the hero.
- **Replaces** the key panel's side column (D-098's panel) on wide screens; all its behaviour is kept.

### D-276: Firmware names never reach a sentence. (P2, Claude)
- A function lost or kept in a change is named as its cap prints it ("⇧ for one key", "F5, or hold for Layer 5"), or "a custom key". A macro named only by its firmware slot is named by what it sends ("Command, then C"). Extends D-270 from caps to words.

### D-277: BK's boards are drawn from photographs of the real objects, as board display data. (BK's request, Claude)
- BK: "this is not a moonlander keyboard … we can at least craft the ones I own", and "you don't have to put the palm rests but get the keyboard right". Each of his four boards is measured from a top-down reference and drawn from `board.json` `display` data: `display.case` (SVG paths in key units: body, hinged module, laptop deck and well, OLED cover, speaker grille, Touch ID, tenting leg and knobs, pinhole), `display.keyShapes` (a cap's box and outline, the Moonlander's red "house" caps) and `display.caseHug` (a case that hugs its keys, the Glove80). Firmware geometry stays the source for every key's position and binding order; display data only changes how keys are drawn. Generators and references are in the build evidence (`light-build/*-case.py`, `*-ref/`).
- Moonlander (ZSA's top-down render): thumb module turned 51° (not 30°), hinged at the body's lower inner corner below the B column with the seam, notches and hinge screw; red cap 2u × 1.2u with its roof pointing away from the grey keys; status LEDs above columns 2–3; reset pinhole; the folded tenting leg with a knurled knob on the inner edge; halves 3.4u apart. Palm rests are left out.
- Glove80 (MoErgo's top-down photo): the case hugs each key by 0.3u, keeping the column steps, and each thumb fan sits on a curved band about its pivot. The column wells stay (D-266).
- Corne (foostan's PCB render): the PCB's two top levels, the microcontroller strip 1.1u wide inside the inner column under a dark OLED cover, the stepped bottom around the thumbs; halves 0.8u apart.
- MacBook Pro 14" (Apple's top-down image): a full-height function row with Touch ID in its 14th place, a black keyboard well, speaker grilles each side and the deck around them. The trackpad is left out, like the palm rests. The taller deck makes the MacBook's keys smaller in short windows (49 px at 1366×768, was 58).
- Long caps turned past 32° print upright in the widest upright box that fits inside the cap, so the Moonlander's thumb legends stay on their caps.
- **Amends** D-266: a board's `display.case` wins over the computed case.

### D-278: ⌘K opens the chat as a command bar at the stage's foot, and its proposals preview on the caps. (P3, Claude)
- The bar takes the strip's row on a wide screen; the board above it stays in view. The newest open proposal is pinned at once, so it shows on the caps (changed keys amber, the rest stepped back, arrows to where displaced functions go). Alternatives are tabs that switch the preview; a compact card gives the why, the diff, the moves, the trade-off and what keyloom will remember, with Not this and Apply in a sticky foot. Apply presses the key (D-268). Conversations, decisions and the provider picker live in the bar's head. A narrow screen keeps the chat sheet until P5.
- The board keeps the height it needs at its smallest unit and the bar takes what is left, scrolling inside. Below about 300 px for the bar and the caption, the bar keeps that room and the board scrolls in its row to the first changed key.
- With no credential for the chosen provider, the bar offers each ready provider in one click. A reply that stops says why: "Out of credits", "The key was refused", "The model is busy" or "The reply stopped", always "Nothing was changed". An account failure offers "Switch to" each other ready provider, which starts a new conversation with the message back in the box, since a conversation keeps its provider.
- Moves in a proposal name functions in words ("Backspace", not BSPC) and layers as the caption does ("Default layer", not default_layer), extending D-270 and D-276.

- **Amended by the P3 review.** The board keeps the unit it rests at while the bar is open: the bar sits over the empty stage, the board moves up beside a small caption when the bar needs room, and in a window too short for both the bar folds to one line ("Plain Shift on the lower-row middle keys · Not this · Apply"), opening over the board only for something that must be read (a question, a failure, no model). Changed caps carry the amber halo and dot; the arrows are gone. Each change is one chip in legend glyphs ("⇧ once → plain ⇧"). The bar has no header: New, Conversations, Decisions and Model are in one ⋯ beside the input, with an esc chip; Enter sends. Apply closes the bar, presses every changed cap, and leaves the amber dot on them until the sync line says the keyboard has them; an unplugged keyboard reads "1 change not on your Moonlander" in amber (`src/web/chat/bar-fit.ts`, `sync-state.ts`). Tabs carry short labels, the full title leads the sentence, conversations show what came of them, and titles cut at words. The no-model notice is neutral; amber stays for "not on your keyboard yet".

### D-279: Keys are named by what they print and where they sit, never by number, in everything a person reads. (P3 review, Claude)
- The review: "No key numbers anywhere a person reads. Name keys by legend, finger and layer." A key is "S hold ⌥ (left ring, home row, Layer 0)", "⌃← (left red thumb key)", "⌫ (left pinky, home row, outer)": the cap's legend, the hand and finger, the row, inner or outer where a finger has more than one key in that row, and the layer. `src/boards/key-names.ts`.
- **At the source.** The agent's tools write keys that way (`get_layout`'s position table, `map_keys`, `mirror_keys`, `find_function`, the selection header, the priorities and decisions in the prompt, copy-plan skips), each with "at position N" for ops; the system prompt tells the model to speak in names and never say a number. The validator's sentences name a key by its legend and layer ("the B key on Base"); which key it is shows on the board, since every issue carries its slots.
- **Supersedes** D-063's "talk uses key numbers" and D-112's "one-based key numbers", and the system prompt's "key N" rule. Advanced view keeps key numbers (D-275).

## Rung 21: a new keyboard (2026-10-16, part 1: engine and CLI)

The brief for this part named D-240 to D-249, which the MacBook rung already holds; these take the next free block.

### D-330: A board derived from a keyboard on BK's desk is a local board: `local/<keyboard>`, kept in the data directory and loaded beside the shipped ones. (Claude, answering the research's first open question)
- **Why:** BK's own new keyboard needs no pull request, and a `local/` id can never collide with a shipped one, so deriving the Corne leaves `foostan/corne` alone. The folder is `<data dir>/boards/local/<keyboard>/` with the same `board.json` and `geometry.json` a contributed board has, so it can be sent upstream as it stands. A shipped id wins over a local one. Every `openApp` and every CLI command loads the folder.
- **Where:** `src/boards/user-boards.ts`, `src/boards/registry.ts` (`setUserBoards`).

### D-331: Detection ranks candidates from a committed index and never chooses silently; `keyboard add` takes nothing it was not told. (Claude, from D-236 and the research)
- The index (`src/boards/derive/keyboard-index.json`) is generated by `scripts/gen-keyboard-index.ts` from qmk_firmware `7a1bbf3` and zmk `4dd95d7` (`pins.ts`) and read at no time from the network: 3687 QMK keyboards with USB IDs (73 without are left out), 69 ZMK shields and boards, 37 controllers. A QMK keyboard is matched by vendor and product ID, then by product string and device version; a ZMK one by product string, on ZMK's default ID or its own.
- Two close scores, a shared ID, and the placeholder `0xFEED` are all "ambiguous", which is a list with a reason per candidate. Once one candidate fits well (0.6), keyboards that only share its ID are dropped from the list. The QMK Corne is genuinely ambiguous: `crkbd/rev1` and `crkbd/r2g` share every ID and differ in controller.
- `keyboard add` needs `--candidate`, and `--home-row` and (for a ZMK shield) `--controller`; without them it prints the rows it found and exits 2 with nothing written.

### D-332: Hands, thumbs, fingers, rows and mirror pairs are derived by the research's rules, and the tests reproduce its numbers. (Claude)
- Hands 194 of 194, thumbs 26 of 26 (none false), fingers 132 of 132 on the Moonlander and Glove80 and 36 of 36 on the Corne (S40: the rule was right and the Corne's table was wrong, D-227), rows and mirror pairs equal to the committed files on all three. Rows are found by linking each key to the key level with it in the next column in, which survives the Glove80's curved wells, where clustering raw heights merged six rows into one; a column dropped by exactly half a unit sits level with the key above it. The home row is the one thing asked (D-331); its guess is shown beside the row sizes.
- **Where:** `src/boards/derive/heuristics.ts`, `test/boards/derive/heuristics.test.ts`.

### D-333: A derived board is flashed only by recipes keyloom already has; everything else is `manual` with the reason, and the new recipes wait. (Claude, from D-236)
- QMK `rp2040` gets `uf2-drives` (the drive is always `RPI-RP2`). Every other QMK bootloader, `tinyuf2` and `uf2boot` included (their drive names are not known), gets `manual` with QMK's own instructions for it and the tool that writes the file. A ZMK shield gets `uf2-drives` for controllers whose boot-drive name is read from their bootloader's source (nice!nano, BlueMicro840, nRFMicro, and the RP2040 boards), and is refused for the rest rather than given a guessed name; `keyloom-zmk` hands-free is written only for a split shield on a nice!nano, where D-095 proved it.
- **Left for part 2:** `atmel-dfu`, `stm32-dfu` and the other DFU recipes (54% of QMK keyboards), each a new tool with its own port discovery (D-049).

### D-334: "Put my config on this" maps every layer at once onto an empty board and proposes it on a new config; it never applies, builds or flashes. (Claude, from D-236 and D-249)
- It is rung 19's position mapping run over all layers: layers keep their names and order, hold-taps keep the source's own profile (one per hand on ZMK, with trigger positions rebuilt from the new board's other hand and thumbs), macros and tap dances come with the keys that use them, and each modifier takes the hand of the key it lands on. Matches down to a nearer column are carried and counted as guesses; anything weaker, and anything with no counterpart, is listed with the reason.
- A layer key with no counterpart is offered free thumb keys first, then keys held by a guess, and a key carried with confidence is never offered (D-249). The first proposal is the mapping alone; the second, in the same group, adds the first choice of each such key. A key that enters a layer by toggle or `to` is left out when nothing leads back, because the validator refuses a trap; the second proposal skips a placement that would cause one.
- Combos come across when all their keys do. The first config on a board becomes the board's, as D-300 says; the board is not syncable, so nothing reaches a keyboard.
- **Where:** `src/agent/put-plan.ts`, `src/app/keyboard-put.ts`.

### D-335: The keyboard-state reader sees any QMK board with USB IDs; only a ZSA board can be restarted. (Claude, D-237)
- `isKeyboard` compared against ZSA's vendor ID; it now compares against the vendor ID the board declares (`detect.usbVendorId`), and ZSA's when a ZSA board declares none, so every existing target behaves as before. `keyboardIdentity` is what can be seen; `keyboardTarget` (ZSA, Zapp) is what can be restarted. Doctor lists a derived board in words that do not promise hands-free flashing, `syncSupported` stays false for it, and `flash --reboot-only` says why it cannot.
- **Where:** `src/firmware/qmk/handsfree-flash.ts`, `src/app/keyboard.ts`.

### D-336: The new-keyboard screens: a stage card when one is plugged in, its board drawn beside the two questions, and a put that ends in the config's open proposals. (Rung 21 part 2, Claude; comps approved by the coordinator for BK)
- **Noticing it.** The sync engine's own USB read names the keyboards keyloom has no board for and publishes them on the existing event stream (`newKeyboards` on the sync frame). The new-keyboard card follows that stream, with no second poller. It only reads.
- **The card over the stage.** It says what USB said, then lists the candidates with keyloom's reasons word for word, with "Likely", "Maybe" or "One of two". A search field is always there. An ambiguous keyboard has nothing chosen until BK picks one. "Not now" leaves an amber "New keyboard" chip beside the board switch.
- **The two questions, beside the board.** The board is drawn by the same renderer as every board, from the firmware's own layout, with blank caps.
  - The home row: click any key in a row, or use the row buttons; keyloom's guess is marked.
  - For a ZMK shield, the controller.
  - `previewKeyboard` now derives the board without storing it and returns its keys, hands, fingers, rows and recipe. Until a controller is chosen it assumes the first that fits, and says so.
- **The board as keyloom read it.** Each cap shows the finger keyloom expects, with keys, halves, home row, controller and firmware listed beside it. Fingers are shown, not editable: a wrong guess means going back. A per-key finger override is a possible later item, not built.
- **The flash.** The flash box follows the board's real recipe (D-333 unchanged). Nothing flashes from this flow.
  - A board with a recipe (the Corne's UF2 drives) reads "keyloom won't flash from here. The first flash is by hand", then how.
  - Only a board without one says its recipe is "manual", with the reason.
- **Names that collide.** A derived board whose name another board in the registry already has reads "Corne (new)", in the card, the panel and the board switch.
- **Putting a config on it.** Pick any config on another board.
  - The board shows the mapping, with placed layer keys in amber.
  - The column says what came over per layer, the commonest reason the rest stayed behind, and a "See the keys that stay behind" list.
  - Each layer key with no counterpart offers its candidates as chips. A pick is passed to the plan (`placements`, source position to target), and the proposal's text names the pick.
  - "Make" creates the config and its proposals; nothing is applied.
- **The new config opens with its proposals.**
  - A config's open proposals that no conversation shows are listed in the side column with the chat's proposal card. Each has a visible "Show it on the board" pin, and Apply is the ordinary apply.
  - The caption offers "N proposals waiting · Show" while it's closed.
- **Routes,** in the `/api/configs` style with tests:
  - `GET /api/keyboards/detect[?search=]`, `POST /api/keyboards/preview`, `POST /api/keyboards/add`, `POST /api/keyboards/put/preview` and `POST /api/keyboards/put` (`src/api/keyboards.ts`);
  - `GET /api/configs/:ref/proposals`.
- **Visible at rest.** Every action in the flow is a button, chip, radio row or field. Nothing waits for a hover.

### D-337: Nothing waits for a hover: per-row and per-cap actions are shown at rest, quiet; and the put panel names layers as the strip does. (Visible actions, Claude; asked by the coordinator)
- A search of every stylesheet for actions or hints that only a hover or focus reveals found three. Each is now always shown, quiet at rest and full when pointed at:
  - History's per-revision "Go back to this", which showed on hover except on touch screens;
  - the layer strip's add and layer-menu buttons, which showed on hover or focus;
  - the key card's empty corner slots ("2×", "tap+hold"), which showed on hover of the hero cap. v0.32.1 already names those slots under the key.
- Hover highlights that only preview, with the action a visible click (combo rows, library uses, "Also on" chips, proposal cards), are not affordances, and stay as they are. History's long change text is clamped to two lines and reads in full on hover or focus; it's text, not an action, and stays.
- The "Put a config on" panel names layers as the strip does ("Default layer", not "default_layer"), in its per-layer list and in the list of keys that stay behind. The engine keeps the firmware's names; the screen reads them through `niceLayerName`. The put's proposal texts carry no layer names.

### D-338: The layer strip fits beside a side column: a tab gives up width before a layer scrolls out of sight. (Strip fit, Claude; asked by the coordinator)
- At 1280 wide with the conversation or History column open, the strip cut the sixth tab off ("Layer 5" read "Layer"), because the tabs never shrank and the strip scrolled.
- Each tab now shrinks down to its min-width. Its name ends in an ellipsis when it must, and the full name is the tab's tooltip. The colour dot and the layer's number never shrink.
- The number lost the 12 px of padding it carried; the name row's own gap already parts them.
- On a phone the strip still scrolls with whole names, since a touch screen has no hover to read a shortened one back.

## Typing lab (2026-10-16)

### D-280: An explicit, opt-in typing session records physical key events so keyloom can tune timings from evidence. (BK. Replaces D-035 for sessions BK starts)
- **BK:** "I'd love a feature where I can set up a key config, then tell the software to listen/watch me type for a bit … and then notice things that go wrong like rolls, typos and timings and stuff and then use that knowledge to make suggestions about what to improve."
- **Bounds:** only while the lab is open and recording is visible; local only; deletable; never raw text to a model. Chapter [24](24-typing-lab.md).

### D-281: The lab captures physical presses and releases from keyloom's own firmware (QMK raw HID, the ZMK module's serial port), not browser key events. (Claude, in the blueprint)
- **Why:** the browser only sees the firmware's decisions, so timing misfires can't be told from typos without the physical trace.
- **Option rejected:** a browser-only typing test. It measures speed but can't explain a misfire.

### D-282: Suggestions come from replaying the recorded trace through keyloom's emulators with candidate settings, and carry before-and-after counts. (Claude, in the blueprint)
- **Why:** the emulators already run the real QMK and ZMK cores (D-075 to D-083), so a suggestion can be proven on BK's own keystrokes before he flashes anything.

### D-283: Findings are told per finger in plain words, not as a single speed score. (BK)
- **BK:** "instead of saying this is your typing speed it can say your typing slows down on keys that you need to press with your index finger or something or most typos come from your pinky."

## Configs and versions (2026-10-16)

### D-300: Each board has exactly one config on the keyboard, chosen explicitly; only it auto-syncs, and editing any other config never touches the keyboard. (BK's request; design Claude)
- **BK:** "maybe I want a steno config and a qwerty config and a colemac config and I don't want to use layers for that, then I can keep layout configs that are different".
- **Replaces:** the sync engine's implicit "newest edited layout is the board's layout" (`src/app/sync-engine.ts`).
- Chapter [25](25-configs-and-versions.md).

### D-301: A version is a revision that went onto the keyboard, recorded automatically on a verified sync and nameable; History shows versions as milestones. (BK's request; design Claude)
- **BK:** "keep multiple versions of my layout and version history just like oryx does so if i change something an use it for a week and don't like it I can go bto a past version".

## Desktop app (2026-10-16)

### D-320: keyloom ships as a Tauri v2 desktop app with the unchanged keyloom binary as its sidecar. (BK proposed; Claude chose Tauri from the spike)
- **BK:** "Don't you think it's a good idea for us to just make this an electron app? Or Tauri? instead of relying on the browser where our keyboard shortcuts can clash with other things and extensions could do some unexpected behaviour."
- **Options rejected:** Electron (about 130 MB runtime alone, a second JS runtime); Electrobun (bun main process only in daily betas, no launch-at-login, as of 2026-10-16).
- **Evidence:** [../research/desktop-shell.md](../research/desktop-shell.md).

### D-321: `keyloom serve` accepts port 0 and exits when its stdin closes. (Claude, from the spike)
- **Why:** the shell picks the port and must never orphan the server; a SIGKILL'd shell orphaned it in the spike.

### D-322: Browser mode stays; the desktop app is a client of the same server. (Claude)
- **Why:** a phone or another machine still reaches keyloom, and the app adds no second code path.

### D-323: One keyloom server serves a data directory; the app attaches to a live one instead of starting its own. (Rung 24, Claude)
- **Why:** each `keyloom serve` runs its own sync engine and board review over the same database. Syncs are guarded across processes, but the review and the auto-sync decision are not, and nothing stopped a second server. BK already runs one on port 4477.
- **How:** a server writes `serve.json` in the data directory (pid, token URL, mode 0600) and removes it on exit; a record counts only if its pid exists and the server answers with its token. `keyloom serve` refuses to start beside a live server; `--reuse` prints that server's URL and exits 0. The shell passes `--reuse`, attaches, and never stops a server it did not start. The check runs before the database opens, so a refused start runs no migration.
- **Limit:** a server started before this change writes no record, so it is not found. The app then starts its own until that server is restarted. If an attached server goes away, the shell starts its own after three failed reads.

### D-324: The shell stays behind flags the CLI owns: `--exit-on-stdin-close` and `--reuse`, not always-on behaviour. (Rung 24, Claude)
- **Why:** D-321 has the server exit when stdin closes, but a server started by launchd, `nohup` or `< /dev/null` has a closed stdin, so doing it by default would stop such a server at once. The shell opts in; this refines D-321.

### D-325: The server words everything the menu bar and notifications say. (Rung 24, Claude)
- **Why:** the spike's Rust re-implemented the header's wording and the transition rules. Product text in Rust drifts from the web app and can't be tested with it. `menuBar` in each `/api/events` frame (`src/server/menu-bar.ts`) reuses `syncLine` and `syncNotice`; the shell displays strings, enables Sync now when `syncLayoutId` is set, and shows `notices`.
- **Unplugged is not news:** a board that is not connected with nothing waiting for it does not decide the summary; "All keyboards are on their latest change" shows instead.

### D-326: Instrument Sans is bundled into the web app, for the desktop window and the browser alike. (Rung 24, Claude)
- **Why:** the window must work offline, and one code path beats a desktop-only font. Two woff2 subsets (latin, latin-ext; about 76 KB) with the OFL licence in `src/web/fonts/`, inlined by the bundler. The Google Fonts links are gone, which also removes a request to a third party.

### D-327: The shell is signed with hardened runtime and one entitlements file applied to both binaries. (Rung 24, Claude)
- **Observed:** Tauri applies `bundle.macOS.entitlements` to the sidecar and to the shell. The shell then carries `allow-jit` and the other two entitlements it does not need. Per-binary entitlements would mean signing by hand around Tauri's bundler; not worth it for a thin shell. Revisit if notarisation objects.

### D-328: The updater is compiled in only with the `updater` Cargo feature, and the release job turns it on only when its keys exist. (Rung 24, Claude)
- **Why:** Tauri's updater needs its own key and refuses to start without a public key, and BK has not generated one. Compiling it out means a build without a key cannot half-work. Setup is in `desktop/tauri/README.md`.

### D-329: Signing, notarisation and the updater each switch on their own secrets; without them the release still ships the app, marked. (Rung 24, Claude)
- The `build-desktop` job (macos-15) builds always, signs when the certificate secrets exist, notarises when an API key or Apple ID set exists, and appends a note to the release when it did not notarise. The cask in `packaging/homebrew/` is prepared in the repo and pushed to the tap by hand.

### D-310: A conversation reads in a full-height panel beside the board; the bar is for quick asks. (BK on v0.25.0, Claude)
- **BK:** "I don't like this version of the ai, it's short so i have to scroll a lot to read, plus it's on top of the layer switcher."
- Once a reply runs past about two lines of the bar (180 characters), carries an option, a priority or a failure, or there is a second message, ⌘K moves the conversation to a panel on the right of the stage, from below the top bar to the bottom edge, about 65 characters a line (`--chat-width`). It reads top to bottom and scrolls only when the conversation is taller than the panel, resting on the newest exchange. The board moves left whole and re-fits to the width that's left, at the legend floor; proposals still light its caps. The layer strip stays in view under the board, a size smaller.
- The one-line bar stays for a quick ask and its short answer, and for the folded option at short heights. The input sits at the panel's foot with ⋯ and esc.
- A key opened from the conversation takes the panel's place at the same width; Esc or closing it brings the conversation back, kept. The phone keeps its sheet (P5).
- **Supersedes** D-278's bar placement for conversations.

### D-311: Combos, Inspect, History and Library are one click away beside the layer strip. (BK on v0.25.0, Claude)
- **BK:** "some useful and relatively often used tools ar now hidden in this menu and thus increasing the time to ge them. for example combos, I ewant to be able to see combos quickly and easily".
- Four quiet controls at the strip's right, icon and short label (icons only beside a sheet or the conversation, or below 1400 px wide, with the name in the tooltip): **Combos** and **Inspect** toggle what the board draws, **History** and **Library** open their sheets. Combos is remembered per browser. With Combos on, each combo is its line and its output in a small chip placed off the legends, so the board reads at a glance; clicking one opens its card in the side panel. The phone keeps them in the ⋯ menu, which otherwise holds the rare things: All combos (the list), Settings, Build and flash, Select several keys, Advanced view, Shortcuts, Redo and theme.
- **Shortcuts:** ⌥C combos, ⌥I Inspect, ⌥H History, ⌥L Library, not with a key's card open or in a text field, and listed under ?. **Not single letters:** a plain letter finds that key on the board ("Press a key on your Moonlander to find it here"), which is why Inspect moved to ⌥I in the P1 review; C, H and L alone would open sheets when BK presses those keys on his keyboard.

### D-284: The Moonlander streams its key events through a second raw-HID command that wraps `action_exec`, off until the host asks. (Claude, building rung 22)
- **Command.** First byte `0xE8` (Oryx uses 0x00-0x0C and 0xFE, VIA 0x01-0x15 and 0xFF, keyloom's bootloader command 0xE7), then the eight bytes `KLTYPING`, then an action byte: 0 stop, 1 start, 2 keepalive. A start while the stream is on is a keepalive. `src/firmware/qmk/typing-stream.ts` holds the constants, the packets and the decoder; the C is generated from the same file into `keymap.c` beside the bootloader wrapper (`handsfree.ts`), so a hands-free build has both.
- **Reports** (32 bytes, the keyboard's `timer_read32()` clock). Events: `[0]` 0xE8, `[1]` 1, `[2]` sequence, `[3]` count (at most 5), `[4..7]` the clock at the first event, then per event the keyloom position, a press bit and a 16-bit offset in ms, and `[28]` the events dropped since the last report. Status: `[1]` 2, on or off, why it went off, and the clock. The first report after a start is the status, which gives the host the clock to measure from. A gap in the sequence numbers is a lost USB report, and the host says so.
- **Where it hooks.** `LDFLAGS += -Wl,--wrap=action_exec`: `quantum/keyboard.c` `matrix_task` calls it once for every matrix change and once a millisecond with a tick (zsa/qmk_firmware@93b2b9e, `keyboard.c:581,635`), before any tap or hold decision, so the event is physical. A tick is where a part-full batch is sent after 8 ms. `process_record_user` was rejected because Oryx's keymap defines it and the tap-hold logic has already acted by then. The keyloom position comes from a table built from the board's own layout macro (`keyloom_lab_position[MATRIX_ROWS][MATRIX_COLS] = LAYOUT_moonlander(1, 2, ... 72)`, each cell its position plus one), so the firmware sends positions and the host has no matrix table to get wrong.
- **Off.** At power-up, after 10 minutes, after 3 seconds with no start or keepalive, and when `raw_hid_send` blocks for 20 ms or more: QMK's send waits up to 100 ms for a host that is not reading (`usb_main.c` `send_report`, `TIME_MS2I(100)`), which on every key would be a stalled keyboard.
- **Evidence.** The C is compiled and driven on the host (`test/firmware/qmk/typing-stream.test.ts`): off at power-up, batching, the position table, each way of stopping, a blocked send, a stray start, and the bootloader command still working. The hands-free Moonlander builds in Docker beside Oryx's modules: reva 68,140 bytes (the plain build is 67,268; the bootloader wrapper alone was 67,352, so the stream costs about 790 bytes), revb 70,380. `nm` shows `__wrap_action_exec` (0x184 bytes) called from `matrix_task` and tail-calling `action_exec`, and the 84-byte position table (12 rows by 7 columns). Evidence: `.orchestrate/keyloom-2026-10-15/evidence/rung22/`.
- **Unchecked.** Nothing here has run on a keyboard (S50 is the runbook): whether it keeps up at fast typing without dropping events, and whether a real host's reads keep `raw_hid_send` fast.

### D-285: ZMK boards stream position events as text lines over the keyloom module's serial port, from the central only. (Claude, building rung 22)
- **Format.** `firmware/zmk/keyloom-zmk/src/typing.c` listens to `zmk_position_state_changed` on the central (or an unsplit board) and writes `E <position> <1|0> <ms> <source>` per event, with `source` 255 for the central's own keys and the peripheral's index otherwise, and `KLTYPE ON <ms>`, `KLTYPE DROP <n>` and `KLTYPE OFF <reason>` around them. The host writes `KLTYPE START`, `KLTYPE PING` and `KLTYPE STOP`. `src/firmware/zmk/typing-stream.ts` has both directions.
- **Clock.** The central's `k_uptime_get()` as ZMK stamps the event, so both halves' keys share one clock and one order. A peripheral key's time is when the central got it, which is the split latency S51 measures.
- **Off.** At power-up, after 10 minutes, after 3 seconds without a ping, and without a message when the host closes the port (DTR low). A 64-event queue holds events for the thread that writes them; overflow is counted and reported.
- **The 1200 and 1201 baud triggers are untouched.** `handsfree.c` reads line control and this file never sets it. The host sets 115200 with `stty raw` before it opens the port and holds it open, so closing it is a close at 115200, which the trigger ignores.
- **Where it builds.** `CONFIG_KEYLOOM_TYPING_LAB` defaults on with the hands-free module and the file compiles to nothing on a peripheral. Both Docker builds link it: the Glove80 UF2 carries `KLTYPE START`, `KLTYPE ON %u` and `E %u %u %u %u`; of the Corne's two images exactly one does.
- **Evidence.** The C is compiled and driven on the host (`test/firmware/zmk/typing-c.test.ts`): off by default, the handshake, the limits, a closed port, queue overflow, long and split commands. `test/firmware/zmk/typing-build.docker.test.ts` is the Docker proof.
- **Rejected.** A ZMK raw-HID module, for the reason D-095 gave (central only, and nothing in this module's path); snooping the USB HID report, which is after the tap or hold decision.
- **Unchecked.** Nothing here has run on a keyboard (S51 is the runbook): that `uart_irq` reads and `uart_poll_out` writes keep up on the Glove80's USB, and the split latency.

### D-286: A recording is read as steps and presses, lined up by edit distance; what the firmware did is what the emulator's reports say; settings are tried by replaying the same recording. (Claude, building rung 22)
- **Replay input.** The trace is sorted, started at zero, rounded to whole milliseconds, and a pause over 3 seconds is cut to 3 (`src/lab/replay-input.ts`): no tap-hold decision looks that far back, and ZMK's emulator cannot wait more than 32. One list feeds the presses the analysis reads and the events an emulator is given.
- **Intent.** A passage is text steps and "hold" steps (hold the mod-tap that types S, press K). A character is the base-layer positions that type it. The presses are lined up with the steps by edit distance, so a mistyped key is one wrong key, not a missing key and an extra one.
- **Classification** (`src/lab/classify.ts`). Typo: a press the step did not ask for. Missed: a step nobody pressed ("you"), or a press that produced nothing ("keyboard"). Double: an extra press of the same key within 120 ms of the other. Hold where a tap was meant: a hold-tap press whose letter did not come out. Tap where a hold was meant: a hold step whose modifier did not go on. "Came out" is a report in the key's own window (its press to 100 ms after its release, and not into its next press) in which the code, or the modifiers, newly went down. Only the base layer is read, and a layer hold has no modifier to see, so a layer-tap meant as a hold is not judged.
- **Search** (`src/lab/search.ts`, `candidates.ts`). Candidates are the tapping term in steps of 40, 80 and 120 ms (then 20 ms around the best), permissive hold, hold on other key press, chordal hold, flavors, quick tap and require-prior-idle, each as ordinary change ops. Each is scored by misfires removed minus misfires introduced on the keys it changes. Candidates for different profiles are independent, so one emulator run tries one candidate for every profile at once; that, and a budget of 12 runs, are why the search goes from big steps to small ones and says so when it was cut short. A suggestion is offered when it removes at least 2 and at least twice what it adds; a fix that helps in one place and hurts in another is explained in the notes instead of offered.
- **Per firmware.** QMK can set the term, permissive hold, hold on other key press and quick tap per profile, but chordal hold and flow tap only layout-wide (`emit-tapping.ts` refuses the rest), so those are tried alone and scored on every key. ZMK has them all per profile, except that positional hold is one list per hold-tap: a profile used on both hands is split into one per hand, and each key is rebound.
- **Proposals.** Each offered suggestion becomes a proposed change set with source `agent` (a new source would rebuild `change_sets` for a label), its counts in the explanation, a gains and costs line, and a decision draft so applying it can be asked about a week later (D-058). Analysing a session again rejects the proposals it made before.
- **QMK needs a lead.** QMK treats a timer of zero as "not started": a combo whose first key goes down at exactly 0 never times out. The lab's replays start the QMK harness 100 ms before the first event and take it off the reports (`leadMs`); `keyloom emulate` keeps its exact times. Found on the real core: BK's S and D together are a Shift combo, and a recording that began with S then D in a roll lost both letters in the first roll only.
- **Combos.** A key the firmware swallowed because it and another key of a combo went down together is one "missed" difference at the combo's first key, and a finding says which keys, what the combo does and how often. Settings for combos are not searched.
- **Positional hold on ZMK.** `hold-trigger-on-release` makes ZMK note the other key at its release, but a hold-preferred key is decided when that key goes down, so the check saw nothing and the hold stood (seen on the Glove80's build, moergo-sc/zmk@ce69e85 `behavior_hold_tap.c` `decide_positional_hold`). The split profiles therefore set it only for flavors that wait.
- **Checked.** The model in `test/helpers/typing-lab.ts` stands in for the firmware in fast tests. The real cores are in `test/lab/emulator.docker.test.ts`: a recording built to misfire is classified, the search's best ops are applied, and the same keys replayed through the real core misfire no more.

### D-287: The host reads the streams with a held-open raw HID session (IOKit with a pumped run loop, or a polled device node) and a polled serial port set raw by `stty`. (Claude, building rung 22)
- **macOS HID.** `IOHIDDeviceRegisterInputReportCallback` on a device kept open, with the callback run by `CFRunLoopRunInMode` for an instant every 2 ms from the main thread, so JavaScript stays single-threaded. Written from the IOKit headers and not yet run on a keyboard; the registry listing and the symbol loading are tested.
- **Linux HID and serial.** A non-blocking descriptor polled every 2 ms (`polled-file.ts`): a blocked read in a thread pool cannot be cancelled, and would keep a closed port busy. The same code reads a FIFO, which is how it is tested. Serial runs `stty raw -echo 115200` first, then holds the port.
- **Where the readers live.** `src/firmware/qmk/typing-capture.ts` and `src/firmware/zmk/typing-capture.ts`, not `toolchain/`: the toolchain may import nothing (`dependency-cruiser`), and a reader needs its protocol. Transports in `toolchain/` gained `openSession` and `open`.
- **Never a real device in tests.** `test/helpers/no-real-flash.ts` refuses `openSession` on the real transport, `SerialTransport.open`, `openWithStty` on a `/dev` path and `openPolled` on one. The fake keyboards in `test/helpers/fake-key-stream.ts` speak the real protocols.
- **The probe.** `scripts/lab-probe.ts` is the hardware runbooks' tool: it prints events with their gaps and says how the stream ended. Nothing in the build or the tests runs it.

### D-288: A session lives in one table and nowhere else; the agent gets counts, words and key names. (Claude, building rung 22; BK's bounds in D-280)
- **Stored.** `typing_sessions` (migration 0009): the layout and revision, the board, start and end, the passage, what was typed, the trace, the analysis. Nothing else holds them. The firmware's output is a copy of what was typed, so replays for the lab are not saved for next time (`cache: false` on the ZMK emulator, which otherwise keeps up to 40 logs by their inputs), and the emulator log of an analysis (`logs/lab-<id>.log`) is removed when the analysis succeeds; a failed one keeps its log so the person can see why, and `lab delete` removes it. `keyloom lab delete` removes the row, and so the trace, the typed text and the analysis. A change set made from a session stays until it is rejected; it holds counts and a key-name example, not the recording.
- **Told first.** `lab start` prints what is recorded, that it stays on the Mac, not to type passwords, and how to delete it, before the first key is heard, and only after the checks that can refuse. It needs a terminal, shows the passage and the typed text, and Ctrl-C ends it. A recording with no key presses is not saved.
- **The agent.** `get_typing_findings` returns counts, the per-finger table, the findings in plain words, and each suggestion's counts with examples as key names and milliseconds. Never the passage, the typed text or an event. The system prompt sends it to the tool first when BK says his home row mods misfire.

### D-289: Findings are per finger and in words, from the board's own finger table; the passages are built from the layout. (BK's D-283, Claude building rung 22)
- **Numbers** (`src/lab/stats.ts`): time from the previous key down to this finger's key down (a gap over a second is a pause, not a transition); errors over what the finger was asked to press, missed keys included; same-finger pairs; for each pair of keys, how many transitions and how many had the second key down before the first came up, and by how much; mod-tap hold times for taps and for holds, with how many taps came within 20% of the term. A pair or a key needs 3 examples to be reported.
- **Sentences** (`sentences.ts`) are generators with a weight, not a template per number: a finger is named for errors only when its rate is 1.5 times the overall one; for speed only when it is 25% and 30 ms slower than the rest; a roll gets its overlap and, for a mod-tap, what it types held and its term; modifiers are said as a Mac says them (Option, Command). Keys are named by what they type.
- **Passages** (`passages.ts`): everyday sentences; every neighbouring home-row pair rolled both ways; every home-row mod held with a plain key on each hand; each finger's own keys. The "starter" is a few holds, the rolls and two sentences, about three minutes. Your own text is lowered and cut to what the lab can ask for.


### D-290: A QMK lab suggestion retunes every key with the same tap and hold, and the search offers nothing the validator rejects. (Claude, fixing BK's Moonlander)
- **Why:** QMK picks TAPPING_TERM, QUICK_TAP_TERM, PERMISSIVE_HOLD and HOLD_ON_OTHER_KEY_PRESS by keycode, so "raise Home-row mods to 280 ms" failed the layout's checks whenever LALT_T(KC_S) also sat under another profile. A candidate that edits those options now rebinds the other copies to the profile being tuned (`withSharedKeys`, `src/lab/candidates.ts`). Their options already agreed, so the move changes nothing but the new value, and the other profile's unrelated keys stay put. The rebinds are part of the candidate's ops, run in its replay and counted in its gains and losses; such a candidate runs alone, since it changes another profile's keys.
- **Guard:** every suggestion goes through `validate` (the check Apply makes) before it is returned; a rejected one is dropped and the reason goes in the analysis notes.
- **ZMK is unchanged:** each profile is its own behavior node (`emit-behaviors.ts`) and `zmkOptions` (`hold-tap-rules.ts`) has no same-keycode rule, so a term set on one profile cannot disagree with another.

### D-302: The migration keeps what the engine already did: a board's config is the layout of its last verified sync, else its newest edited. (Claude, rung 23)
- **Why:** the engine tracked the layout its keyboard's running build came from before it fell back to the newest, so "newest per board" would have changed what gets flashed. A verified sync is the stored form of "the running build". On BK's data (one layout per board) both rules give the same answer. Past verified syncs also become versions.
- Migration `0010_configs_and_versions.sql`; tests in `test/persistence/configs-migration.test.ts`.

### D-303: `sync` refuses a config that is not on the keyboard; only `config use` changes which one is. (Claude, rung 23)
- **Why:** a manual sync of any layout used to put it on the keyboard. That would make "the config on the keyboard" a label the CLI could contradict. `keyloom sync <config>` now names `keyloom config use` instead.

### D-304: The stored config is the intent; a keyboard running another config of the board is "behind (other_config)" and auto-sync leaves it. (Claude, rung 23)
- **Why:** a keyboard flashed by hand with another config must never be replaced because the stored choice disagrees. Only `config use` (a manual sync) replaces it. `config use` stores the choice only after the keyboard passed `sync`'s own checks (attached, keyloom firmware, nothing else syncing), so a refusal leaves it as it was; if the sync then fails, the choice stays and the state reads behind.
- **Mid-sync switches:** a build of a config that stopped being the board's is stopped, and the engine checks again right before the remapper apply and right before the flash. A flash that had already started finishes and is recorded as what is on the keyboard.

### D-305: A copy is a new layout with its own history starting at the copied document, and a link back; it does not carry decisions or conversations. (Claude, rung 23)
- **Why:** history is per layout and append-only. The first revision of a copy has origin `import` (the column's check constraint predates configs) and a summary saying where it came from. `copied_from_*` are plain columns, so deleting the source leaves the copy standing with its link naming a deleted config.

### D-306: A blank config is one empty Base layer sized to the board; a software remapper starts as its identity map. (Claude, rung 23)
- **Why:** boards carry no default keymap (the firmware tree's own is not in the repo). A remapper with an empty map would silence the laptop's keyboard the moment it is put on.
- **Open:** a real default keymap per board would need a pinned file in each board folder (04). D-370 closes it: the board's revision already pins the tree, and the default is read from there; the empty layer is the fallback.

### D-307: A version is one row per revision; putting a revision on again moves its put-on time forward and reopens it. (Claude, rung 23)
- **Why:** it keeps names attached to the revision. The cost is that an earlier stay of the same revision is not kept. Versions are written inside the transaction that finishes a verified sync, so one exists exactly when the other does, including after a crash recovery that confirms a flash.

### D-308: Delete needs the config's name and refuses the config on a keyboard and one a sync is using; it removes the config's revisions, change sets, decisions, conversations, builds, syncs and versions. (Claude, rung 23)
- **Proposed exception:** D-402 gives new workspace conversations an independent lifecycle, so deleting their origin config cannot erase another target's work. Legacy layout-owned conversation deletion stays unchanged.
- Build files on disk stay.

### D-309: Compare is a per-key diff of documents (revision against head) plus named changes for the rest; it is the same structure the restore changes. (Claude, rung 23)
- **Why:** there was no document differ, and a change set is not the difference between two revisions. `src/layout/diff.ts` is pure. Restoring a version goes through the go-back path (D-170), refuses a restore that would change nothing, and does not sync.

### D-312: Everything else is drawn in the concept's language: sheets with quiet heads and borderless rows, keys as small caps, one filled action. (P4, Claude)
- **Sheets** (History, Library, Combos, Settings) share one head (title, a line saying what it is for, close) and rows without rules that lift on hover; their actions are quiet links until a row is pointed at (`src/web/shell/Sheet.tsx`, `sheet.css`). Keys appear as small caps of their legends. History says "On screen" for the head and "Go back to this" / "Put this on the keyboard"; summaries stored with key numbers are read without them. Library names macros by what they send and imported tap dances by what they do. Combos list their keys as caps, an arrow, and what they send. Settings marks a staged option with the amber dot and shows Apply only once something changed.
- **Sync** opens a sheet from the sync line: the board, the state in words with its light, why, and the one thing to do as the only filled button; auto-sync and Build and flash below. The MacBook's states ("kanata isn't running", remapping off, Disable remapping) use the same sheet. Build and flash is one card over a dimmed stage.
- **Import** is a page: the title as the caption sets it, one card per board with the board drawn as itself, the whole card takes the drop, and the terminal command is folded away. **Board dev** draws the board as the editor does, case and all, on the backdrop.
- Every editor sentence names keys by what they print (D-279), so key numbers appear only in Advanced view and board dev.
- **Amended by the P4 review.** History rows are read into people's words when shown, old summaries too: the changed key as a small cap, the layer and how the row came about ("Undone", "Went back") on the meta line, modifiers as the caps say them ("control + option"), "Renamed a layer to Numbers" for an id, and no colon chains (`src/web/history/history-words.ts`). Settings rows are one line of words with the rest under "More"; the amber dot marks an option staged here, not one that differs from the default; Apply stays pinned at the sheet's foot while anything is staged. The sync popover's body is one line, with what keyloom read (a USB serial) behind "Details"; the line in the top bar only says the state, and the popover's filled button is the one action. Import fits 1280×577 with every drop zone in view, and its switcher draws the boards' silhouettes. Library shows every use as caps, a combo's keys too. The view controls (D-311) stay: quiet labels at 1366 and wider, icons with tooltips below, the same on every board. With the Combos sheet open, pointing at a row draws that one combo.

### D-313: On a phone the chat is the conversation panel's design in the bottom sheet, and the sheets run the full width. (P5, Claude)
- The phone's chat uses the same component and design as the wide screen's conversation panel (D-310): no "Chat" header, the ⋯ menu and esc beside a quiet input, the neutral no-model state with ready providers one tap away, and the newest option pinned so it shows on the caps above the sheet at once. Not this and Apply stay pinned at the sheet's foot while the option scrolls. The sheet's controls are 44 px for a fingertip.
- The bottom sheet runs edge to edge; the wide screen's right-hand margin had left a strip of the stage showing.
- History reads a change from the chat as its first sentence, and Build and flash names a long revision the same way (`headline` in `src/layout/history-summary.ts`), so neither shows the agent's whole explanation.
- History shows a change from the chat in full, clamped to two lines with the rest on hover or focus, with key numbers older prompts wrote read away ("Key 19 on Layer 0 (R)" is "the R key on Layer 0"); the proposal tool and the system prompt now ask for titles, explanations and trade-offs that name keys by what they print, since the explanation becomes History's line. A swap row is its two caps, "[I] ⇄ [T]", with the layer on the meta line.
- The view controls switch to icons when their labels would meet the layer strip, measured against the strip itself (the Glove80's long layer names), not the stage's width.


### D-314: The typing lab's screens: findings in rose, the read-out in the conversation column, the fingers as the headline. (Lab screens, Claude; approved by the coordinator for BK)
- Findings are rose (`--finding`), a colour no other meaning uses; amber stays "not on the keyboard yet". The recording light is the case's own LEDs turning rose while the lab listens, beside a pill with the clock and Stop.
- The read-out sits in the conversation column beside the board (D-310's place), so the caps it marks stay in view. A finding opens in place with one misfire slowed down and the fixes tried on those keys; "Try the fix" previews the proposal on the caps, and Apply is the ordinary change set apply, followed by "Type again in a few days to see if it stuck."
- Per finger is the headline (D-283): the read-out starts with one sentence naming the slowest finger and the one with the most errors, counted, and a fingers block lists all ten with speed and errors; the board's heat switches between the two. Typos and misfires are both counted per finger, on the finger that pressed. The per-finger findings are not listed again under it.
- "How fast is each finger" (the finger drill) is offered on the start card; after a drill the fingers block comes straight after the headline.
- While the lab listens, everything but the passage, the board and the pill dims: the top bar's status and controls and the layer strip.
- On a phone the start card says the lab needs a keyboard plugged into this Mac and shows past sessions' read-outs only; nothing records from a phone.
- The screens talk to `/api/lab/...` routes in the `/api/configs` style (`src/api/lab.ts`, `src/server/lab-routes.ts`), one recording at a time (409 on a second). Their tests and demo use a scripted fake Moonlander over the real stream protocol (`test/helpers/lab-world.ts`); nothing touches a real keyboard.

### D-315: Configs and versions screens: the caption's switcher becomes "Config ▾", green is "on your keyboard", and History is told in versions. (Configs screens, Claude; comps approved by the coordinator for BK)
- The caption's layout switcher is the config switcher, renamed "Config", and lists only this board's configs, the one on the keyboard first with a green "On your Moonlander". Other boards are reached from the top bar's board switch, which now opens a board on the config its keyboard runs. The menu holds New config, Rename, Archive (refused for the one on the keyboard, and it says why), Archived (n) with Restore, and Import.
- On a window under 620 px tall the caption keeps the config switcher and drops the line saying how to reach the layer (it used to drop the switcher), since the switcher is now the only way to another config.
- Green means "on your keyboard"; amber stays "not on your keyboard yet". While the config on screen isn't the keyboard's, the sync pill's place reads "Editing X · Y is on your Moonlander" with "Put X on it", and one confirm puts it on (`/api/configs/:ref/use`). The line sheds words as the top bar narrows: below 1440 px it drops which config the keyboard runs (the confirm says it), and below 1120 px and on a phone it is the "Put on" button alone, the caption naming the config. The old "Put this layout on it" sync line, which asked the engine for a sync it refuses (D-303), no longer shows.
- New config starts from this config as it is now, a version of it, Blank ("one empty layer to start from", D-306: boards carry no default keymap), or a file (the import screen).
- History is the config's versions (`/api/configs/:ref/versions`): changes not on the keyboard yet in amber, then each version on a rail, the current one green, with how long it was on and the changes made under it folded. A version can be named in place, compared with now, gone back to, put on the keyboard, or copied into a new config. Every revision is still listed with Go back. Per-revision "Put this on the keyboard" (a flash of an old revision that auto-sync would undo) is replaced by the version's Put on keyboard.
- Compare with now marks the keys going back would change in the proposal's amber, each with a small "then" tag, and lists keys per layer and the rest in words.
- Putting an old version on the keyboard has no engine path of its own (the engine syncs a config's head), so it is the restore (D-170, the same as `version restore`) followed by the config's sync, or by the put-on when the config isn't the keyboard's, under one confirm. The restore makes the version the head, which is also what keeps auto-sync from putting the newer head back: chapter 25's "ask whether to make it the head first" is that confirm.
- ⌘K offers commands above "Ask keyloom" when the text names them: Typing lab (lab, typing, test, finger speed), New config, Switch to <config>, Put <config> on the keyboard. Enter runs the highlighted row; a text of more than six words highlights "Ask keyloom" instead, so a question that happens to say "test" still goes to the chat. Matching is words, not a model (`src/web/chat/commands.ts`).

### D-316: Compare says keys in words, an archived config can be deleted from the switcher, and a toast survives the switch. (Configs polish, Claude; asked by the coordinator)
- Compare with now names each key by what it does, the way the Library and the key card do ("Hyper + Space, twice for ["), and says what changed: a slot a tap dance gained, lost or changed ("now also holds for Hyper"), a hold a key gained or lost, or that keyloom now reads what was firmware code. The compare route carries the older revision's layers, macros and tap dances (`fromContext`) so the older side can be named too; the CLI's compare output is unchanged.
- Delete is in the switcher under Archived, beside Restore, for archived configs only, and needs the config's name typed, the CLI's guard. The server checks the name again and refuses the config on the keyboard.
- Switching config remounts the layout page, which dropped the toast raised just before it ("Archived X", "Made X", "Restored X"). That toast is left in sessionStorage and shown once by the page that opens; without storage it shows on the page that raised it.

### D-317: A key's draft outlives its card, ⌘K takes it along, and a board switch keeps the layer and the thread. (Journeys, Claude; asked by the coordinator)
- **Proposed extension:** D-402 replaces the read-only carried-thread handoff with explicit per-request focus in a continuing conversation (Q31). Draft preservation and board-switch layer selection remain. The extension is not built.
- An unapplied draft is kept by its key when the card closes, another key opens, the layer switches or ⌘K opens; nothing blocks on it any more. On the board it draws as it would be, with a dashed amber ring (a proposal's ring is solid), until it is applied or discarded from its card, which reopens on the draft. A draft whose key changes under it (an undo, the chat, another tab) is dropped, and a toast says so. Kept drafts live in the page (`src/web/editor/parked-drafts.ts`), not the database: a reload loses them.
- ⌘K with a draft open keeps the draft and opens the chat; the chat says which drafts go with the message, and the request carries them (`drafts` on `POST /api/layouts/:ref/chat`). The agent reads them as a header line before BK's words ("Unapplied draft on Layer 0, R at position 18: would become P {…}"); the stored message shows only what he typed.
- Switching board or config lands on the layer with the same name, if the next layout has one (case ignored), and keeps the chat open. A conversation belongs to one layout: it is stored with its `layout_id`, and its agent reads and proposes against that layout. So the thread travels as what was on screen: the page carries its turns to the next layout, which shows them read-only above its own, without their options (they'd apply to the other layout), under "Earlier, about synchronized on your Moonlander". The next message starts that layout's own conversation. The carried turns live in the page, not the database.
- Swap from the key card is ⌥S, not S. With a card open, a plain letter types that key into the tap slot (18#keyboard-use, "click the key, press A"), so S can't also swap. The tooltip, the shortcut list and chapter 18 say ⌥S, as ⌥C, ⌥H, ⌥L and ⌥I do (D-311).

### D-318: ⌘K opens in the side column, never as a bar at the stage's foot. (BK, 2026-10-16; reverses D-310's bar for quick asks)
- BK: "How come the cmd k menu still opens at the bottom and blocks the layer selector when i explicitly asked you to fix this because as the conversation gets long i have to scroll to read and the fact that it blocks other UI when there's space on the sides."
- On a wide screen the chat is the full-height column beside the board from the first keystroke; the board re-fits beside it and the layer strip stays clear. The short-window folded line goes with the bar, since the column never covers the board. The phone keeps its bottom sheet (D-313).

### D-341: The Glove80 is drawn from the real object: a stepped body and a curved thumb module per half, with the halves apart. (BK's request, Claude)
- BK: "render it correctly", after seeing the hugged case (D-277) run the two thumb clusters into one shape. The Glove80 now has a `display.case` like the Moonlander's, drawn from MoErgo's top-down render and the white halves (`glove80-ref/20.png`, `21.png`) around MoErgo's own geometry, which is unchanged. The generator and its key check are `light-build/glove80-case.py` and `glove80-case-check.py` in the build evidence.
- Each half is one body whose top steps with the column stagger: the pinky columns lower, columns 2–4 highest, the inner column lower again where it has no function-row key. The thumb module is a band about the thumb keys' own pivot (4.5, 9.25), its outer edge an arc 0.45u past the outer row, its inner edge an arc 0.3u inside the inner row. It meets the body along a seam that runs between the B key, the bottom row and the first thumb keys, and its point shows below the body there, as on the real one.
- `display.shift` moves the right half 1u further out, so the halves stand apart: the bodies 7u, the thumb modules 0.35u at their closest. The case's margins are kept tight enough that the keys stay the size they were (56, 43, 37 and 35 px at 1440×900, 1366×768, 1280×577 and 390×844).
- Every cap sits inside its own body or module, at least 0.12u from the edge (0.12u only at the seam's pinch between the bottom row's inner key and the first inner-row thumb key; about 0.3u on the outer edges), and no part of one half meets the other's.
- The column wells stay (D-266): a drawn case now keeps the wells computed from the keys when `display.surface` is "wells".
- Not matched, because the geometry is MoErgo's straight-column layout: the real columns curve and splay, the pinky columns sit about 0.2u lower rather than 0.5u, and the body's outer edge is more concave. Palm rests are left out.
- **Replaces** D-277's hugged Glove80 case (`display.caseHug`), which no board now uses.

### D-342: keyloom is AGPL-3.0-or-later, replacing MIT. (BK, 2026-10-16)
- BK: "this should have a license that allows open source but contributions should be contributed upstream i think its agpl3 or something like that".
- AGPL-3.0 keeps keyloom open: anyone who distributes it, or runs a modified version as a network service, must publish their changes under the same licence. No licence can make people send changes upstream; AGPL makes them public, so they can be taken. Contributions come in under the same licence (inbound = outbound, CONTRIBUTING.md). Relicensing later, for example commercially, would need a contributor licence agreement; none is in place.
- Every commit is BK's, so he can relicense. Releases up to v0.34.7 stay MIT for whoever has them. "or-later" is GNU's standard form, and it sits with the GPL-2.0-or-later QMK keycode data in `src/layout/keycodes.ts` (see the entry on generated keycodes), which MIT did not.

### D-340: A board review is made without being asked, once per revision, with the checks at once and the agent after, and shown as a calm marker, marks and a review in the side column. (Engine and screens, Claude; comps approved by the coordinator for BK)
- BK: "when I connect a keyboard, the ai immediately analyses that board and stores a state of the board with all the warnings and hints and suggestions … it would be nice if it's proactive."
- A review belongs to one revision of one config and is stored (`board_reviews`, `review_items`), unique on config and revision, so it is read, not recomputed, and survives a restart. [27](27-board-review.md) has the shape, routes and states.
- The checks are the validator's standing warnings plus one new check, `keys_do_nothing`. They are cheap and need no model, so they show even when the agent's part is unavailable or failed.
- Rejected: a review that exists only in memory. It would be gone on restart and could not carry a dismissal or a "fixed" tick from one revision to the next.
- **Screens (the designer's half).** A note on the dash, not a linter. Nothing opens by itself, and every action is a visible button (D-337).
  - **The marker.** It sits by the config name in the caption: "● 2 problems · 2 hints", "Looking over your change…" while the review is stale, "Looked over · nothing to note", or "Not looked over yet". The colours are rose for a problem, grey for hints, and green for nothing to note.
  - **Marks.** A problem's keys wear the lab's rose ring and a hint's keys a faint dot, on the layer on screen. A problem about a layer puts a rose dot on its tab in the strip.
  - **The review.** One click on the marker opens it in the side column (a sheet on a phone), as Problems, then Suggestions (each under what it fixes), then Hints. Words carry keys as caps and layers as chips, read from the `{key}` and `{layer}` markers. A key with no legend is never a cap, because a cap reading "empty" says nothing: it reads as its place in the board's rows ("an empty key on the function row"), and "keys do nothing" counts its keys by row ("5 on the function row, 2 by the thumbs"). Its keys stay marked on the board. The source says "Check" or "keyloom".
  - **Actions.** Show the layer or Show the keys; "It's on purpose · hide" on a problem, "Hide" on a hint; and on a suggestion "Show it on the board" (it pins the proposal, amber on the caps), Not this, and Apply (the ordinary change-set apply). Hidden items are counted in the footer and listed with "Show it again" under "Show hidden".
  - **States.** A stale review fades its items under "Checking the new version". While the agent's part is pending, a quiet line says it is on its way. When unavailable or failed, a dashed box says so in plain words ("Suggestions need a model, and none is set up.") with one button: "Set up a model" opens the chat's provider picker in place, and the review looks again once a ready model is chosen; "Try again" reruns a failed look. The engine's technical reason sits behind "Details". The checks show either way.
  - **Fixed.** A review that arrives while the page is open with `fixed` items shows them ticked green at the top of their group and says so once in a toast.
  - **Not counted twice.** The caption's "proposals waiting" no longer counts the review's own suggestions.

### D-343: Triggers are level-triggered from the database and the sync engine's last reading, and a revision with a review is never asked about again. (Engine, Claude, from D-160)
- Every second the review engine asks which head has no review and should. Connect is the config on a board's keyboard while that keyboard is connected. Apply and import are a head made since the server started, once the sync engine's quiet time has passed with no further change.
- The same shape as the sync engine, for the same reason: a burst of Applies, a restart and a keyboard that comes back are one question with different answers, and there is no event queue to get out of step.
- A config nothing touched while its keyboard was away has no review until it is asked for (`POST …/review/run`, `keyloom review --run`). Reviewing every config at start-up would spend a model call on each of them for nothing BK did.
- `source` is `agent`, not the comps' `ai`, so the word in the data is the word in the code.

### D-344: The agent's review is one run with the conversation's tools, hands its structure back through `submit_review`, and can only suggest what `propose_changes` saved. (Engine, Claude, from D-014)
- No tool that needs BK (no priority or outcome recording), a budget of 10 requests and 14 tool calls, and one run per revision, cached. `force` runs it again on purpose.
- A suggestion whose `proposalId` the run didn't save is dropped, so every suggestion shown has been through the validator against the head, outside any conversation, and sits in the config's open proposals (D-336). Nothing is applied.
- Keys and layers the model names are checked against the layout, and an item that repeats a check is dropped.
- Rejected: asking for JSON in the reply and parsing it. A tool's schema is checked by the same machinery as every other tool, and a reply that is not JSON needs a recovery path.

### D-345: An agent part that cannot run says so in words and can be retried: `unavailable` for no provider, `failed` for the rest. (Engine, Claude)
- No provider set up is the normal state of a fresh install, so it is `unavailable` with the steps to set one up, not a failure. A refusal, a cut-off, an API error, a layout that moved during the run and a process that died are `failed`, each with its reason.
- A start-up marks runs the last process left `running` as failed, so a screen is never left waiting. A claim in the database keeps the server and `keyloom review --run` from both running one review.
- A run that finds the layout has moved on withdraws its own proposals; the new revision gets its own review.

### D-346: What a new revision fixes, and what BK hid, follow the finding's id; a new review withdraws the old suggestions' open change sets. (Engine, Claude)
- `fixed` lists the previous review's problems and hints that the new revision no longer produces, with `fixedSince`. A finding that is still about some of the same keys has changed and is not ticked off ("9 keys do nothing" becoming "8" is not a fix). A hidden finding is not ticked off. The agent's findings count only when its look finished in both reviews, because a missing look is not a fix.
- Hiding is stored by config and stable id, so it follows the finding to later revisions and ends when the keys change (D-340).
- The previous review's suggestions are about a revision that is gone. Their change sets are rejected when the new review is made, so the open-proposals list does not collect one set per revision.

### D-347: No test calls a model: the test preload removes every credential. (Engine, Claude)
- The review runs the agent by itself when a layout changes, so any test that serves or edits a layout could reach whatever model the developer's shell can. `test/helpers/no-paid-model.ts` removes the keys and points the Codex binary at nothing before every test file. A test that wants a model passes a scripted one, as the chat tests do.

### D-348: The Glove80's Magic key opens the wrong layer because BK's own keymap says so; keyloom did not cause it, and the review reports it. (Engine, Claude, from the owner's question)
- BK's `42-key-map` branch of `bhekanik/glove80-zmk-config`, from its first commit with the binding (`6c425b5`, "layer 2", 2025-05-29) to its head (`93b6ac8`), binds `&magic 5 0` on a keymap whose layers run default (0), one_shot, numbers, navigate, magic_layer (4) and factory_test_layer (5). The default branch `main` is a different keymap and uses `&magic MAGIC 0`. The `#define MAGIC 2` above it is stale from the four-layer keymap before.
- keyloom's import stored the binding as it was: the first revision of "Glove80 (42-key-map)" already has `&magic 5 0`, and no revision since has reordered layers or touched that key. Reorder does not renumber anything; it refuses when a kept block names layer numbers (`passthroughLayerIndex`, [docs/issues/reorder-blocked-by-layer-numbers.md](../issues/reorder-blocked-by-layer-numbers.md)).
- The review reports it twice: the check `layer_unreachable` (nothing opens the Magic layer) and, when a model is set up, the agent's suggestion with a validated change set. No importer change was needed.

### D-350: A mirror map pairs what really mirrors; unpaired keys are allowed. (Board-contribution fixes, Claude; asked by the coordinator after the Unix60 and Charybdis tests)
- The old test required every key to have a partner and every pair to be symmetric about one axis. An uneven thumb cluster (the Charybdis's five left, three right) and a one-piece staggered board (the Unix60) can't meet that honestly, so contributors either broke the test or fudged the map.
- What the agent relies on stays guaranteed, by `mirrorProblems` in `src/boards/mirror.ts`, which `boards check` runs as errors: each source is a left key and each target a right key, a target is used once (the two-way partner map would lose a pair otherwise), and a pair is on one row and under one finger (so a mirrored home-row modifier lands on the key the same finger rests on).
- Unpaired keys are allowed. `boards check` still warns about each unpaired left key of a split board; a one-piece board with an empty `mirror` gets no warnings.
- Geometric symmetry is tested only where the drawing is a mirror image: halves of the same key count on a split board (D-359). There every key must also be paired, as before.

### D-351: A one-piece board stays whole on a phone. (Board-contribution fixes, Claude; asked by the coordinator)
- The phone showed one hand at a time for any board with keys in both hands. For the Unix60 and the MacBook that dropped the drawn `hand: null` case for computed trays and ran the 34- and 43-key right halves off a 390 px screen.
- A board is one piece when its drawn case has a body or deck with `hand: null`, or, without a drawn case, when less than 0.5u separates its hands' key boxes (`isOnePiece`, `src/boards/one-piece.ts`). The narrowest split shipped, the Moonlander, has 1u.
- A one-piece board is drawn whole and scrolls sideways when its keys would otherwise go under the minimum size, rather than shrink further. Split boards keep the Left and Right switch.

### D-352: A QMK keymap.json imports as the keymap.c `qmk json2c` would write. (Board-contribution fixes, Claude; asked by the coordinator)
- QMK's stock keymaps are often only a Configurator `keymap.json`, and import failed with "no keymap.c". A folder whose keymap.json has `layers`, or that file on its own, is turned into a `keymaps[]` array of `[n] = LAYOUT(...)` calls and parsed by the keymap.c path, so keycodes go through the one parser and mapping.
- Each keycode must be one C argument (balanced parentheses, no comma outside them, only identifier, digit, `(`, `)`, `,`, `|` and space characters), so a string can't change a layer's key count or end the call. Anything else is refused by layer and key.
- The keymap.json's own fields (keyboard, keymap, layout, layers, author, notes, version, documentation) are not kept; any other field (config, modules) is kept as the keymap.json passthrough the generator writes back.
- Tested on the Charybdis 4x6 default keymap at qmk_firmware `180f394b`, kept as a fixture with QMK's GPL-2.0 licence (GPL-2.0-or-later, which AGPL-3.0-or-later can include).

### D-353: `ball` is a case-part kind for a trackball. (Board-contribution fixes, Claude; asked by the coordinator)
- The Charybdis drew its trackball as a `sensor`, which is near invisible on the dark theme. A `ball` part is the ball's outline; the editor draws a dark socket ring just outside it, the sphere with a radial gradient lit from the top left, and a faint rim. The gradient's stops take theme tokens (`--ball-hi`, `--ball-lo`, `--ball-socket`, `--ball-socket-rim`), so it reads on a pale case and a dark one.

### D-354: The stage-fit test sizes every shipped board in measured stage sizes. (Board-contribution fixes, Claude; asked by the coordinator)
- `test/web/fit.test.ts` only checks that legends fit their caps; nothing caught a board running off the stage. `test/web/stage-fit.test.ts` sizes each shipped board as the editor does (`canvasAround`, `fitUnit`, now pure) in the `.keyboard-well` content box measured in the demo editor: 1376×545 at 1440×900, 1216×356 at 1280×577 and 366×592 at 390×844. A shell layout change that moves those should update the table.
- The phone row uses the mouse's 34 px floor, as the screenshot browser does. Under a fingertip the floor is 44 px, and a half wider than 8.3u (the Moonlander's, the Glove80's) scrolls a little by design; a half that needs under 34 px overflows under either pointer, which is what the test catches.

### D-355: Contributors number keys from 1, as the overlay does. (Board-contribution fixes, Claude; asked by the coordinator)
- CONTRIBUTING said the overlay's numbers count from 0; the overlay says "Keys are numbered from 1; board.json counts from 0", as the editor's key labels ("Key 1") do. The overlay is right: CONTRIBUTING now says key 1 is position 0 in `board.json`.

### D-356: `module` is only a physically separate plate. (Board-contribution fixes, Claude; asked by the coordinator)
- A thumb cluster printed or milled as part of the case is part of its `body`; `module` is for a separate plate such as the Moonlander's hinged thumb block. CONTRIBUTING's `display.case[].kind` row and the skill say so.

### D-357: A board's vendor folder is its maker as people know them. (Board-contribution fixes, Claude; asked by the coordinator)
- The Unix60 is `mkdl/unix60`, though QMK keeps it under `keyboards/fr4/`. The firmware's folder is a detail of the pin, not the board's identity.

### D-358: A renderer limit is reported in the board's PR, not worked around in its data. (Board-contribution fixes, Claude; asked by the coordinator)
- A contributor draws what `display` can and says in the PR what differs from the photos (the Unix60's layered FR4 edges and decal). A needed code change is described in the PR or written as a short note in `docs/issues/` in the same PR, the only file outside the board folder a board PR may touch. The skill no longer says "open an issue", which pointed at GitHub Issues this project doesn't use.

### D-359: Whether a board's drawing must be a mirror image is derived, not declared. (Board-contribution fixes, Claude; asked by the coordinator)
- Symmetry is checked for a split board (one that isn't one piece, D-351) whose hands have the same key count and whose mirror isn't empty: the Corne, the Glove80 and the Moonlander. A `board.json` flag would let a contributor switch the check off for a board it should hold for; a board that needs an exception is a code change, made with the maintainer.

### D-360: Layer numbers in kept code follow their layers; what can't be proven keeps the refusal. (Reorder fix, Claude; asked by BK)
- **Why:** `passthrough_layer_index` (D-024, S3) refused Move left, Move right and Delete on both of BK's boards, because Oryx's dual-function key (`LT(5, KC_4)`, `layer_move(5)`) and MoErgo's layer defines (`#define LOWER 1`, `&magic MAGIC 0`) name layers by number (D-181 recorded the symptom).
- **Decision:** the importer parses the kept C (tree-sitter, D-041) and the kept devicetree (D-037) and stores, on each passthrough item and each native binding, the number literals that sit in a layer position, tied to a layer id (`layerRefs`), and the lines that use a layer number it can't rewrite (`unprovable`). Generation writes each number as its layer's current index. The stored source is never edited, so `native_edit` still holds, and `src/layout` and `src/validation` stay pure: nothing parses at validation time.
- **Provable means a known position,** listed in [07](07-change-validation.md#layer-numbers-in-kept-code). No regex reads the C. A `#define` counts only if every use of its name is a layer position, and ZMK counts the keymap's own modelled keys as uses. Arithmetic, bitmasks, comparisons by order and unresolved names are refused, and the message quotes the line.
- **Delete** a layer the code or a kept key names is still refused, now naming that key or line. Delete of a layer nothing names, from anywhere in the order, passes.
- **ZMK keys use the define's name.** A layer key whose layer has `#define NAME n` in kept source is written `&mo NAME`, so the define the kept behaviours read and the keys keep agreeing, and import, generate, import stays stable.
- **A kept key counts its numbers.** `nativeKey` includes `layerRefs`, so a native key written without them is not the one that was imported (`native_edit`).
- **Layouts stored before this have no `layerRefs`** and keep the old rule until the firmware is imported again. Reading them in place would need the upgrade (D-193) to become async; recorded in `docs/issues/reorder-blocked-by-layer-numbers.md`.

### D-365: A derived QMK board with atmel-dfu, stm32-dfu or caterina is flashed by a `dfu-tool` recipe that runs the person's own dfu-programmer, dfu-util or avrdude. (Rung 21 part 2, Claude; replaces D-333's "the new recipes wait")
- One recipe kind with the tool as a field, not three kinds, because the flow is the same: wait for the bootloader, run commands, check exits, wait for the keyboard. Of the 3,687 QMK keyboards with USB IDs in the pinned index, atmel-dfu has 1,448 (39.3%), caterina 681 (18.5%) and stm32-dfu 678 (18.4%): 76%, against the 9% that had a recipe.
- The commands are QMK's own (docs/flashing.md and the `:dfu`, `:avrdude` and `:dfu-util` targets at `7a1bbf3`): `dfu-programmer <mcu> erase --force`, `flash --force <file>`, `reset`; `dfu-util -a 0 -d 0483:df11 -s 0x8000000:leave -D <file>`; `avrdude -p <mcu> -c avr109 -P <port> -U flash:w:<file>:i`. A command that exits non-zero fails the flash and the message says the board may be left in its bootloader.
- keyloom doesn't install or bundle the tools. `keyloom doctor` warns, with `brew install <formula>`, for each tool a known board's recipe uses, and says nothing about one no board needs. A flash with the tool missing fails before it waits for anything.
- Other bootloaders (`halfkay`, `usbasploader`, `bootloadhid`, `stm32duino`, `wb32-dfu`, `qmk-dfu`, `lufa-dfu` and the rest) stay `manual`. `qmk-dfu` and `lufa-dfu` (83 boards) wait until someone has a board to try.

### D-366: The wait is for the bootloader's USB ID, except for Caterina, which is found as a new serial port; and the flash ends when the keyboard enumerates again. (Rung 21 part 2, Claude)
- atmel-dfu waits for Atmel's vendor ID `03eb` with the product ID of the chip, from dfu-programmer's own table (`atmega32u4` is `2ff4`); stm32-dfu waits for `0483:df11`. A chip missing from the table, or a keyboard whose `processor` the data doesn't give, stays `manual` with that reason rather than guessing a chip.
- Caterina has no one USB ID (Arduino, SparkFun and clone vendors differ), so keyloom does what QMK's `:avrdude` does: list the serial ports before asking for the reset and take the one that appears, once it is writable. The port is listed as `/dev/cu.usbmodem*` or `/dev/ttyACM*`.
- After the last command, keyloom polls USB for the board's running `vendorId:productId` (the recipe's `detect`) for 30 seconds. A board that doesn't come back is a failed flash whose message says the write finished. A board with no `detect` succeeds on exit 0 and logs that it couldn't confirm.

### D-367: The chip is the `processor` from QMK's data, now in the keyboard index. (Rung 21 part 2, Claude)
- `scripts/gen-keyboard-index.ts` reads `processor`, else the development board's (`promicro` is `atmega32u4`), and the index was regenerated at the same pins. The file changes by that field and by `bootInstructions` on 35 keyboards that the committed index lacked although the generator already wrote it. Every atmel-dfu, caterina and stm32-dfu keyboard in the index resolves to a recipe (a test), so none is left manual for a missing chip today.

### D-368: The submodule lists were measured; ChibiOS boards need `lib/lufa` too. (Rung 21 part 2, Claude; S43)
- A derived stm32-dfu board (`ferris/0_2/base`) failed on `lib/lufa/LUFA/Drivers/USB/Class/Common/HIDClassCommon.h` because `tmk_core/protocol/chibios` includes LUFA's USB headers. Every ChibiOS list, RP2040 included, now carries `lib/lufa`; the AVR list is unchanged and builds with LUFA alone. The ZMK block and the `nice_nano//zmk` name built as written, with no change.

### D-369: No test and no smoke build ever runs a real flasher; the hardware flash stays BK's done-check. (Rung 21 part 2, Claude; from the project rule on flashing)
- Tests put refusing stand-ins for `dfu-programmer`, `dfu-util` and `avrdude` on PATH (`test/helpers/no-real-flash.ts`, as for zapp) and give each flash a fake tool and a fake USB bus. S43 built firmware and flashed nothing. None of the three recipes has run on a physical keyboard; the first real flash of each confirms or corrects the commands, the exit-code handling and Caterina's port wait.

### D-370: A blank config starts from the firmware's default keymap where keyloom can read one, and says why when it can't. (Configs gaps, Claude; asked by the coordinator; replaces D-306's empty start)
- The default is QMK's `keymaps/default` in the board's pinned tree, the ZMK shield's own `.keymap`, or for the Glove80 the template's keymap. It is fetched the way `boards geometry` fetches a layout, cached by SHA, and read by the board's own importer, so it is what importing that file would give. Nothing new is pinned: the board's revision already names the SHA.
- No default is a reason, not an error: the config starts as the empty Base layer and the first revision's summary, the CLI and the API's `note` say why (a 404, a layout the importer can't read, a file that isn't the board's size). The lookup runs after the name is checked, so a bad name costs no request.
- A keyboard put still maps onto the empty board, because its plan is written against it (D-334); only `config new --blank`, `POST /api/configs` and the dialog look for a default.
- The tests read fixtures. The real tree was checked once by hand: the Corne and the Glove80 read; the Moonlander's default names its layers with an enum, so it falls back, honestly.

### D-371: A config can be made from a file in the CLI and the API, over the importers `keyloom import` runs. (Configs gaps, Claude; asked by the coordinator)
- `config new <name> --from import <file> --board B` and `POST /api/configs` with `from: "import"` make a config from the file with the given name; `config use` puts it on the keyboard like any other. The "file" is a second positional argument because `--from` already takes a config.
- The API carries the bytes as base64 in the JSON body (up to about 1 MB), so the route keeps its JSON-only guard; the bytes go through the same temporary folder as `POST /api/import` (D-171).
- The New config dialog's "A file" already reaches the importers through the import screen and `POST /api/import`, which makes a layout, that is a config. It stays, because the screen has each board's export guide and the drop target.

### D-372: The agent's `put_config` runs `keyboard put` as proposals on a new config and applies nothing. (Configs gaps, Claude; asked by the coordinator; from D-334 and D-014)
- It calls the same `putConfig` as the CLI and the screens, with the change sets' source set to `agent`. The agent gets what was carried, what was not and why, and the keys that could take each unplaced layer key; it tells BK where the proposals wait.
- It creates a config, which is a write, but no proposal is applied, nothing is built or flashed, and the conversation's own layout is untouched. The validator checks each proposal exactly as for the screens. A taken name is an error the agent reads and answers with another name.
- The new config belongs to no conversation, so no proposal card is raised in the chat (D-336's open proposals show it).

### D-373: The default-keymap lookup is injected like the geometry fetch. (Configs gaps, Claude)
- `newBlankConfig`, the config commands and the configs backend take the same `fetchText` and `cacheDir` as `keyboard add`, so every test passes a fixture tree and none reads GitHub. The cache is `<cache>/keymaps`, keyed by the firmware tree's SHA.

### D-374: The empty fallback is the same document a keyboard put starts from. (Configs gaps, Claude)
- `blankDocument` is unchanged and still the fallback, so a blank config with no default is indistinguishable from the one D-306 made, apart from the summary that says why.

### D-375: The QMK importer resolves enum layer names to indexes and keeps them as the layers' names. (Enum layers, Claude; asked by the coordinator; extends D-370)
- QMK's own default keymaps write `enum layers { BASE, SYMB }`, `[BASE] = LAYOUT(...)`, `TG(SYMB)` and `LT(MDIA, KC_SCLN)`. The importer refused them (`keymaps[] entry 0 is written [BASE]`), so a blank Moonlander config fell back to the empty layer.
- `enumConstants` (`src/firmware/qmk/c-parse.ts`) reads every enum in the tree-sitter parse: numbers, earlier members, parentheses, `+` and `-`, implicit members counting on from the last value. A member whose value isn't computable (`SAFE_RANGE`) has none. A `keymaps[]` designator is a number or one of these members; the layers are sorted by index and must run 0 to n-1 with no gap or repeat, else the import fails saying which.
- The member names the layer (a leading `_` is dropped from the display name, `_BASE` is Base); layer ids stay `layer-n`. A keymap that mixes numbers and names has no names. Layer keys, `MO`, `TG`, `LT` and the rest resolve a member to its layer's id.
- The enum itself is not kept, and generation writes numbers as before. Tap dances and `process_record_user` code that mention a layer by name stay passthrough text, flagged as before.
- Tested on QMK's Moonlander default at the pinned SHA (fixture, GPL-2.0 with its licence) and hand-written cases with explicit values. Checked against GitHub: a blank Moonlander config now gets BASE, SYMB and MDIA. Known: that keymap's `VRSN` custom keycode imports as native and its `case VRSN:` as passthrough, but the generated `enum custom_keycodes` has no `VRSN`, so a build of that import would not compile; custom keycodes from the source's own enum are not modelled.

### D-376: A put onto a new board can never start a sync: auto-sync needs the board proven, and nothing else in a put starts one. (Put and sync, Claude; asked by the coordinator; from D-160, D-334)
- A put makes the board's first config its config at once (D-334), which only decides what a later sync would put on. Auto-sync starts only when the board has `proven_at` (a hands-free flash keyloom did and verified), is not paused, its keyboard reads as keyloom firmware, and the quiet time has passed (`autoSyncDue`); `proven_at` is per board and no put, import or config change sets it. Other implicit paths do not exist: the engine's only launch is `autoSyncDue`, and `config use`, `sync` and Sync now are the user's.
- `test/app/keyboard-put-sync.test.ts` puts a config on the Corne beside a proven Moonlander, with the Corne plugged in and running keyloom firmware built for the new config, applies the proposal, and waits several quiet periods: the Corne reads "behind: unproven", and nothing is built or flashed. The control test proves the Corne and it builds, so the proof is the only gate. No code changed: there was no unasked-flash path.

### D-377: A keymap's own custom keycodes survive import and generation, so an imported QMK keymap builds. (Custom keycodes, Claude; asked by the coordinator; extends D-375)
- QMK's Moonlander default declares `VRSN` in `enum custom_keycodes`; the importer read the key as native and kept its `process_record_user` case, but dropped the enum, so the generated keymap used an undeclared name and the build failed.
- The importer keeps the keymap's `enum custom_keycodes` members as a `custom-keycodes` passthrough block (the existing preserved-C mechanism, no new layout field). Members keyloom writes itself are dropped as consumed: ZSA's `RGB_SLD` and the `ST_MACRO_n` of imported macros, so an Oryx export carries nothing. The first member's `= SAFE_RANGE` is removed and the generator re-bases the enum; other explicit values are kept. The generator writes `RGB_SLD`, the macros, then these.
- A member with a name keyloom's enum also writes (`RGB_SLD` with another value on a ZSA board; a macro's generated name) is an `ImportError` naming it; the generator checks again, so a macro added later can't silently duplicate a carried name.
- A case that sat in `switch` inside `if (record->event.pressed)` (QMK's own style) keeps the guard inside the case. Without it the case would run on release too, and VRSN would type its string twice.
- The emulator's stand-ins gain what a real build supplies: `QMK_KEYBOARD`, `QMK_KEYMAP` and a no-op `WEBUSB_PAIR`.
- **Proof, 2026-10-17, nothing flashed.** The Moonlander default at the pinned SHA, imported into a scratch data directory, built in Docker through `agent-work run -- keyloom build` (`reva`): before this change the build fails at `keymaps/keyloom/keymap.c:25` on `VRSN`; after it, it succeeds. `keyloom emulate --keys "tap 21 then tap 1"` (toggle the SYMB layer, press VRSN) types `zsa/moonlander/reva/keyloom @ keyloom-emulate` once, which is what the case's `SEND_STRING (QMK_KEYBOARD "/" QMK_KEYMAP " @ " QMK_VERSION)` says. Unit tests (`test/firmware/qmk/import-custom-keycodes.test.ts`) cover the enum, the guard and both clashes; the Docker run is not in the suite.

### D-378: Layer numbers in a stored layout's kept code are read once at startup, as one revision. (Backfill, Claude; asked by the coordinator; extends D-360, D-193)
- **Why:** BK's Moonlander and Glove80 were imported before D-360, so they had no `layerRefs` and kept the old refusal; he won't re-import.
- **How:** `keyloom serve` runs `backfillLayerRefs` before the server takes a request. The parsers run first, outside any transaction; the write is then one `appendRevision` inside a synchronous transaction that checks the head hasn't moved. This is D-193's shape (one ordinary revision, summary "Read the layer numbers in the kept code", origin `editor`, so it shows in History and undoes). It is not offered as a button: the reading changes no key and nothing BK could decline. `origin` stays `editor` because the column's CHECK constraint has no `upgrade`, and a new value would need a table rebuild.
- **Safe:** a layout is read only if a readable kept block has no `layerRefs` (or, with none, it has a kept key). The result must parse and must equal the stored layout once the recorded numbers are removed, so no key and no kept source changes. A layout that can't be read (a board this install lacks, a parse error) is logged by name and left as it is. A read that changes nothing writes nothing, so a second run is a no-op.
- **Limit:** the original keymap is gone, so a ZMK define used only by modelled keys is not seen as a layer define; with no kept code reading it, nothing needs it renumbered. Undoing the backfill, or undoing to an older revision, restores a document without the numbers, and the next start reads it again.
- **Sync:** the sync engine's `documentsEqual` compares revisions with the recorded layer numbers taken off (`withoutLayerNumbers`). Without that, the backfill head looked like a change the keyboard didn't have, and auto-sync on a proven board would have rebuilt and flashed it at the first restart; a test with a fake Glove80 failed that way before the change. A head that differs from the running build only in recorded numbers is "in sync"; the next real edit syncs as normal and carries the new generated text (`&mo LOWER`).

### D-390: QMK `CHORDAL_HOLD` alone translates to `tap-hold-tap-keys` over the key's own hand, not `tap-hold-opposite-hand`. (S33, Claude; replaces the CHORDAL_HOLD row of D-242)
- **Why:** run against kanata's simulator with the QMK emulator's results for the same key events, `tap-hold-opposite-hand` made a home-row key a hold the moment an opposite-hand key went down. QMK's `CHORDAL_HOLD` on its own does not: the key stays a tap if it is released before the tapping term, and only a same-hand key makes it a tap early. The misfire was Option+U where QMK typed `su` on a fast cross-hand roll.
- **How:** a kanata profile gets the option `tap-keys` (`all`, the default, or `same-hand`, only with `tap-hold-tap-keys`). The generator writes `left-keys` and `right-keys` from the board's `hands` and each key uses its own hand's list; a key with no hand is refused. `CHORDAL_HOLD` with `HOLD_ON_OTHER_KEY_PRESS` stays `tap-hold-opposite-hand`, and with `PERMISSIVE_HOLD` `tap-hold-opposite-hand-release`; both were run and match.
- **Not translated:** kanata's `tap-repress-ms` counts from the first press and QMK's `QUICK_TAP_TERM` from its release, so they differ by the first tap's length. `translateHoldTapProfile` reports it as a note when `QUICK_TAP_TERM` is set. A tapped key that precedes another hold-tap key is released a few ms later on kanata; the keys typed are the same.
- **Tested:** `test/layout/kanata-hold-tap.test.ts`, and `test/firmware/kanata/sim.test.ts` (gated by `KEYLOOM_KANATA_SIM`) against `test/fixtures/kanata-sim/qmk.json`, recorded by `scripts/record-hrm-qmk.ts`.

### D-380: The agent has an `ask_user` tool for the one question that is really BK's, and the prompt says to act on defaults first. (Ask user, Claude; asked by the coordinator; BK: "the agent also needs an ask user command")
- **Shape:** `question` (one sentence), `options` (2 to 4, each a `label` and an optional one-line `description`, the recommended one first and shown marked), and `allowOther` for free text. `src/agent/tools/ask-user.ts`.
- **When:** only when the choice is his and nothing sensible can be assumed: replacing a config he runs versus adding a new one when his words don't say, or a step that can't be undone. Never for what the agent can decide or default, and never for what he already asked for: "replace my config with the Glove80 one" is acted on, with a line saying the old config stays restorable from History (D-380 revised after review: the demo had asked about an explicit replace). At most once a turn, and no other tool in the same reply. `system.md` says: act on defaults first, never ask in prose with numbered questions, ask only what changes the outcome. The prose "ask in text and stop" instructions for decision reminders and for making room now use the tool.
- **Why a tool and not prose:** a question in prose with three numbered parts made BK answer an interview before anything happened (the put on the MacBook). One question with buttons is cheaper to answer and cannot hide a second.

### D-381: A question is one card in the conversation column, all visible at rest, answerable by button or number key. (Ask user, Claude; extends D-380)
- `src/web/chat/QuestionCard.tsx`, in the outcome prompt's visual language (accent border and wash, the same tokens). Each option is a full-width button of at least 44px with its number, label, description and, on the first, "Recommended". "Something else…" opens a field when `allowOther` is set. Keys 1 to 4 pick while the card has focus, and it takes focus when it appears. Nothing shows only on hover. On a phone the same card sits in the sheet.
- Once answered it is a quiet read-only line with the answer. A reload shows an unanswered question still open: the conversation detail carries the question on its message, with `answer: null` until a result exists.

### D-382: A question ends the turn; BK's answer arrives later as that tool call's result. (Ask user, Claude; extends D-111)
- No process waits. The model's reply with the `ask_user` call is stored with the call open, the turn's status is `awaiting_answer`, and the answer is sent as `{ answer: { toolUseId, text } }` in place of a message. It is stored as a `tool_result` for that call, and a new turn runs from the history, so a reload, a restart or a day's delay change nothing.
- **Anthropic and OpenRouter** (one adapter): the loop breaks after the reply that holds the call, before the runner runs any tool or asks again. Other tools called in the same reply get an error result saying they did not run, because the API wants a result for every call. **Codex:** the tool server marks the pause and the adapter stops the child when the call's completed item arrives, then drops what Codex said after it.
- Typing a message while a question is open answers it too: the message is stored with a `tool_result` ("BK did not pick an option") beside it, so the next request is valid. An answer to a question that is not open is a usage error.

### D-383: A put works onto the MacBook keyboard; what kanata or keyloom's output can't say comes back as a note. (Put onto the MacBook, Claude; asked by the coordinator; replaces the laptop refusal in `keyboard-put.ts`; applies 21 and D-234, D-235, D-024)
- The refusal ("a laptop keyboard's config comes from `keyloom remap`") is gone. A put onto `apple/macbook-ansi` makes a new config, which starts as the identity map, and proposes the mapping. Layer keys that hold a layer go to the board's `holdKeyPreference` (Space-hold, then Caps Lock, then right Option) as hold-taps that keep the key's own tap; other layer actions are offered keys that hold nothing sure. The put replaces keys that typed something, so the lost functions are dropped by `dropFunction` ops and named in the notes.
- **Left off with a reason, never a refusal:** a macro the generator can't write (a press of a non-modifier), a layer key whose layer has no way back (the validator's `layer_trap`), ZMK or QMK native code.
- **Every carried layer is reachable.** The MacBook board lists keys to hold a layer from, in order: Space, Caps Lock, right Command, right Option, left Option, fn (`holdKeyPreference`), then `;` and `'` (`holdKeyFallback`). After the mapping, each layer that nothing enters gets the next key as a hold-tap that keeps the key's own tap (fn has none, so it takes a plain hold). A layer with no key left is carried fewer: it is left out and named in the notes. On BK's Glove80 config (a read-only copy of his db) the default proposal has no `layer_unreachable` warning: one-shot from Space, numbers from Caps Lock, navigate from right Command, magic from right Option. A combo on the home row was not needed and is not built. Escape and Control stay reachable because the validator still runs on every proposal (D-247).
- **The "tap dance with a hold" claim, checked and fixed.** The refusal was keyloom's, not the keyboard's: kanata's `tap-dance` counts taps, but its action list takes other actions (docs: "normal keys or other actions", `docs/config.adoc` at `jtroo/kanata@02242ef`). The generator (`danceAction`) now writes tap plus hold as a plain `tap-hold`, a hold beside a double tap as `(tap-dance T ((tap-hold T T tap hold) double))`, and tap-then-hold as `(tap-dance T (tap (tap-hold T T double hold)))`. Run through S33's `kanata_simulated_input` (v1.12.0): tap, hold, double tap and tap-then-hold each fire their own action. The one cost: inside a dance the hold starts after the dance's own wait, so it fires about one term later than a plain hold-tap (400 ms against 200 in the run). `test/firmware/kanata/dance-sim.test.ts` is gated on `KEYLOOM_KANATA_SIM`; the generated text is tested without it. The validator's `firmware_unsupported` rule for hold slots is gone.
- **Factory and test layers** are left out by default on any put (`layers` carries an explicit list), with a note.

### D-384: A request to copy or map a setup is acted on at once with defaults, and the choices are offered in one line afterwards. (Agent defaults, Claude; asked by the coordinator; extends D-372, D-380)
- "Put my X config on this keyboard" calls `put_config` on the first turn. Defaults: a new config that leaves the current one untouched, every layer except factory and test ones, keys matched by what they type and then by place, layer keys placed by the rules. After the result the agent shows what came across and says, in one line, what it chose ("I matched keys by what they type; say if you'd rather keep positions").
- "Make me a Colemak config" calls `create_config` (a copy of this config, or the board's blank start), and the prompt quotes no CLI command anywhere. The dev demo's first reply acts on the obvious default instead of interviewing. It never says "put" or "keyloom remap" to him. `map_keys` copies the same way: weak matches and keys with no counterpart take the default and are listed afterwards, not asked about.
- Proof: `test/agent/ask-user.test.ts` scripts the first turn with the fakes and asserts `put_config` is called with no `ask_user` and no question; `test/app/put-macbook.test.ts` puts the Glove80 fixture on the MacBook.

### D-395: A board's drawn colourway can be pinned to the one on the desk, per board; following the theme stays the default. (Colourway pin, Claude; asked by the coordinator; extends D-262, answers Q26)
- **The setting.** "Your keyboard's colour: Follow the theme / Black / White" heads Settings, under "On screen", on a board whose definition lists colourways. It applies at once and isn't part of Apply's staged change, since nothing goes to the keyboard. It is kept per board id in this browser (`keyloom.colourway.<board id>`, beside the theme in `shell/storage.ts`), because it is a matter of display like the theme. A pinned id that the board no longer lists falls back to following the theme.
- **The makers' colourways, in `board.json` `display.colourways`.** Each has a name, the maker's own name, and separate case and cap tones. ZSA's buy page offers the Moonlander in "Dark Matter" (black case, black caps) and "Moonlit" (white case, white caps), read from its configurator, 2026-10-17. MoErgo's store sells the Glove80 in "Grey" and "White" (`/products.json`, 2026-10-17), not black, and its product photo of the grey board shows a dark grey case with white caps. So the Glove80's options are Grey (white caps) and White. BK's own photo (`evidence/glove80-ref/22.png`) shows the same grey case with white caps. The red thumb caps stay red.
- **Drawing.** With a pin, the case and caps keep their colours in both themes; the stage, the underglow and the chrome still follow the theme. `Keyboard` marks only a part whose tone differs from the room (`data-case-room`, `data-caps-room`, `keyboard/colourway.ts`), so a part that matches the room keeps the theme's own tokens. Marks on and around the caps (rings, combo lines and labels, halos) follow the case they sit on.
- **Shading out of the room.** A part outside its room has its own shading in `keyboard/colourway.css`, not the other theme's tokens copied over:
  - a white board in a dark room is a shade under the light room's white so it doesn't glare, and casts a deeper shadow onto the stage;
  - a black board in a light room is lifted a touch, its edges and cap tops catch the room's light, and its shadow is softer and takes the room's tint.
- **Grey is charcoal, not black.** The Glove80's grey case is its own tone (`case: "grey"`), out of both rooms. It is sampled from MoErgo's studio photo (the lit palm rest, `#4b4a48` to `#534f4e`) and BK's photo (`#22292f` to `#2a333a`, darker and cooler in room light), which bracket a neutral charcoal: `#47484b` lit, `#313235` in shade. It takes the black case's marks and the room's own stage shadow.
- **Checks.** `test/web/contrast.test.ts` composes every case and cap tone in both rooms as the page does, and holds each to the board's contrast pairs and to Inspect's tints.

- **Split by D-319:** the case and the keycaps are now two choices, in any mix.

### D-385: A conditional layer is a first-class part of the layout: two layers that turn a third on, named by id. (Conditional layers, Claude; asked by BK; replaces the passthrough of D-024 for this one thing)
- **Why:** ZMK `conditional_layers` and QMK `update_tri_layer_state` were kept as passthrough, so the editor could neither show nor change "hold Lower and Raise and get Adjust", and a reorder had to renumber them as kept code.
- **Model:** `Layout.conditionalLayers: { id, ifLayerIds: [A, B], thenLayerId: C }[]`. Two layers, not a list: QMK's `update_tri_layer_state` takes exactly two, and the editor's two pickers say the same. ZMK nodes with three or more `if-layers` stay kept source. Layers are named by id, so generation writes each layer's current number and a reorder needs no renumbering record (D-360's `layerRefs` stay for code keyloom keeps).
- **Ops:** `upsertConditionalLayer { conditionalLayer }` and `removeConditionalLayer { conditionalLayerId }`, beside the combo ops. `src/layout/conditional-layers.ts` holds the pure helpers the editor, the agent and the validator share (ids, names, the sound-or-not check, the ops).
- **No schema bump.** `schemaVersion` stays 1 and a stored document reads as `conditionalLayers: []` (D-150's rule). A stored layout whose kept code already holds a condition is read into the model at startup by a backfill that follows D-378's (D-391), not by D-193's button, because that upgrade is synchronous and the reading needs the tree-sitter and devicetree parsers.
- **Diff and history:** the compare view and `diff` name a condition by its layers ("Lower + Raise gives Adjust"); a stale base conflicts per condition id.

### D-386: The validator checks a condition's layers exist, counts a layer only a condition turns on as reachable, and leaves reorder and delete to ids. (Conditional layers, Claude; asked by BK; extends D-020, D-181)
- **Rules:** a layer the condition names that isn't there is `unknown_ref`. The same layer twice, or C being A or B, is `conditional_layer_invalid`, and the editor's pickers never offer either. On QMK, a condition beside kept code that already defines `layer_state_set_user` is `conditional_layer_blocked` (the C would define it twice); the generator refuses the same document. Two conditions with one id are `schema`.
- **Reachability:** `reachableLayers` adds C once both A and B are reached, and repeats until nothing is added, so a layer behind a chain of conditions is reachable too. Its keys are then reachable functions, so `function_lost` and `layer_unreachable` read a layer behind a condition as they read one behind a key. This says "can be on", not "A and B can be held at once": keyloom does not model which fingers hold what, and the emulator tests prove the held case. Removing the only condition that reaches a layer is refused as an unreachable layer and lost functions unless `dropFunction` names them.
- **Reorder** needs nothing: the condition names ids. **Delete** of a layer a condition names is `unknown_ref` until the condition goes; the editor removes the conditions that name a layer in the same change as the layer (D-389), the agent has to say it.
- **Order:** QMK writes the conditions in the layout's order, one `update_tri_layer_state` after another, so where C of one is A of the next, the order is the cascade. ZMK evaluates each independently. Not validated; chained conditions are rare.

### D-387: ZMK `conditional_layers` and QMK tri-layer are read into the model and written back from it, and what they can't be read from stays code. (Conditional layers, Claude; asked by BK; extends D-360, D-378)
- **ZMK import:** a `zmk,conditional-layers` container whose only property is `compatible` has its children read with the devicetree parser. `if-layers = <A B>; then-layer = <C>;` with plain numbers or `#define`s that resolve to three different layers becomes a condition. Anything else, a child with three layers or another property, is kept as `conditional:<name>` and written back inside the generated container, with a report warning. A `#define LOWER 1` that only a condition used is still counted as a layer use, so it is renumbered with the layers (D-360).
- **ZMK generation:** a `conditional_layers` container after the combos, children named from the condition ids (`cond-adjust` is `cond_adjust`), layers by current index. Import, generate, import is the same layout. The Glove80 template has no condition, so the test adds one to MoErgo's default keymap.
- **QMK import:** a `layer_state_set_user` whose whole body is `update_tri_layer_state(state, A, B, C)` calls, as `state = ...;` lines then `return state;` or ending in `return update_tri_layer_state(...);`, read with the C tree-sitter parse, becomes conditions and the function is not kept. A layer is a number or an enum member. All or nothing: a function that does anything else, or names a layer twice, stays kept code (its numbers already follow the layers through `layerRefs`), with a warning.
- **QMK Tri Layer feature:** `TRI_LAYER_ENABLE = yes` in rules.mk and at least one `TL_LOWR` or `TL_UPPR` key in the keymap. The condition is lower and upper giving adjust (the three `TRI_LAYER_*_LAYER` defines, or QMK's 1, 2 and 3), the two keys become momentary layer keys, and the defines are not kept as settings (which would pin the numbers). Feature on with no TL key models nothing: VIA builds turn it on without using it. **Broader than the feature:** the feature updates only when its two keys move, and the condition holds however the layers are turned on; the import warns.
- **QMK generation:** `layer_state_set_user` after the keymap code and before `process_record_user`, one `state = update_tri_layer_state(state, a, b, c);` per condition, numbers from the current order. Reorder renumbers it with the keymap (the layerRefs interlock of D-360/D-378 is replaced by writing ids as numbers at generation).
- **Proof, 2026-10-17, nothing flashed.** KEYLOOM_DOCKER_TESTS runs through `agent-work run --`: ZMK on the Glove80 (MoErgo's image), holding Lower and Magic types `0` from the factory test layer with the condition and nothing without it, and still does after Lower and Magic swap places; QMK on BK's Moonlander (the pinned ZSA checkout), holding two layers turns a third on, and does so after a reorder. Results are in the PR.

### D-388: kanata can't write a conditional layer, so it is left out of the config with a validator warning and a comment. (Conditional layers, Claude; asked by BK; extends D-235)
- **Checked against kanata's docs (jtroo/kanata `docs/config.adoc`, main, 2026-10-17):** kanata keeps a stack of `layer-while-held` layers over one base layer, and a key is looked up on the top layer, falling through with `_`. `switch`'s `(layer name)` is true only for the active (top) layer, and `(base-layer name)` for the `layer-switch` base. Nothing asks whether two layers are both held, so "A and B held, then C" has no form. Rewriting A's key for B as "hold C" (and the reverse) would be a guess about which keys switch layers, wrong for toggles and taps.
- **Behaviour:** the conditions stay in the layout (a layout can move between boards), `conditional_layer_unsupported` is a warning on a change that adds one and a standing finding for the board review, and the generated config says in a comment which conditions it left out. It is a warning, not an error, because an error would stop a layout that has conditions from being applied to a MacBook at all.

### D-389: The editor adds a condition on the layer's menu, the strip shows it as a quiet link, and the agent proposes one with `propose_changes`. (Conditional layers, Claude; asked by BK; extends D-090, D-337)
- **Editor:** the active layer's `...` menu has "Also on when … are held" with a count at rest. It opens a view, like "Label and colour", with one row per condition that turns the layer on: two native layer pickers that never offer the layer itself or the other picker's layer, and a visible Remove; "Add a condition" is disabled with a visible reason when fewer than two other layers exist. On the strip, the layer's tab has a muted underlined link under it ("LOW + RAI", short labels, spelled out in its aria-label) that opens the menu on that view. Nothing is hover-only (D-337). Refusals show in the menu view.
- **Delete:** conditions that name a layer go with it. The delete ops put `removeConditionalLayer` before `removeLayer` and the dialog says "The condition … goes with it". They are not listed as references that block the delete, because nothing is stranded once they go.
- **Caption:** a layer only a condition turns on reads "On while Lower and Raise are held" under its title, not "No key on the first layer reaches it".
- **Screenshots:** `docs/screenshots/conditional-layers/`, both themes: the strip and the menu at 1440×900 and 390×844, a draft at 1440×900, seven layers beside the side column at 1366×768 and eight at 1440×900.
- **UI note (designer's pass, comp approved by the coordinator; replaces the native pickers and the strip link above):**
  - **The menu.** "Also on while two are held" opens the condition as a sentence with chips: "Adjust is also on while [● Lower] and [● Raise] are held." Each chip is a button. It opens the other layers below the sentence as chips drawn the way the strip draws them (light dot, name), wrapping instead of scrolling. The layer itself and the other chip's layer are never offered. Remove sits on the row.
  - **Adding.** "Turn it on while two layers are held" (or "Another pair that turns it on") starts a draft, "[Lower] and [which layer?]", and nothing is applied until both are chosen. "Nothing changes until both are chosen" says so, and Cancel drops it. A pair that already turns the layer on is refused in place.
  - **The strip.** The tab of a layer two others turn on shows their two lights, small and overlapping, beside its name. Its accessible name is the sentence ("Adjust, also on while Lower and Raise are held"). The caption keeps "On while Lower and Raise are held", so the words are on screen once the layer is chosen and never hover-only (D-337). The truncated "LOW + RAI" link is gone.
  - **Strip and controls.** On a stage wider than 900px the strip and Combos/Inspect/History/Library share one grid row (`.stage-floor-row`). The strip is centred while it fits between equal sides, and the controls' side is never narrower than the controls, so a strip too wide to centre moves left instead of running under them. The controls keep their labels only while the strip at full width still centres with them clear. When even their icons would leave the strip too little room to show every name whole, they go above the strip at the right, as on a narrower stage (eight Glove80 layers beside the side column). `ViewControls` decides by the strip's unshortened width, so the choice doesn't flip as the strip moves. It now measures the strip with its `+` and `...` buttons; leaving those out is how `...` got covered. Below 900px nothing changed.
  - **The chosen layer's tab stays in sight** wherever the strip scrolls (a phone): however the layer was chosen, by a tab, a key press that found it, a board switch or an arrival, its tab scrolls into view (`scrollIntoView`, nearest), smoothly or at once under reduced motion. Checked at 390×844: Layer 5 by a tab, Home and End on the strip, and arriving on Layer 5 from another config.
  - **The caption** names the two layers as the strip does ("One shot", not the keymap's "one_shot").
  - **Checked on a copy of BK's data with fake keyboards:**
    - **Sizes:** 1440×900 and 1366×768 with 6, 7 and 8 layers, with and without the side column, plus 1280×577 and 390×844, in both themes.
    - **Wide sizes:** the strip and the controls never meet, the strip never scrolls, and no name is shortened. On a phone the strip scrolls, as before (D-338).
    - **Edits:** picking a layer from a chip, adding a pair from a draft, and Remove were each applied through the app. Remove was refused in place where it would leave the layer unreachable.
    - **Screenshots:** `docs/screenshots/conditional-layers/`.
- **Agent:** no new tool. `propose_changes` takes `ChangeOp`s and the two new ops are in that union, so the agent proposes one the way it proposes a combo, and the validator decides (D-014). The prompt has a "Conditional layers" section, `get_layout` prints each condition by id and by layer names, `find_function` lists a condition as one way a layer is reached, and the firmware notes say kanata can't and that QMK refuses beside kept `layer_state_set_user`.

### D-391: Stored layouts get their kept conditional layers read into the model at startup, as one revision, and the sync engine calls that step the same build. (Conditional layers backfill, Claude; asked by the coordinator; extends D-378, D-387)
- **Why:** D-387 reads conditions on import, but a layout stored before it keeps `layer_state_set_user` (QMK) or a `conditional_layers` container (ZMK) as kept source, so the editor shows nothing and the model can't change it.
- **How:** `backfillConditionalLayers` (`src/app/conditional-layer-backfill.ts`) runs in `keyloom serve` right after `backfillLayerRefs`, with D-378's rules. The parsers run first, outside any transaction; the write is one `appendRevision` inside a synchronous one that checks the head hasn't moved ("Read the conditional layers in the kept code"). QMK: the kept `function:layer_state_set_user` must be only `update_tri_layer_state` calls over layer numbers. ZMK: a kept root `zmk,conditional-layers` container with only `compatible` and children `if-layers`/`then-layer` that resolve through the layout's `#define`s. All or nothing per layout. The kept block's numbers are read as the layers are ordered now (`withLayerNumbers`), so the layer-number backfill must have run; a block without `layerRefs` is left alone.
- **Safe:** the result parses; `isConditionalBackfill` finds nothing different except the kept block gone and the conditions added (layer numbers recorded on other kept code aside); it breaks no validator rule the old layout kept; it still generates. A layout that can't be read, such as one for a board this install lacks, is logged and left as it is. A block it can't model (other statements in the function, three layers, a name it can't resolve) is left as it is with no log, since it would repeat on every start. Idempotent: once the block is gone there is nothing to read.
- **The Tri Layer feature in stored layouts is not read.** Its `TL_LOWR` and `TL_UPPR` keys are stored as native keys and its defines as settings, and swapping them for the model's would change more than the kept block.
- **Auto-sync:** the model writes the same calls in its own place and form, so the bytes differ but the firmware is equivalent. `documentsEqual` already ignored recorded layer numbers; it now also accepts a pair of revisions on the same line when every step between them is either that or a conditional backfill (`sameBuild`, `src/layout/conditional-backfill.ts`), so a proven board whose head is the backfill reads as in sync. The line is the head's own, so a real edit between the flash and the backfill still shows as behind. `test/app/sync-zmk.test.ts` (a fake proven Glove80, several quiet periods, nothing built or flashed, then a real edit syncs) failed without the rule.
- **BK's data (a read-only copy of the sqlite database, 2026-10-18):** neither his Moonlander nor his Glove80 has tri-layer code. No revision of either contains `update_tri_layer`, `layer_state_set`, `conditional`, `TRI_LAYER` or `if-layers`, and the heads keep no `function:` or `root:` block. The backfill would write nothing for them.

### D-319: The drawn case and the keycaps are pinned separately, in any mix the maker sells. (Colours, Claude; asked by BK: "I need to control the color of the case and the color of the keys"; splits D-395)
- **The setting.** "Your keyboard's colours" in Settings has two rows, Case and Keycaps. Each row offers Follow the theme and the colours the maker sells, with a swatch of the board as that choice would draw it. Any case goes with any caps, and either part can be pinned alone while the other follows the theme. It applies at once, kept per board in this browser (`keyloom.case.<board id>`, `keyloom.caps.<board id>`).
- **The makers' options, checked 2026-10-18:**
  - **Moonlander:** ZSA sells it in Dark Matter (black) and Moonlit (white), and sells keycap sets in black and in white (zsa.io/moonlander/accessories: "Black Printed Caps", "White Printed Caps", and the blank sets).
  - **Glove80:** MoErgo sells it in Grey and White (`/products.json`), and its keycap sets in "Translucent White" and "Opaque Black".
  - `board.json`'s `display.colourways` now lists `cases` (with the caps each is sold with, `stockCaps`) and `caps`.
- **Migration.** D-395's single stored choice is read once into the two: its case, and the caps of the same name, else the caps that case is sold with. So a pinned grey Glove80 stays grey with white caps. The first change writes both keys, and the old one is not read again.
- **Drawing.** Unchanged from D-395. Each part out of its room has its own shading, and marks follow the case. `test/web/contrast.test.ts` composes every case tone (black, charcoal, white) with every cap tone in both rooms, which covers every mix including a followed part. Each composition is held to the board's pairs, so legends read on black caps over a white case and on white caps over a black one.


## The keyboard specialist becomes an app-wide agent (2026-10-18)

This session extended an existing product. BK first described the missing agent UI, then insisted on a keyboard specialist, then on operating the whole app and moving things between his registered keyboards. The assistant's restatements established the direction; they did not settle the implementation details. BK requested a blueprint and directed us to his blueprint skill. Chapters [28](28-agent-experience.md), [29](29-agent-app-control.md) and [30](30-agent-keyboard-context.md) record the extension. Their baseline and reuse points are in [the source reading](../research/agent-native-baseline.md).

Entries attributed to BK are product requirements. Entries attributed to the assistant are proposals, not new standing permissions. Q30 to Q36 identify their open product choices. The original blueprint request authorized neither implementation nor a flash. BK subsequently requested orchestration, approved the 26a visuals (D-409), and authorized shipping verified slices; no keyboard flash is authorized.

### D-396: The agent is a keyboard configuration specialist that can operate the whole app. (BK)
- **BK:** "intentionally built as an agent taht helps with configuring a keyboard" and "know the entire app so that I can do everything via the agent".
- **Option rejected:** a general-purpose chatbot attached to the configurator, or an agent whose knowledge stops at editing bindings.
- **Meaning:** existing app workflows must be reachable through the agent. Knowledge of layers, configs, firmware limits and the app's current state is part of its job, not an optional prompt enhancement.
- Local-first operation, shared CLI use cases (D-030), validator authority (D-014), and the typing lab's privacy boundary remain.

### D-397: A turn shows useful work while running and gives the final result the space afterward. (BK)
- **BK:** "UI for tool calls and results to give the sense of progress", "giving the user feedback while it works", and "collapsing the working after it's done to focus on the final response".
- **Option rejected:** an undifferentiated transcript of prose and technical tool output.
- The working section is expandable after completion. Questions, approvals, failures and unfinished hardware work must remain visible until resolved; folding them would hide what BK must do next.

### D-398: Messages, questions and results have purpose-built presentations. (BK; renderer details proposed by the assistant)
- **BK:** "differentiation between agent and user messages, ask user tools, nice UIs to present different kinds of inforamtion to the user, shimmering text when thinking".
- Reuse the existing question and proposal cards. Extend them with key, layer, config and keyboard selection and typed result views, rather than replacing working cards with Markdown lookalikes.
- The blueprint proposes the component vocabulary and motion in [28](28-agent-experience.md); Q30 and Q33 keep the unsettled parts explicit.

### D-399: Progress is a durable, provider-neutral record of actual operations. (Assistant proposal)
- The existing name-only tool event cannot represent completion, failure or simultaneous calls. Add correlated lifecycle events and a presentation projection separate from provider replay blocks.
- Show operational status and concise rationale, not private chain-of-thought. A shimmer means a request is active, not that a specific hidden thought was observed.
- The event contract, replay, interruption and legacy behavior are in [29](29-agent-app-control.md). S54 gates the first rung.

### D-400: Every app action has a typed capability over the same use case the UI and CLI call. (BK's coverage requirement; mechanism proposed by the assistant)
- An explicit coverage inventory must name each app action, its agent entry point, result renderer, permission rule and completion check. A new UI feature is incomplete if its agent route is missing.
- Do not give the model a generic shell, arbitrary SQL, filesystem access or unrestricted HTTP execution to simulate coverage.
- OS consent, credential entry and browser-required file gestures stay human interactions inside the workflow. They are not a reason to send BK off to work through unrelated menus.

### D-401: A request may prepare changes for another registered keyboard or several named targets. (BK; extends D-220)
- **BK:** "all my keyboards that are registered with the app" and "import somehting from another keyboard or send something to another keyboard".
- **Replaces D-220's:** proposals can target only the layout the conversation began on. Existing proposals remain tied to their original config and revision; they are never retargeted.
- Source reads, deterministic correspondence, per-target validation, previews and explicit Apply still apply. A transfer reads its source and writes its named destination, never both by accident.
- Multiple destinations are a requested capability, not permission to overwrite every keyboard or flash unattended.

### D-402: Every request captures its focus and every operation carries its own target. (Assistant proposal; Q31)
- **Replaces D-317's:** the carried thread is read-only and the next message necessarily belongs to a different conversation.
- For new workspace conversations only, this also replaces D-308's deletion of a conversation with its origin config: removing one config must not erase another keyboard's work. Legacy config-owned conversations keep their existing lifecycle unless explicitly migrated.
- The blueprint assumes the thread can continue as BK changes boards. The UI's current board is the default for the next request, not for a request already running. Source and target chips keep cross-board work legible.
- Selections, questions, drafts, artifacts and confirmations retain their board, config and revision context. Switching the stage cannot silently rebind them.

### D-403: The agent prepares the action; Keyloom executes a specific, user-approved plan. (Assistant proposal; Q32)
- D-014's validator and BK's Apply are preserved. The agent may prepare an Apply, restore, config switch or sync within the conversation; the application, not the model, accepts confirmation and runs it.
- A confirmation names the exact targets, revision, effects and auto-sync consequences. Changed scope or head invalidates it. A preference answer is never an approval receipt.
- Navigation, reads and existing safe draft creation need no ritual confirmation. Irreversible deletion and device effects keep their current safeguards. Typed "apply that" may confirm only one unambiguous, unchanged pending plan.

### D-404: Rich output uses a finite renderer set, not model-supplied executable UI. (Assistant proposal)
- Validated artifact data selects an app-owned component: proposal, comparison, transfer, collection, finding, question, confirmation or device outcome.
- Model and tool strings are untrusted text. Opaque provider blocks, credentials, raw typing traces and typed passages never become presentation data.
- A missing renderer has a readable safe fallback. It must not remove a warning or turn an unavailable action into an enabled button.

### D-405: Outcomes say what changed, where it changed, and what has not reached hardware. (Assistant proposal)
- Distinguish proposed, saved in Keyloom, sending, verified on device, offline, blocked and failed. A completed model reply does not prove a completed flash.
- Stop, retry and disconnect preserve already completed effects. Multi-target work reports each outcome and has no claim of atomic hardware rollback. Q34 records the batch policy.
- Replace blanket "Nothing was changed" wording with a statement derived from recorded effects.

### D-406: Ship the agent experience in usable rungs with design and task-completion gates. (Assistant proposal)
- Extend [13](13-roadmap.md), retaining historical rung numbers and statuses. Each new rung has an end-to-end demo and at most two new unknowns.
- The existing concept and screenshot gate remain. A working tool loop and passing unit tests do not prove that BK understands progress, scope or the outcome.

### D-407: The collection distinguishes keyboards BK registered from definitions Keyloom supports. (BK's collection requirement; identity mechanism proposed by the assistant)
- A supported Corne definition does not mean BK owns a Corne. Offline registered keyboards remain in the collection.
- Names resolve to stable references before work begins; a duplicate name is a choice, not a guess. A config is not a physical device, and selecting a board is not selecting the config it runs.
- Today's persistence groups configs and sync by board definition ID. S57 and Q35 gate any claim that two physical keyboards of the same model can be controlled independently. Do not pretend a new display alias solves device identity.

### D-408: Deliver rung 26 as honest visible work, then durable execution and reconnect. (Assistant, executing BK's orchestration request; informed by S54)
- The source-backed experiment at `c5efcb5` reproduced merged live working notes/final answers and a cancellation gap: a config remains after its model-history receipt is lost. Name uniqueness prevents a duplicate with the same name; it is not idempotent recovery.
- Keep the original rung 26 promise and completion gate. Insert 26a for useful observation/message presentation with explicit socket-owned interruption limitations, then 26b for durable run identity, effect receipts and reconnect.
- 26a must not claim that a closed stream can resume or that Stop rolls back preparation. Reconnect reads stored state; it never automatically resends a mutating request. Full rung 26 is not built until 26b's journey also passes.
- S54's source/experiment summary is in [the baseline research](../research/agent-native-baseline.md#s54-reproduced-the-message-and-cancellation-gaps).

### D-409: The first agent-experience visual proposal is approved for implementation. (BK, Q30)
- BK selected "Approve and implement" after the synthetic running, waiting, completed/folded, failed/partial-effects and stopped moments were opened in Dia. Preserve the keyboard-first visual world, message hierarchy, restrained shimmer and separate final/proposal content.
- The approval includes keeping Stop visible/reachable without scrolling on phones; the prototype's scrolling Stop position is not the production target.
- Approved artifact: `docs/screenshots/agent-experience/comps/index.html` in the `design/agent-experience` worktree, SHA-256 `a75fc9a46a600c3c61eab038f67e623995a67772f05d649abf1661c72eba9c1d`. The source base is `c5efcb5`; the prototype is synthetic, not a runtime verification.
- This approves 26a's visual direction. It does not approve later cross-board key-picking, arbitrary mutating actions, new storage protocols or a claim that durable reconnect already works.

### D-349: One finding per problem: the model's restatement of a check is dropped by what it is about, and several suggestions for one problem become one. (Engine, Claude; asked by the coordinator after a live review)
- An agent problem or hint whose layers include every layer of a check of the same kind is the check again, however many more keys or layers it names. Its insight stays as a suggestion that `fixes` the check, and the cause belongs in that suggestion's body.
- A suggestion with no `fixes` gets the checks its change touches, so the screen can always put it under its problem.
- Of several suggestions that fix the same check, the one with the fewest warnings, then the smallest change, stays. The others' change sets are rejected, not offered as alternatives, because the screen shows one fix per problem. The prompt asks for one fix per problem to begin with.
- The request budget is 10, up from 8: the model often spends two or three requests on proposals before it submits.
- A run that stops at its step or tool limit, or is cut off, after saving a fix is `done`: what it saved is attached by the same rule (title, summary, `fixes`, one per problem) and `ai.reason` says "Stopped at its step limit; showing what it found." It is `failed` only when nothing usable was saved, and then its proposals are withdrawn.

### D-410: Opening a sidebar replaces the previous sidebar, never hides the new one behind it. (BK, reporting Hints → More → Settings)
- BK: "sidebars shouldn't open on top of each other" and "show only one thing at a time". Reproduced on the synthetic editor: Settings was mounted but invisible while the board review remained visible.
- One selected sidebar owns visibility for review, proposals, settings, history, library, combos, repeat, lab and chat. Closing it does not resurrect the previous sidebar; a late close from the previous one cannot dismiss its replacement.
- This restores chapter 23's one-at-a-time rule and replaces D-310's visible key-over-conversation layering. Key drafts are parked through the existing draft path. Opening a key replaces chat; chat history and an active request may remain mounted, with an explicit reachable Stop outside the hidden pane.
- Entering the new-keyboard sidebar also clears the previous sidebar selection. Navigating away is not an Apply, a keyboard flash, or consent to record typing.

### D-411: Start durable execution with saved snapshots and atomic preparation receipts. (Assistant, executing BK's full-agent delivery request)
- For 26b, replace chapter 29's proposed append-only event log with monotonically sequenced current snapshots. Reconnect reads accepted work by request/run identity; it never replays a model loop. Keep the legacy stream contract unchanged. The versioned wire and CLI forms are in [26b's contract](../research/spikes/26b-contract.md).
- Preserve layout-owned conversations. Add only run and receipt records needed for existing preparation and question continuations; defer workspace contexts, artifacts and confirmation plans to the rungs that use them. This does not settle Q31 or Q32.
- Save each preparation's original result in the same SQLite transaction as all of its domain writes, including proposal alternatives and memory. A crash after that commit but before tool observation exposes a separate receipt fact. Receipt ordinals are not observer operation IDs; unfinished observations stay unknown.
- A request cancellation must survive acceptance ordering. Stop is explicit; closing a subscriber is not Stop, and neither action rolls back committed preparation.
- No current chat tool starts a device job. Move that part of 26b's proposed demonstration to 28b rather than adding a device capability solely for a cancellation test. Existing sync/build/flash authorities remain unchanged.
- Implementation status: 26b shipped in v0.43.0 and passed the [bounded public-client journeys](../screenshots/agent-experience/26b-published-0.43.0/README.md). This does not ship app-wide control or the full agent. The live desktop update is held for BK's subsequent corrections below.

### D-412: Working details precede the final answer and fold in place. (BK, correcting the live transcript)
- BK: "also it shows the working under the final response". The live implementation renders final Markdown before its working section. Reverse that order without merging working notes into the canonical answer.
- Working stays before the final answer during execution, completion, reload and manual expansion. Fold routine completed work in place; preserve an explicit open choice, focus, questions and unapplied proposals. The answer and its result cards follow the working, rather than serving as a preface to process notes.
- This supersedes the answer-before-working composition in the approved 26a example, not its keyboard-first visual system. The correction is implemented with rendered-order regressions; compiled-client screenshots and release verification are pending.

### D-413: Configure Keyloom display colours separately from keyboard LED lighting. (BK, following a Glove80 refusal)
- BK asked for a different colour on each layer. The agent refused using the Glove80's physical LED limitation. BK then requested that the app distinguish these concepts generally and make them separately configurable where possible.
- Keep D-180's display-only `Layer.color`/`shortLabel` separate from D-190's physical `Layer.lighting`. Expose the distinction through app controls and agent capability/tool context, not just a special-case prompt sentence. Changing either preserves the other.
- A board without supported LED output still has on-screen layer styling. A bare layer-colour request is not evidence that BK wants physical LEDs; offer the supported display change with its scope stated, or clarify genuine ambiguity. Explicit hardware-lighting requests retain the board's limits and validator checks.
- The correction exposes display styling in each layer's actions and physical LED lighting in Settings, gated by the board's existing LED support. Tool reads and capability descriptions distinguish both operations. Colour-only proposals preserve short labels; changes to either setting preserve the other. No Glove80 LED capability was added.
- Display-only revisions still enter the existing auto-sync pipeline: an isolated fake-sync probe observed a build/flash. The display form warns that saving may trigger auto-sync. No real keyboard write is authorized or performed. Source UI/tool/validator checks passed; compiled-client and release verification are pending. Live-provider tool choice remains unverified.

### D-414: The model picker stays reachable inside the viewport. (BK, reporting an off-screen picker)
- BK tried to change the model and could see only the picker's footer at the top of the window. Its fields were off-screen. Do not interpret this as a request to choose a model or change credentials on his behalf.
- Keep the picker within the visible viewport, with internal scrolling when its content is taller than the available space. Model options, Cancel and Save remain reachable by pointer and keyboard at short desktop and phone heights and after resizing.
- Preserve the existing visual system and focus return on close. A component render or CSS assertion alone does not verify this fix; check the actual control bounds and interaction in the browser.
- The correction uses a fixed body portal, viewport-clamped placement and a scrolling body with a separate footer. An intermediate native-popover implementation crashed when `showPopover` was absent; it was rejected rather than raising the desktop's macOS 12.0 minimum. The final source-browser checks pass with Popover methods removed and the newer selector made unavailable. Actual minimum-version WebKit is not certified. Compiled-client and release checks are pending.
- Compiled acceptance then caught a separate [resize failure](../screenshots/agent-experience/agent-corrections-compiled-red/README.md): after 1440×900 → 1280×577, the picker updated its width/max-height but retained a top position that left its input and footer below the window. Release is held for correction and a repeat of that actual open-picker resize, not just the smaller source-fixture resize case.
- The follow-up clamps the final vertical position at both viewport edges and observes later chat-size changes. A controlled off-screen anchor reproduces the unsafe placement on the old compiled binary and stays bounded on corrected source. The natural timing failure did not recur in that investigation; the original compiled RED record remains valid, and a new compiled-client run is required.

### D-415: New conversation works from a carried thread without deleting history. (BK, reporting a disabled action)
- BK could open the chat menu but New conversation was disabled after using another keyboard. Check the real carried/current conversation state rather than inferring that a missing current conversation ID means there is nothing to reset.
- Starting fresh removes the old thread from the current view, retains saved history and unsent text, and focuses the composer. The first message creates a new conversation; opening the empty composer alone does not create an empty database record. Keep genuine busy-state safeguards and app-owned run lifetime intact.
- The correction clears the carried-thread state as well as resetting the local conversation. New remains disabled during active work; Stop remains available. Desktop and phone source-browser journeys passed. Compiled-client and release checks are pending.

### D-416: History restores a document before putting it on the keyboard; exact artifact recovery remains in the CLI. (Audit reconciliation, 2026-10-20; replaces D-172 and the flash action in D-102)
- The current History panel offers Go back for revisions and Put on keyboard for versions. Go back writes a new head containing the earlier document. Put on keyboard restores that document first, then syncs the head or selects the config and syncs. It does not open an old-revision Build and flash dialog or reuse the old artifact.
- This keeps the chosen document as the head instead of letting auto-sync immediately restore a different head. A Go back on the active config can itself trigger existing auto-sync; it is not a hardware-safe read.
- Keep `keyloom flash --build <build-id>` as the deliberate exact-artifact recovery path while that successful build's artifact remains locally available. Inspect/pause existing auto-sync before using it, and require explicit session permission for hardware writes. No new flash UI or hardware check was added by this reconciliation.

### D-417: Write structured logs synchronously with the small local rotation writer, not pino. (Audit reconciliation, 2026-10-20; replaces chapter 11's logger implementation promise)
- `src/persistence/log.ts` already appends JSON lines synchronously and rotates at 10 MiB, keeping the current file and four backups. A short-lived CLI must not exit before an asynchronous transport flushes its final record.
- Retain this implementation instead of adding pino solely to match stale prose. Logging remains best-effort and separate from transactional receipts: a log failure does not fail an apply or prove it did not happen. Build/flash summaries link to per-run logs; they do not promise a complete tool-version manifest.

## Rust device-helper extension (planned 2026-10-20)

Status: proposal only. BK requested this blueprint, including Linux and Windows. No implementation, hardware access or release is authorized by the planning request. [31](31-device-helper.md), [32](32-device-helper-protocol.md) and [33](33-device-helper-platforms.md) distinguish requirements from assumptions.

### D-418: Keep the product in TypeScript; evaluate Rust for native device resources. (Assistant recommendation, recorded at BK's request)
- **Partially amends D-046 if adopted:** the layout model, validator, firmware generation and decoding, agent, application workflows, persistence, CLI and editor stay in TypeScript. Rust owns native HID/serial handles and transport I/O, not what a layout means or when a keyboard should be flashed.
- **Why:** shared executable validation and schemas still serve the product. Native callbacks, pointer representation and handle lifetimes are a different problem; the existing macOS transport already manages them manually.
- **Options rejected:** a whole-core rewrite, moving tree-sitter solely to justify Rust, and claiming a performance win without measurement. Rust cannot prove the correctness of a keyboard protocol, firmware semantics or a sync outcome.

### D-419: Reuse implementation knowledge, then require evidence before adopting the helper. (BK proposed; agreed)
- **BK proposed:** "Evaluate a small Rust device helper for HID, serial connections, and event capture, behind a narrow protocol." And: "Introduce that helper only if its reliability benefits justify another executable and release surface."
- **BK's reason:** "we've learnt a lot from implementing it so tht could enable us to move faster and avoid some footguns".
- **Reversal:** the assistant first framed this as a cautious exploratory spike, then agreed that existing protocols, fixtures, interfaces and failure records make a focused replacement credible. This is not greenfield discovery, but neither are untested assumptions established facts.
- **Gate:** characterize the old transport, exercise the same behavioural contracts through the replacement, test failures and installed packaging, and show which native ownership risks leave TypeScript. Retain the current backend on a platform until its own gate passes. No silent fallback or replay after an uncertain write.

### D-420: The helper must have a path to native macOS, Linux and Windows support. (BK; rollout order assumed by the blueprint)
- **BK:** "create a blueprint for building this . also include being able to support linux and windows".
- **Blueprint assumes:** macOS HID first, macOS serial next, then Linux and Windows transport releases, with cross-platform contract and build checks from the start. Q37 settles architectures/minimum OS versions; Q38 separates Windows device support from a full product port.
- **Why:** copying today's macOS/Linux implementation alone would miss Windows-specific identity, driver, cancellation and release constraints. A successful cross-compile is not a supported-device claim.

### D-421: Use a private, versioned stdio child process rather than an in-process native binding. (Blueprint assumption; Q40)
- The proposed `keyloom-device` executable is owned by each CLI/server process, starts lazily, listens on no network endpoint, and exits when its parent pipe closes. One process may own several sessions; each native handle has one owner.
- **Options rejected for this proposal:** a background daemon or privileged service, which adds installation and authority; a native addon/FFI bridge, which keeps native failure in the application process; a general RPC framework, which adds surface for a small fixed command set.
- **Not the reason:** old comments say compiled Bun cannot load native modules. Current Bun documentation describes embedded N-API addons; the historical limitation is not evidence that subprocesses are the only option. Isolation and lifetime are the reasons (research linked from chapter 31).

### D-422: Device references and sessions expire; application policy remains in TypeScript. (Blueprint assumption; Q40)
- Discovery yields helper-owned opaque references, not raw pointers, caller-supplied paths or persistent keyboard identity. Opening rechecks the endpoint; ambiguous matches fail. The existing physical-identity question Q35/S57 is not solved by a helper token.
- The wire carries reports/bytes and transport outcomes. TypeScript keeps firmware commands, timing/sequence interpretation, consent, board matching, sync serialization and flash verification. The agent receives no raw transport tool.
- Session writes and close become awaitable on both transports. The existing synchronous serial interface must be migrated through its callers, not covered with fire-and-forget promises.

### D-423: A stopped or broken transport never silently becomes a complete recording or a retried write. (Blueprint assumption; Q40)
- Bounded queues, per-session sequence numbers, terminal loss/failure states and bounded close are part of the contract, not optional diagnostics. Preserve device timestamps; receipt time is a separate host measurement.
- A lost write response means the device effect may have happened. Reconnect may rediscover devices, but cannot repeat the write, touch a bootloader, or resume recording. A new recording needs an explicit start.
- No raw typing bytes, serial chunks or HID reports enter logs, crash attachments or model context. Synthetic conformance traces are shareable; real recordings stay local under existing lab policy.

### D-424: Release the host and helper as one verified versioned unit. (Blueprint assumption; Q41)
- Prefer embedding the target helper in the existing compiled CLI, extracting exact bytes into a private version/hash directory and launching by an absolute verified path. The helper is a separate process, not a separately updated product. S62 must prove this works with signing, desktop packaging, native Windows execution and concurrent versions.
- Keep a manifest with host version, helper hash, target and protocol version. Reject mismatches before opening any device. Never search PATH or the working directory for a helper.
- Preserve older releases for rollback, not runtime failover after a device operation. Add only platform claims that have native installation and hardware evidence; list unavailable capabilities explicitly.

### D-425: Keep the keyboard as the hero and show transport failures in the existing places. (Blueprint assumption; Q42)
- Reuse [23](23-design-concept.md): no helper dashboard, backend badge, new sidebar or new visual identity. The helper itself has no human-facing design concept; it is a private byte transport.
- Product wording stays in TypeScript, as it does for the desktop shell (D-325). The lab reports an interrupted/incomplete recording, sync retains the last verified hardware state, and doctor names installation or permission problems without opening a device.
- Adoption is visible as less disruption, not more machinery to manage. New failure states still pass the existing screenshot and CLI journey gates.

### D-426: Ship installed helper diagnostics before any native device backend. (2026-10-20 implementation scope approved by BK's orchestrated brief)
- **Narrows D-421/D-424 for rung 24b, without adopting a transport:** implement only hello, ping and shutdown, advertise empty capabilities and compile no OS device libraries. Other device/session methods are unsupported. TypeScript transports remain production defaults; native capture, leases and their proposed queues wait for 24c–24f.
- Add `doctor --device-helper-only` so the installed pair can be verified without database/provider/Docker/USB/remapper probes. Normal doctor retains its checks. Source/dev use warns that no asset is bundled; it never searches PATH or a source build directory.
- Embed the final target executable and exact manifest through the existing Bun builder. Unix extraction verifies a private owned nonsymlink subtree and executable/hash; exclusive temporary creation plus atomic no-replace hard-link publication handles concurrent parents. A corrupt existing cache fails closed. No runtime helper override or updater is introduced.
- Native release jobs build each helper before its Bun host, sign/notarise the visible Rust executable using existing credentials before hashing when configured, then fan in the three CLI assets into one checksum list. The Linux helper is static musl inside the unchanged GNU Bun host, avoiding a newer glibc requirement just for diagnostics. Native Windows starts Cargo and real Bun child-contract CI now; private Windows ACL/extraction and a public CLI port remain 24f.
- **Evidence boundary:** local native macOS arm64 installed cold/concurrent/corrupt/mismatched-pair and bounded-child tests are recorded in [S58/S62](../research/spikes/device-helper-24b.md). Other native runners, Developer ID/notarised desktop and published release acceptance are not claimed by a local build. The inherited macOS 12.0 Tauri setting conflicts with pinned Bun's documented 13+ runtime requirement and is not a certified floor.

### D-427: Implement the HID candidate without silently adopting it. (2026-10-20, full-helper continuation)
- **Extends D-426, retains D-419's adoption gate:** implement native ownership and the full HID/session contract behind a compile-time feature. Default/release builds and `hid-default.ts` remain diagnostics/legacy until authorized physical and installed evidence passes. Serial/Linux/Windows remain required follow-on delivery, not completed by this slice.
- **Backend evidence:** pinned `hidapi 2.6.3` and `2.6.7` macOS sources silently discard queued reports; its descriptor API requires an operational open. Use direct metadata-only IORegistry discovery and a nonexclusive IOKit runloop owner with bounded sticky-loss callbacks, using pinned Core Foundation ownership APIs. Copy no upstream implementation. [Source comparison and tests](../research/spikes/device-helper-24c.md).
- **Capture policy:** missing stop acknowledgement, write/close failure and transport loss persist as incomplete warnings. Concurrent finish shares one promise; incomplete saved recordings cannot generate timing proposals. Keep these product decisions in TS and reuse the existing lab alert, not a helper UI. Typed busy/permission refusals become app-level `LabCaptureError`: HTTP 409 with an actionable message and CLI exit 2/stable kind. Unclassified errors remain internal failures; no automatic capture retry is introduced.

### D-428: Make the native candidate reachable through an explicit compiled CLI. (2026-10-21 continuation; ordinary adoption still gated)
- `build-binaries.ts --device-backend native-hid` selects the Rust feature and a static host selector, requires a Mac target/separate output directory, and retains the signed hash-paired extraction boundary. No runtime backend environment switch, executable override or fallback is introduced. Ordinary release commands remain diagnostics/legacy.
- One app-owned helper lifetime serves native HID callers; CLI/server cleanup observes exit after existing firmware-stop attempts. Candidate doctor accepts exactly the selected HID capabilities. A mutually exclusive synthetic-capture build proves the actual installed CLI/PTY path, stop/reopen, helper death and persisted incomplete results before hardware is authorized.
- A helper nonce rejects cross-lifetime raw tokens. Independent stdout-progress supervision ends a blocked writer even with continued helper-observed pings. Failed native close cannot acknowledge release or drop its lease first; process exit makes outstanding effects/loss unknown. [Evidence and remaining physical gates](../research/spikes/device-helper-24c.md).

### D-429: Treat ZMK serial stream loss as an incomplete recording. (2026-10-21, 24d TypeScript half)
- The serial seam delivers raw byte chunks and awaits write/close. ZMK uses strict streaming UTF-8 decoding and accepts lines up to 4096 UTF-8 bytes excluding LF; invalid UTF-8, incomplete lines, and overlong lines mark the recording incomplete.
- ZMK DROP reports and serial interruptions use the `Recording incomplete:` prefix, so persisted sessions are refused by timing analysis. Keep the legacy stty/polling backend; the Rust serial backend and physical S59 serial evidence remain pending.
- Firmware parsing and semantics are unchanged.

### D-430: Gate serial sessions behind an explicit synthetic candidate before adding native ports. (2026-10-21, 24d slice 1)
- Extend protocol 1 through capability gating: serial builds advertise exactly `serial.list`, `serial.open`; HID retains exactly its three capabilities, diagnostics retains none. Serial device records carry USB metadata and opaque references, with no usage fields. Relisting invalidates only unopened references of that transport; lease keys include the transport.
- Serial writes omit `reportId`, contain 1–4096 decoded bytes and return the exact accepted length. Data carries arbitrary byte chunks, while HID retains its fixed 32-byte native interface. A small enum shares the existing session owner, ordering, terminal loss and close receipt implementation. Serial queues admit at most 16 native chunks plus 16 shared output chunks; overflow is sticky detected loss.
- `synthetic-serial` and `synthetic-serial-capture` compile no OS-device backend and cannot combine with HID features. The capture fake preserves firmware clocks and splits an event mid-line. `serial.touch` stays unsupported and unadvertised; no real serialport crate, baud/DTR safety or physical support is claimed.
- `build-binaries.ts --device-backend native-serial` statically selects the helper adapter, requires a supplied `--helper`, Mac target and separate output directory. One app-owned lifetime and the existing setup/cleanup receipts serve the selected backend. There is no runtime selector, fallback or replay. Ordinary releases remain diagnostics/legacy. [Implementation and observed checks](../research/spikes/device-helper-24d.md).


### D-431: Own the macOS serial port directly and check every capture transition. (2026-10-21, BK decision; 24d slice 2)

BK replaced the proposed `serialport` macOS candidate with a direct IORegistry/POSIX backend. In the audited `serialport 4.10.1` source (revision `41496a9958aa47ff930a0ac5e659110e35d3d752`), `src/posix/tty.rs:202-208` ignores the builder's DTR setter error; failures at lines 134-188 can close before applying the requested baud; lines 21-37 and 409-412 close without an explicit checked DTR transition. This follows D-427's decision to own the required HID behavior directly. The earlier crate comparison remains historical evidence, not the selected macOS implementation.

- `native-serial` shares the HID registry ownership helpers, lists USB callout metadata without opening nodes, and identifies each attachment by registry ID plus path. It cannot combine with another device backend and fails compilation on non-macOS targets, so an unsupported native feature cannot resemble a working port backend.
- Capture opens nonblocking/exclusive, sets and reads back raw 115200 with flow control off and HUPCL cleared, then asserts and reads back DTR. Close checks DTR-low, exclusive-release and fd close. After open succeeds, any setup failure reports `effect: possible`, including failures before configuration: the OS may already have asserted DTR. Cleanup explicitly clears DTR only after capture baud was verified; otherwise it only closes the fd. Failed cleanup exits before releasing the lease. This ordering does not prove what firmware observed.
- Extend D-430's builder: a separate Mac `native-serial` candidate can compile its helper from source without `--helper`; a supplied synthetic helper still supports the installed smoke. Ordinary releases retain diagnostics/legacy. `serial.touch`, real-port behavior and physical adoption remain gated. [Sequence, tests and limits](../research/spikes/device-helper-24d.md#slice-2-owns-the-macos-port-with-checked-transitions).

### D-432: A close on a vanished device is confirmed by its handle release alone. (2026-10-22, S59 hardware run)

On BK's Glove80 and Moonlander (S59), every unplug made the helper exit, so the recording blamed `helper_exited` instead of `disconnected`. After a CDC unplug, `TIOCCDTR` and `TIOCNXCL` fail with `ENXIO` while `close()` succeeds. After an HID removal callback, `IOHIDDeviceClose` returns `kIOReturnBadArgument`. D-431's checked close counted either as unconfirmed cleanup and exited to keep the lease.

- Serial: `ENXIO` ("device not configured") from line control means there is no device left to hold DTR or exclusive state. Darwin's `ENODEV` means "operation not supported" and still fails the close. The fd close alone confirms release. Any other line-control error still fails the close.
- HID: after the removal callback, `kIOReturnBadArgument`, `kIOReturnNoDevice` or `kIOReturnNotAttached` from `IOHIDDeviceClose` is a clean close. Without that callback, any non-zero result still fails it.
- The session still ends `failed` with `disconnected`, and loss stays unknown. Unconfirmed cleanup on a present device still exits the helper. [Evidence](../research/spikes/S59.md)
- Serial identity also comes from the nearest `IOUSBHostDevice`/`IOUSBDevice`, not the first node with USB IDs, because macOS copies the IDs onto CDC data and interface nodes that carry no string descriptors.


### D-433: The native helper is the default on Apple Silicon; Intel/Linux stay legacy until their own hardware evidence. (2026-10-22, Stage 5)

[S59](../research/spikes/S59.md) observed native HID capture on the Moonlander and native serial capture on the Glove80, including helper death, unplug and reopen, on an Apple Silicon Mac after D-432. Select the combined `native-macos` helper for `bun-darwin-arm64` releases. One child serves both default transports, advertises all seven capabilities and implements explicit 1200/1201-baud touch. Intel and Linux retain legacy TypeScript transports and diagnostics-only helpers until their own hardware evidence. The legacy macOS FFI stays because Intel still uses it.

This supersedes the arm64 default-selection restrictions in D-426, D-427, D-428, D-430 and D-431. Single-transport candidates remain available through explicit build overrides with separate output directories. There is no automatic fallback, replacement child after failed setup/cleanup, or replay of a possibly effective request. The desktop uses the released CLI sidecar and its same embedded helper; sign and notarise the combined helper before hashing and embedding it.

Physical touch/reset evidence comes from the orchestrator's run, not the implementation worker. On 2026-10-22, 06:11 BST, the release-mapped arm64 build (helper sha256 `0ce6774f…`, seven capabilities, "native backend in use") did the following on BK's Glove80. First, a capture started and stopped cleanly. Second, it reflashed the build both halves were already running (`flash --build bld_01M53EDCCAK3RHBAFNJPGEVV5Y`) hands-free. Each half restarted from its own native 1200-baud touch, took the UF2, and was verified running that build in 22 s (`fl_01M5H0ADAT3TRZ8KB1YNM0K9FJ`). The same check was repeated at `e9e3fef`, the head that ships (helper sha256 `7aeed1fd…`): a capture start/stop, then a hands-free reflash. Both halves restarted through the native touch and were verified in 13 s (`fl_01M5H46GCDD0H58WXKJHV7N30N`). The 1201 relay was not exercised, because both halves were on USB. The Moonlander raw-HID reset through the combined helper was not exercised, because the board was unplugged; S59's HID capture evidence covers the same HID code, which only moved behind the shared owner.

- One process can list from two callers at once: sync polling and a lab start in `serve` or the desktop app. The TS client therefore sends one list per transport at a time. The helper keeps the reference of an unchanged endpoint across relists, so one caller's list can't invalidate another's selection before it opens. This replaces D-430's "a relist invalidates unopened references" for unchanged endpoints; changed or vanished endpoints still lose theirs, and open still re-checks identity.


### D-434: Linux uses sysfs and libc behind an explicit candidate build. (2026-10-22, Stage 6 brief)

Extend D-433 without changing its Linux adoption gate. `--device-backend native --target bun-linux-x64` selects `native-linux` and requires a separate output directory. Default Linux releases keep legacy transports and diagnostics-only helpers until S60 hardware evidence. The feature is Linux-only and mutually exclusive with macOS and synthetic backends.

Use sysfs metadata plus libc directly, with no libudev, hidapi or basic-udev dependency. This preserves the static musl helper and avoids an enumeration dependency that can write to protocol stdout. Take USB identity from the nearest owning USB device, never a hub's serial (S59), and recheck metadata plus the fd/dev-node identity after open. Share the portable raw-termios builder/verifier with macOS; Linux owns its modem/exclusive ioctls and uses termios2/BOTHER for exact 1201 baud.

Follow the [kernel hidraw contract](https://docs.kernel.org/hid/hidraw.html): writes are 33 bytes including a zero report-ID prefix; unnumbered reads are 32 payload bytes with no prefix. Regression tests cover both directions, rather than preserving the legacy Linux write mismatch. Permission hints use a read-only access check; open is authoritative. Doctor/lab name a VID/PID-scoped hidraw udev rule or ttyACM dialout/uucp access, without installing rules or suggesting root/world-writable nodes.

The [24e record](../research/spikes/device-helper-24e.md) separates local synthetic checks, provisional cached-dependency compilation, pending pinned Linux CI and unobserved hardware. Candidate capability advertisement is availability for explicit testing, not physical support certification.

### D-435: Release Windows x64 diagnostics and layout editing before HID/COM. (2026-10-22, Stage 7 slice 1 brief)

Extend D-424/D-426 with `bun-windows-x64`, embedding the diagnostics-only `x86_64-pc-windows-msvc` helper with empty capabilities. The per-user PowerShell installer verifies `SHA256SUMS`, installs without elevation to LocalAppData and changes user PATH only with `-AddToPath`. Existing Unix target/backend selection is unchanged.

Q38 is assumed as directed by BK: the paired helper and CLI device journey come first, rather than complete Windows product parity. This first slice provides installation, version, doctor, public-layout import, layout/boards/change operations and explicit typed refusal of build, flash, sync, lab, kanata/remap, USB/UF2 and serve. Serve is gated as a whole because startup owns device discovery and auto-sync. Native HID/COM and lab capture remain the next slice, subject to S61 and hardware authorization. `boards check --offline` remains available; geometry generation and online board checks require unvalidated build tooling.

Windows extraction uses `%LOCALAPPDATA%\keyloom\device-helper\<release>\<target>\<sha>\keyloom-device.exe`. Check reparse attributes and trusted ACL ownership/write access, create temporary files exclusively, rename within the hash directory and verify the executable hash before each launch. Versions coexist. PowerShell/.NET supplies Windows metadata missing from Node's filesystem API; ACL inspection is cached per process, while reparse attributes and final bytes are checked on every extraction. A malicious same-user process remains outside the integrity boundary.

No Windows code-signing credential is available: the CLI and helper are unsigned. Release notes must state the SmartScreen/antivirus risk and must not suggest bypassing protections. Signing and actual consumer Windows policy behavior remain unmeasured; the missing credential is observed from the supplied release environment, not inferred from a successful checksum. `windows-2022` CI is the only available native host. Until its installed smoke passes, this is an implemented release path with pending native evidence, not verified Windows support. [Evidence and remaining gates](../research/spikes/device-helper-24f.md).

### D-436: Windows HID and COM stay behind an explicit combined candidate. (2026-10-22, Stage 8 brief)

Extend D-435 with `build-binaries.ts --device-backend native --target bun-windows-x64 --out-dir <separate-dir>`. This selects the Windows-only `native-windows` Rust feature and the compiled combined host selector. It cannot coexist with Linux, macOS or synthetic backends. Ordinary Windows releases remain diagnostics-only and refuse device workflows until S61 hardware evidence. No runtime flag enables the candidate. Windows CI uses a separate runner job and separate output directories.

Use exactly `windows-sys 0.61.2` and its `windows-link 0.2.1`, selecting their MIT option in the embedded notices. Enable only the HID, device-installation, communication, filesystem, I/O, foundation, security, threading and registry modules used by the adapters. The registry module reads the COM device's `PortName`; security/threading supply handle creation and per-session named-mutex leases. No vendor DLL, driver replacement or privileged service is installed.

Re-check the earlier library choices per platform. The macOS IOKit/run-loop objections to HIDAPI do not apply to Windows: its Windows backend already uses shared collection handles and overlapped I/O. Its [0.15.0 Windows implementation](https://github.com/libusb/hidapi/blob/hidapi-0.15.0/windows/hid.c) returns on write timeout without confirming cancellation, and releases handles through unchecked `CloseHandle` calls. Keyloom needs checked close and storage retained through completion, so own those calls through `windows-sys`. The [serialport 4.10.1 Windows implementation](https://docs.rs/crate/serialport/latest/source/src/windows/com.rs) supports COM10+ paths, exclusive opens, integer baud rates and DCB configuration; these are useful reference patterns. Its builder also ignores the optional DTR setter error, its synchronous I/O uses driver timeouts, and its Drop ignores `CloseHandle` failure. The checked-transition/close concerns behind D-431 therefore also apply on Windows, although the POSIX-specific failure sequence does not. No upstream implementation was copied.

SetupAPI enumerates HID top-level collections and COM interfaces. CfgMgr walks to the nearest owning USB device, skipping `MI_` interface nodes. VID/PID and the unique USB instance serial come from that owner; a missing serial never falls through to a hub. Restore only the case-insensitive `keyloom/` prefix in Windows instance IDs. The opened HID collection's attributes/serial and caps must agree with the listing; COM mapping is repeated after exclusive open. Endpoint keys combine the instance ID and current interface path or COM port, so renumbering invalidates a reference. COM paths remain inside Rust. Identical reconnect metadata remains the S57 limitation.

Admit only QMK page `0xFF60`, usage `0x61`, 33-byte input/output buffers, no feature report and one unnumbered 32-byte value array in each direction. HID opens share read/write access with Windows. Wire payloads stay 32 bytes; native buffers add and check a zero report-ID byte. Overlapped reads wait 50 ms; writes wait 500 ms. After timeout, request targeted cancellation. Reads allow another 500 ms to confirm completion; writes check immediately and exit on an unconfirmed cancel, keeping the write wait budget at 500 ms. A completion that wins the race keeps its bytes; an unconfirmed cancellation exits the helper without unwinding storage or releasing its lease first. This follows [Microsoft's cancellation lifetime requirements](https://learn.microsoft.com/en-us/windows/win32/fileio/canceling-pending-i-o-operations); cancellation never means an effect was undone. Removal errors `ERROR_DEVICE_NOT_CONNECTED` and `ERROR_GEN_FAILURE` become `disconnected`.

COM capture checks raw 115200/8N1/no-flow-control DCB readback, sets nonblocking read timeouts and asserts DTR through a checked `EscapeCommFunction`. Touch uses one path for 1200 and 1201: exclusive open, identity recheck, exact baud/readback, DTR-low, one checked close. Advertise both touch capabilities because this software path is identical. Whether the in-box driver conveys 1201 to the firmware and the relay reaches the intended half remains an S61 hardware question. Every post-open failure has possible effects; early close at an inherited trigger baud can itself restart firmware.

Access-denied or sharing-violation COM opens are `busy`, with a close-the-other-client remedy. Known keyboard devnodes with failed/missing drivers and no usable interface become non-openable `driverMissing` records; open/touch returns `unsupported`. Doctor names the in-box HID or `usbser.sys` binding separately from unavailable workflows. Doctor never opens a COM port to test occupancy: its busy-port hint describes what an explicit open can establish. Never recommend Zadig or administrator rights.

The candidate admits lab and `flash --reboot-only`. ZMK reboot-only requires an explicit board/half and reuses local 1200 or central 1201 relay selection. It reports transport acceptance without claiming a bootloader drive appeared. Docker builds, UF2 writes/discovery, kanata, sync, serve and general keyboard discovery remain refused. Normal QMK restart keeps its existing departure check, using the helper's HID/COM identity view of USB on Windows. The installed synthetic Windows journey scripts terminal input while exercising real CLI/capture/IPC, stop/reopen and restart paths; it does not test ConPTY, Ctrl-C or USB hardware. [24f slice-2 evidence](../research/spikes/device-helper-24f.md#slice-2-implements-the-native-candidate-without-hardware-evidence) records the remaining native CI and S61 gates.

### D-437: A split flash ends with every half on the same verified build. (2026-10-22, Stage 9)

After the [Glove80 partial flash](../issues/uf2-copy-enxio-taken-as-done.md), a later half failing must trigger recovery of the halves already verified. This supersedes D-165's ZMK "not built" note and D-135's per-half last-good promotion. QMK recovery is unchanged.

Hold verified images in memory until every flash step verifies, then save them as last-good. A partial flash keeps the previous images. Recovery uses the same restart, drive wait, UF2 copy and verification path, comparing each half against the key embedded in its saved image, never the attempted new build ID. Unsafe UF2s, missing markers, saved images that disagree with a known pre-flash build, or saved halves with different keys cannot be used for rollback.

Read the failed half before recovery. If it still reports the previous key, restore only the already verified halves. Otherwise restore those halves first, then, where the drive-identity rule below permits it, request the failed half's bootloader with its recipe instruction and the normal bootloader wait, write its saved image and verify it. Check the failed half's saved key against its known pre-flash key too; a mismatch leaves recovery incomplete even when the saved key matches the other half's.

A distinct drive already mounted is accepted. A shared label such as the Corne's `NICENANO` never identifies a half by itself. Recovery writes only after keyloom restarts that specific target and observes its drive appear, with the other shared-drive halves reporting running marked firmware before the restart and when the drive appears. Normal flashing and Flash again also accept a manually opened drive that appears after the prompt, but immediately before writing keyloom reads every peer sharing that label: each must visibly run firmware on USB, either keyloom's or other firmware. An absent peer or one in its bootloader refuses the write, even if its drive mounted after the pre-prompt check. A drive already mounted before the prompt is still refused. Boards without hands-free hooks retain their existing manual behaviour.

Explain that keyloom cannot tell which half owns the shared drive. The peer must be running, or recovered on its own with only that half connected first. A retry needs both halves running and follows the recipe's original order; wait for each prompt before opening a bootloader. Never ask for the failed second half's bootloader before a retry that starts with the first. A board with identifiable running USB IDs can take its first keyloom flash manually with both halves running other firmware; an unmarked half whose running USB IDs are unknown cannot be confirmed as a peer. Reboot-only identifies and writes no drive, so it does not require a shared-drive peer marker.

Each half gets at most one rollback attempt; a restore copy failure or failed verification stops recovery. Validate every saved UF2 block's family, numbering and declared count before a recovery write; reject gaps, inconsistent families and counts, truncation, and any bootloader-family block. Cancellation of the new build does not cancel recovery. A pause or stop during recovery preserves the failed result, final states and nonretryable flash failure. If the first keyloom flash has no saved image, report both halves' observed states and give the retry steps under the drive-identity rule. If only that failed half lacks an image, restore the verified halves and report the remaining recovery step.

A later successful flash, corroborated by every expected half currently running its build, supersedes the earlier sync failure for status and later auto-sync. Preserve the failed sync row as history. This applies to QMK and single-step boards too; a head marker alone, a missing half, or a successful flash predating the failure cannot clear it.

A completed rollback is still a failed flash and sync. Its error and log say the keyboard is back on the previous build and list each half's build key. Sync reads the old markers and shows the keyboard behind the applied revision. Incomplete recovery cannot become in sync from the visible halves alone: every expected half must be present and verified on the head. A missing half needs a hand and shows the stored recovery error; a failed split flash is considered before an apparent head match, including after a later edit or when all halves are absent. The header and toast must not claim success. Full success keeps the existing verified summary and promotes last-good only after all steps pass.

Evidence is synthetic: `test/firmware/zmk/split-rollback.test.ts`, `test/app/firmware-zmk-handsfree.test.ts` and `test/app/sync-zmk.test.ts` use `test/helpers/fake-zmk-halves.ts`. No rollback on hardware has been observed. Recovery is bounded by the existing waits and requires a usable last-good image and, for an absent half with a distinct drive, the person's bootloader key; it cannot guarantee recovery from a disconnected cable, damaged hardware or interrupted process.


### D-438: Bind UF2 attempts to one mount and qualify sync recovery by revision. (2026-10-22, Stage 9 round 3)

Refines D-437. Record the selected mount path, device and inode when the drive appears. Revalidate them before every write attempt, including EACCES/EPERM retries, and before the final sync. Recheck shared-label peers each time hooks are available. Refuse duplicate label mounts, including macOS numbered mount names and multiple Linux matches. Boards without hands-free hooks keep their existing manual flow, including an already mounted shared drive, because they have no rollback or verification to protect. Once a complete image is written, a drive that goes away or changes is left to verification and the unmount check rather than failing the half.

A later successful flash supersedes a failed sync only when every expected half is visible on a successfully flashed build of the failed revision or a descendant in the same config. A successful flash of an older revision preserves the failure and automatic retry block. Failed rows remain in history.

Kanata has loaded revisions rather than firmware builds. Its readback of the head revision supersedes a failed remapper sync, including recovery through `keyloom remap apply`. Keep this in the existing running-revision model instead of inventing build and flash rows for a remap. An older loaded revision still leaves the head failure in place.

Evidence: `test/firmware/zmk/mount-binding.test.ts`, `test/app/sync-state.test.ts`, `test/app/sync-zmk.test.ts` and `test/app/remapper-sync.test.ts`. These use synthetic mounts, transports and kanata; no hardware verification is claimed.

### D-439: A UF2 drive is found only once it is mounted. (2026-10-22, BK's Glove80 under v0.53.0)

Refines D-438. Volume discovery under a mount root counts a label's directory only when it is on a different device from the root. macOS creates `/Volumes/<label>` on the system volume about 350 ms before it mounts the drive over it. Taking that bare directory made the first write fail with EACCES, and under D-438 it bound the flash to an identity the mount then replaced, so v0.53.0 refused every hands-free Glove80 flash before writing. The D-438 binding stays as it is; it now binds the mounted drive. The EACCES/EPERM retry stays for drives that really refuse a write. Test roots are plain folders, so the test preload turns the device check off unless a test asks for it.

Evidence: `docs/issues/uf2-mount-point-taken-before-mount.md` (hardware observation and failed flash `fl_01M5HZ4V726WBAZXY47PYD9C16`) and `test/firmware/zmk/mount-binding.test.ts`.

### D-440: The macOS touch sets its rate with IOSSIOSPEED. (2026-10-22, BK's Glove80 under v0.53.1)

Refines D-433's touch sequence on macOS. `tcsetattr` refuses a non-standard rate such as the 1201 relay with EINVAL, so v0.53.1's `serial.touch` at 1201 failed with `io_failed` and the relay never reached the firmware. The touch now sets the speed with the `IOSSIOSPEED` ioctl (`_IOW('T', 2, speed_t)`, IOKit/serial/ioss.h), then verifies both speeds with `tcgetattr` as before, for 1200 and 1201 alike. Linux already uses `termios2` with `BOTHER`, and Windows sets the DCB rate, so neither changes. Intel Macs still touch through `stty`, which has no way to set a non-standard rate on macOS. Their relay stays broken until Intel moves to the native helper.

Evidence: `docs/issues/macos-1201-relay-rejected-by-tcsetattr.md` and [the native-default spike record](../research/spikes/device-helper-native-default.md).

### D-441: The desktop app starts keyloom with the login shell's PATH. (2026-10-22, BK's installed app)

An app opened from Finder or the Dock inherits launchd's PATH, `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`. The bundled `keyloom serve` in BK's 0.53.1 app ran with exactly that, so it couldn't find `codex`, `docker` or `zapp` in `/opt/homebrew/bin`. Chat said it had no model, and builds and Moonlander flashing from the app would have failed the same way. kanata was unaffected because its lookup already checks Homebrew's folders directly.

The shell now runs `$SHELL -ilc` with `/usr/bin/printenv PATH` between unique marks, once per server start. It uses external commands only, because nushell doesn't expand `"$PATH"`. It reads until the closing mark rather than end of file, because a profile's background process can keep the pipe open. The whole exchange has a 3-second deadline. The sidecar gets that PATH followed by any inherited folder it lacks. Without an answer in time, it gets the inherited PATH with `/opt/homebrew/bin` and `/usr/local/bin` added. Only PATH is taken: API keys exported in a shell profile still don't reach the app.

`tauri-apps/fix-path-env-rs` does the same, but it isn't published on crates.io and waits on the shell with no deadline, so a slow shell profile would hang the app at launch.

Evidence: `docs/issues/desktop-app-cannot-find-homebrew-tools.md`.

### D-442: Refuse a UF2 restart while the macOS screen is locked. (2026-10-22, Stage 11)

Before a macOS UF2 flash restarts a ZMK half or waits for its boot drive, keyloom reads `IOConsoleUsers` from `ioreg -n Root -d1 -a` through `plutil -extract IOConsoleUsers json` (the full IORegistry plist has `<data>` values plutil can't write as JSON) and matches `kCGSSessionUserIDKey` to the current process uid. A true `CGSSessionScreenIsLocked` refuses before the restart; if the screen locks during the drive wait, the instruction and timeout explain that macOS will not mount the drive until unlock. A drive already mounted needs no check. Missing lock keys mean unlocked. If the probe fails or its output cannot be read, log the failure and continue so a broken probe cannot block a flash. The check is macOS-only; QMK's DFU path is unchanged.

Evidence: `test/firmware/toolchain/screen-lock.test.ts` and `test/firmware/zmk/flash.test.ts`. The lock probe is tested with the JSON shape plutil prints and flash behaviour with injected functions. The live probe on BK's unlocked Mac returned false; no hardware flash was run.

### D-443: The desktop sidecar inherits allowlisted provider settings from the login shell. (2026-10-22, Stage 11)

Refines D-441. Read `PATH`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `CODEX_API_KEY`, `CODEX_HOME`, `KEYLOOM_CODEX_BIN`, `KEYLOOM_CODEX_TRACE` and `KEYLOOM_PROVIDER` in the same bounded login-shell exchange: one `/usr/bin/env -0` between unique marks, parsed in the app, which keeps only those names and drops every other variable. NUL-separated records stop a multi-line value of another variable from passing for an allowlisted one, and the marks are anchored (the opening one starts a line, the closing one follows a NUL) so a printed command or a value containing the mark can't move them. A single external command keeps it working in nushell, which has no `||` for a `printenv` of an unset name. Pass non-empty allowlisted values to the sidecar only when the desktop app did not already set that variable; never log their values. If the shell misses the three-second deadline, keep D-441's PATH fallback and pass no shell provider values.

In the desktop app, putting a provider key in the shell profile and reopening keyloom makes it available to chat, unless the app has attached to a `keyloom serve` started in a terminal (`--reuse`), which keeps that server's environment. Terminal users still restart `keyloom serve` after setting a key. The app never persists a key.

Evidence: desktop `login_path` parser, allowlist and deadline tests. A probe under a minimal environment with a scratch `.zshrc` exporting a dummy `ANTHROPIC_API_KEY`, `KEYLOOM_PROVIDER` and an unrelated variable got only the two allowlisted names, in 18 ms despite a background process holding the pipe; with `KEYLOOM_PROVIDER` already set in the app's environment, only `ANTHROPIC_API_KEY` came from the shell.

### D-444: Refuse unknown QMK calls that receive a known layer name. (2026-10-22, stage 11 C3)
- If kept QMK code passes a layer enum name to a function whose layer semantics keyloom does not know, a layer reorder is refused and the call's line is named. The importer cannot prove how that function uses the layer value.

### D-450: Agent-made configs open themselves unless BK is editing or has moved on, and the reply carries a config card instead of directions. (2026-10-22, BK's v0.53.2)

When BK asked the agent to copy a setup to another keyboard or to make a new config, the agent made the config and told him to "switch to it from the config menu", and the menu didn't list it until a reload (`docs/issues/config-menu-misses-agent-config.md`). The agent now says nothing about where it is. keyloom does the navigation.

When BK watched a reply finish, the run completed and a `put_config` or `create_config` operation in it succeeded with a config reference, the page opens the last config made, through the same switch a menu pick uses. The chat thread travels with it (D-317) and the new config's proposals show as "N proposals waiting" beside the board (D-336). A config on another board opens on its own board.

It does not open when BK has a key card, a combo draft, a key being placed, a swap, a quick-assign run, an unapplied or parked draft, a dialog or a staged colour change open (28: "Do not steal focus from someone typing or editing elsewhere"), when he has gone to another config while the run worked, or when the run was stopped, failed or ended incomplete. It opens a config at most once per page, and never for a reply the chat did not send in this page: history, a run found again after a reload and a thread carried in from another config are all read-only replays. Gating on "sent and watched here" is the only reliable signal, because a replay and a live reply look the same in the data once they are on screen.

Every reply that made a config shows a card for each, from the operation references and `GET /api/configs`: name, board, source, open proposals, and "Open" from another config, or "Review N proposals" with "Back to <config>" once on it. If only the proposals cannot be read, the card drops the count and keeps its actions; its error wording gives no directions. The card is not stored on the turn; the typed `config_result` artifact stays unwired because nothing but the client needs this. The presentation keeps two references per operation (`chat-presentation.ts`), enough here because `put_config` records the config first.

The menu and ⌘K reload their list when a turn names a config the list lacks. A card's "Open" for a config the page's list doesn't have yet reloads the list too, because selecting an unknown config left the page on its loading skeleton.

Refines D-317 (the thread carried across a switch) and D-336 (a new config opens with its proposals).

Evidence: `docs/issues/config-menu-misses-agent-config.md`, `docs/research/ui-audit/agent-opens-config/`.

### D-445: Shutdown closes manual flash admission before draining accepted starts. (2026-10-22, Stage 11)

Refines D-421/D-422's consumer-before-helper lifetime. Register a manual flash start before checking its artifact asynchronously. Once shutdown begins, refuse new starts with `UsageError` (the editor's existing HTTP 400 `usage` code), wait for every accepted start to register its task or fail, then wait for running tasks before closing the helper. Always release pending starts, including when the artifact check throws. Admission closes for the App being shut down, not the whole process, so other Apps in the same process (a test run's) are unaffected.

Await sync startup once before stopping the sync and review engines, including when startup fails. Log startup rejection without swallowing it: shutdown reports that reason once, alongside any helper cleanup failure. Settle both stops independently so one failure cannot hide the other or close the helper before the remaining stop finishes.

Evidence: `test/app/firmware-shutdown.test.ts` gates artifact checks and checks another App still admits flashes; and final flash callbacks against fake toolchains; `test/cli/serve-shutdown.test.ts` exercises the serve stop hook with deferred startup and stop failures. No real keyboard was flashed.

### D-446: Capture owns write and close deadlines. (2026-10-22, stage 11 A3)

Refines D-429: both QMK and ZMK capture put a 750 ms bound on each START, keepalive and STOP write, and 1250 ms on their single close. These backstops leave the helper's 500 ms write and 1 s close deadlines time to report first. A timeout reports incomplete capture or cleanup uncertainty; it does not claim cancellation, retry a write or call close again. Keepalives start as soon as START is written, because the firmware ends the stream after 3 s without one; finish awaits the bounded in-flight keepalive before cleanup. Failed-start errors remain primary, with STOP/close failures appended and the original error retained as the cause. A ZMK framing failure attempts STOP before close and keeps its framing error primary.

Evidence: `test/firmware/toolchain/key-capture-deadlines.test.ts` and `docs/issues/zmk-capture-trusts-transport-deadlines.md`. All new evidence uses synthetic sessions; no physical keyboard was opened.

### D-451: A copy translates the raw code keyloom understands, any change may add it, and the risky kinds warn. A refinement of D-024. (2026-10-23, BK's decision on the copy's natives)

BK, asked directly: "allow understood raw codes, warn on risky ones". D-024 said firmware source keyloom doesn't model stays as written and is never copied, and the validator refused any native the document didn't already have. The copy would translate a Glove80's shifts, lights, boot and reset keys to QMK, and every one of those would fail validation. So the rule changes in two parts.

A new native is admitted when it is on the layout's own firmware and the reader knows its meaning (`src/layout/native-read.ts`). That covers a copy's translation and an agent's edit alike, since `evaluate` is the one validation path for both. Kanata admits only the forms `kanataSource` writes (`kanataWrittenByKeyloom`). Source keyloom can't read stays refused on every path.

Four kinds warn, as a validator warning (`risky_native`, `src/validation/rules.ts` `riskyNatives`), not an error. A warning never blocks a change or a put. They are the bootloader, reset, Bluetooth clear and clear-all. A key that is already in `before` doesn't warn again, so an imported Boot key stays quiet when another key is edited. A one-shot, the caps word, lighting and a Bluetooth select never warn. The sentence follows the key's place, as `keyPlace` names it: "Left pinky, number row would put the keyboard into its bootloader when pressed", "... would restart the keyboard when pressed", "... would forget every paired Bluetooth device", "... would forget the Bluetooth device paired on the current profile". The warning is not in the agent's decline count: the observation counts errors only (`src/agent/observation.ts`), so `risky_native` never reaches the presentation's `validation_declined` path.

Why the warning. A copy puts a key on a board where the same key was harmless on the source, and an agent can add one by accident. A bootloader or unpair key pressed by accident costs more than the other natives, so BK sees it before he applies.

Evidence is in the test suite (`test/validation/validate.test.ts`, "risky_native"): a new bootloader key warns with the exact text above and changes nothing else; reset and clear-all warn; an unchanged imported key doesn't; one-shot, lighting, caps word and select never warn. The rest of the admission is tested in `test/layout/native-translation.test.ts` and "a native keyloom reads ... can be added". Unknown source is still refused: `DUAL_FUNC_9` and another firmware's native.

Compile proof. Each writer spelling was built once. The Moonlander (QMK, `ghcr.io/qmk/qmk_cli`) build `bld_01M5JZVBRWYBTXATVEZB3A9EDF` has a layer holding every QMK spelling the writer emits: `OSM(MOD_LSFT)`, `OSM(MOD_RSFT)`, the multi-mod `OSM(MOD_LCTL|MOD_LALT)`, `CW_TOGG`, `QK_BOOT`, `QK_REBOOT`, `RGB_TOG`, `RGB_HUI`, `RGB_HUD`, `RGB_SAI`, `RGB_SAD`, `RGB_VAI`, `RGB_VAD`, `RGB_SPI`, `RGB_SPD`, `RGB_MODE_FORWARD` and `RGB_MODE_REVERSE`. The Glove80 (ZMK, `keyloom-glove80`) build `bld_01M5JZX0MAJBBMBBGBNNWK3C3B` has a layer holding every ZMK spelling: `&sk LSHFT` and `&sk RSHFT`, `&bootloader`, `&sys_reset`, all eleven `&rgb_ug` lighting ops, `&caps_word`, `&bt BT_CLR`, `BT_CLR_ALL`, `BT_SEL 0`, `BT_NXT`, `BT_PRV`, and `&out OUT_USB` and `OUT_BLE`. Both built with status `succeeded`. Each layer was added to a scratch copy of the layout as ops, and the validator returned those keys' warnings and no errors.

Warnings as rendered. Moonlander, two bootloader and reset keys: "Left index, number row would put the keyboard into its bootloader when pressed" and "Left index, number row would restart the keyboard when pressed". Glove80, four keys: "Left ring, function row would put the keyboard into its bootloader when pressed", "Left middle, function row would restart the keyboard when pressed", "Right index, number row would forget the Bluetooth device paired on the current profile", and "Right index, number row would forget every paired Bluetooth device". The one-shots, lighting, caps word and select keys in the same layers produced no warning.

Round 2 (independent review). Admission checks the whole original source, not a normalised reading: QMK's `OSM(MOD_LSFT)` must be the exact spelling, ZMK's source must be one call from its `&` with single spaces, and a kanata one-shot must name a modifier key `modAction` writes. So `Q K_BOOT`, `OSM(MOD_L SFT)`, `garbage &caps_word` and `(one-shot 2000 nonexistent-key)` are refused. A risky warning keys on the slot: a key warns unless its own layer position, or its combo id, held the same native in `before`. A macro with two risky steps names both. A new light key needs evidence of lighting controls (round 3, below). QMK's one-shot holds one hand (quantum/modifiers.h): `OSM(MOD_LSFT|MOD_RSFT)` is right Shift alone, and the writer refuses a left and a right modifier together. A layout with a Caps Word key gets `CAPS_WORD_ENABLE = yes` in its `rules.mk`, because the feature is compiled in only when it is on; build `bld_01M5K2QTBTAW1WS2V1Z4HAK6WQ` compiles `quantum/caps_word.c` with that flag, and the earlier build without it did not compile the file.

Feature table. Each spelling the writers emit, and what it needs:

- QMK `OSM(…)`, one hand: built into QMK; no flag keyloom writes. Compiled in the Moonlander build; not run on a board.
- QMK `CW_TOGG`: needs `CAPS_WORD_ENABLE`, which the generator now writes (above).
- QMK `QK_BOOT`, `QK_REBOOT`: built into QMK; compiled, not run.
- QMK `RGB_*` and `RGB_MODE_*`: need the RGB matrix. The Moonlander build compiles `quantum/rgb_matrix/rgb_matrix.c`. Admitted only with evidence of lighting controls (round 3, below).
- ZMK `&sk`, `&bootloader`, `&sys_reset`, `&caps_word`, `&out`: built into ZMK; compiled into the Glove80 build, not run.
- ZMK `&bt BT_*`: needs Bluetooth. The Glove80 build compiles it. A ZMK target is assumed to have Bluetooth (the copy's one assumption).
- ZMK `&rgb_ug RGB_*`: needs underglow. Admitted only with evidence of lighting controls (round 3, below).

Rounds 3 to 5 (independent review). A lighting key is admitted when the board has a per-key LED table (`board.lighting`, D-190) or the layout's `before` already holds a lighting key, which proves the firmware has the controls. No board data records underglow, so this is the only evidence there is. An imported Glove80 can move and swap its own `&rgb_ug` keys; a copy onto a blank Glove80 or Corne refuses them and says keyloom can't tell (`docs/issues/board-lighting-controls-not-recorded.md`). A combo is new when its output, trigger keys or layers change. A layer hold forwards its second argument to its tap, so a hold's lighting or bootloader tap is checked; a call must pass as many arguments as its kept node's `#binding-cells`, and a layer ref is admitted only once, exactly on the layer parameter. Spaces between tokens are read as C and devicetree allow, so `OSM( MOD_LSFT )` and `&sk  LSHFT` still translate for kanata; spaces inside a name aren't. ZMK's custom sticky key on `&kp` reads like one on `&sk`. kanata's one-shot holds one key, a layer or a chord, so a pair of modifiers is refused for kanata with that reason; `kanata --check` (1.12.0) passes a generated config with single-modifier one-shots and caps word, and rejects `(one-shot 2000 (multi lctrl lalt))`.

Known gaps, logged: a bootloader step behind a macro control in a tap isn't seen (`docs/issues/macro-tap-hides-risky-step.md`); Settings shows Caps Word off when a Caps Word key turned it on (`docs/issues/caps-word-setting-shows-off-when-enabled.md`); MoErgo's `&magic MAGIC 0` isn't read (`docs/issues/zmk-magic-define-layer-not-carried.md`); kanata has no name for Print Screen (`docs/issues/kanata-print-screen-has-no-name.md`).

### D-453: A board can record that its firmware has lighting control keys, `lightingControls` in `board.json`, so a copy keeps their RGB keys without a layout that already holds one. A refinement of D-451. (2026-10-28, fixes `docs/issues/board-lighting-controls-not-recorded.md`)

D-451 admits a lighting key when the board has a per-key LED table (D-190) or the layout's `before` already holds one. A copy onto a blank Glove80 has neither, so `keyboard put` refused the Moonlander fixture's three lighting keys (RGB_TOG, RGB_HUD, RGB_MODE_FORWARD) with "keyloom can't tell that the Glove80's firmware has lighting controls". The base commit `45c67e9` gives 3 refusals and 0 RGB keys on the Glove80 layout (scratch data dir, `keyboard put my-moonlander --on moergo/glove80`, applied); this branch gives 0 refusals and 3 `&rgb_ug` keys (`&rgb_ug RGB_TOG`, `RGB_HUD`, `RGB_EFF`).

`board.json` gains an optional `lightingControls: boolean` (`src/boards/schema.ts`). Absent means no evidence, which is every board written before this and every derived board, since derivation reads no lighting. `hasLightingControls` in `src/boards/capabilities.ts` is the one answer: a board with per-key LEDs, a board with `lightingControls: true`, or a layout that holds a lighting control. `nativeLighting` (`src/validation/rules.ts`) and the copy's lighting facts (`src/agent/copy-plan.ts`, shared by `keyboard put` and `put_config`) both call it. Per-key colours don't: `setLayerLighting` stays gated on `board.lighting` alone, so the Glove80 still refuses colours (its `limits.lighting`).

Evidence, board by board. The Glove80 sets it. MoErgo's firmware at `moergo-sc/zmk@ce69e85`, the revision keyloom builds (`boards/moergo/glove80/board.json`), sets `CONFIG_ZMK_RGB_UNDERGLOW=y` in `app/boards/arm/glove80/glove80_lh_defconfig` line 68 and `glove80_rh_defconfig` line 52. The Corne doesn't: upstream ZMK at `edf5c08` (`boards/foostan/corne/board.json`'s pin) comments out `CONFIG_ZMK_RGB_UNDERGLOW` in `app/boards/shields/corne/corne.conf` lines 1 to 2, and no file under `src/` or `boards/` sets a `CONFIG_ZMK_RGB*` option, so a Corne refuses until a layout proves otherwise. The Moonlander is already admitted by its LED table. The MacBook has no RGB keys of its own: its backlight is macOS's.

Proof. The Glove80 build of the copied layout compiles the three `&rgb_ug` spellings the copy writes: build `bld_01M60SV73PC2K2F0PNMZJMMQZ8` succeeded (scratch data dir, `keyloom build`, the layout put on the Glove80 with the three lighting keys applied).

### D-454: A client says which protocol it was built for, and `keyloom serve` refuses to start or attach when it differs; `--replace` swaps an older server for this one. A refinement of D-323 and D-324. (2026-10-28, BK: "make sure that the desktop app and any other clients check the version of the cli that's running")
- **Why:** `serve --reuse` attached the desktop app to whatever server was on the data directory. BK runs `~/.local/bin/keyloom` (through `serve.sh`, port 4477) and `/Applications/keyloom.app` side by side, and their versions will drift. The shell relies on the serve flags, two stderr marker lines, the `menuBar` object in `/api/events` frames, `POST /api/sync { layoutId }` and the `x-keyloom-token` header; an older or newer server may not honour them.
- **Protocol, not exact versions:** `DESKTOP_PROTOCOL` (`src/api/desktop-protocol.ts`) is one integer, 1, listing what the shell depends on and when to bump it. The shell compiles in the same number (`sidecar.rs`) and passes it as `serve --client-protocol <n>`. `test/api/desktop-protocol.test.ts` reads the Rust constant and fails if it differs, and pins the `menuBar` shape (the JSON schema, and the fields of the Rust `MenuBar` struct) with a message saying to bump both. Exact-version matching was rejected: any release would then break an app and CLI that still work together.
- **The CLI decides (D-324), and words it (D-325):**
  - A bundled keyloom whose protocol differs from `--client-protocol` refuses to start (exit 10, `client_protocol_mismatch`), naming both numbers. A bundled keyloom too old to know the flag fails on the unknown option, so the shell shows `keyloom could not start: keyloom exited early (Some(1)): …unknown option '--client-protocol'`.
  - `serve.json` records `version` (package.json) and `protocol`. A record without them predates the check and counts as older. Wrong types are read as absent.
  - `serve --reuse --client-protocol n` against a live server with another protocol (or none) prints `keyloom cannot attach: <words>` and, when it is older than this binary or unknown, `keyloom can replace it: <label>`, then exits 10 (`server_incompatible`). A newer server gets update wording and no replace line, because replacing it would downgrade it. Without `--client-protocol` (a terminal) `--reuse` attaches as before. Older is Bun's `Bun.semver.order`; a version that is not a plain semver counts as unknown, not as newer.
  - Every `serve` (not `--board-dev`) first takes the directory lock, `serve.lock`: a SQLite file held with `BEGIN EXCLUSIVE`, an OS lock the kernel drops when the process dies, so there is no pid file and no stale lock to break. It keeps the lock until its own server has announced itself, or until it attaches or refuses. A plain `serve` therefore can't start between a replacer's old server exiting and the replacement announcing, and two replacers can't both win.
  - `serve --replace` takes the data directory's schema guard (D-455) first, read-only, then the lock, then stops the live server with SIGTERM only and waits for its process, not its record, to be gone, because the server drops its record before it finishes a keyboard write. The lock wait and the stop wait share one 120 s budget (`TAKEOVER_TIMEOUT_MS`), under the shell's 135 s wait for the sidecar's URL, which applies in `--reuse` as well as `--replace` because any mode may queue behind the lock or a draining server. It never sends SIGKILL. EPERM, a timeout, or a newer server leave the other server running and start nothing. It refuses `--reuse` beside it.
  - A server is signalled only if it is the one that was verified: discovery re-reads the record after its probe and looks again if it changed, and the record is read once more immediately before SIGTERM (same pid, url and start time), else the CLI re-assesses (three tries). A server that answered a probe and then dropped or changed its record while its process still exists is shutting down (SIGTERM removes the record before a keyboard write finishes), not absent: every `serve` mode then waits for that process to exit, without signalling it and inside the same budget, before looking again, and a timeout starts nothing. A pid recycled to a non-keyloom process can only cost that wait: the person sees "keyloom process N was already shutting down and had not exited 120 s later … no second server was started". An exhausted budget signals nothing.
- **The shell stays thin:** it maps exit 10 and the two marker lines to the tray summary, adds a menu item with the CLI's label when a replace is offered, and re-runs the sidecar with `--replace` only when that item is picked. It never stops another process itself.
- **Not covered:** the open web page. It is served by the process that issued its token, so they always match; a tab left open across a restart gets 401s.

### D-455: A keyloom refuses a database that a newer keyloom has migrated. (2026-10-28, BK's request under D-454)
- **Why:** `migrate()` applies the migrations it knows and ignores rows it doesn't, so a 0.50 keyloom opened, read and wrote a database 0.57 had migrated, and the CLI, `serve` and the desktop sidecar share one file.
- **How:** `openDatabase` reads `schema_migrations` before any migration and throws `SchemaTooNewError` when the highest version is above the highest in `MIGRATIONS`. The message names the database's schema, this binary's version and the schema it knows, and says to upgrade. `classify` maps it to exit 10 and kind `schema_too_new`. `assertDataDirOpenable` is the same check on a read-only connection, for `serve --replace`.
- **Every open goes through it:** `openDatabase` (the CLI, `serve`, the sidecar) and `keyloom doctor`'s read-only connection call it, and doctor lets the error propagate (exit 10) instead of listing it as a failed check. The other opens need no guard: `serve.lock` and the guard's own read-only check hold no user data.
- **Limit:** it protects only binaries that have it; the 0.56.0 installed today does not refuse a newer database.

### D-456: The reply footer shows the dollar figure at rest; tokens, cache counts and how the figure was reached are one click away. A refinement of 12-cost-model's footer line. (2026-10-28, BK: the agent's cards are "wordy and overwhelming")

The footer under every reply was two lines ("300 input · 150 output tokens", "$0.0042 USD estimated") on each turn. It is now one button reading the USD figure, or "Cost not reported" when there is none. Its panel holds the token line and the wording "USD reported" or "USD estimated" (`src/web/chat/TurnUsage.tsx`). Every rule in `12-cost-model.md` still holds in that text: estimates only for the exact Opus 5.5 IDs, no zero-cost claim for an unknown model, an unavailable total when any request omits its charge, and legacy turns say "not reported". Nothing was dropped, only moved behind a disclosure with `aria-expanded`.

### D-457: A question card is a neutral surface with no accent border or wash. Replaces D-381's styling clause. (2026-10-28, BK approved the calm-cards comps)

28 says no question, proposal, result or confirmation gets a coloured edge, and D-381 gave the question card the outcome prompt's accent border and wash. The card now uses `--surface-2` and `--line-2`; the Recommended mark and hover border are neutral. Every other part of D-381 stands: options of at least 44px, keys 1 to 4, focus on appear, the recommended mark, "Something else…" when `allowOther` is set, and the read-only answered line.

Built with it (the same round, `docs/research/ui-audit/calm-cards/README.md`): a proposal in chat says its first sentence, "N keys change" and its cost, with the keys, the rest of the reasoning, gains and what keyloom will remember behind Details; validator findings are one line with the full text a tap away (the editor's `Validation.tsx` keeps the full list); several alternatives are one row of tabs above the card, none for a single proposal; a waiting proposal in the panel uses the same card; the config card's count is the button's words. Fixed in the same round: the activity row's "2 saved proposals" for three came from `chat-presentation.ts` keeping two references per operation, and it also marked ordinary runs "details not retained"; it now keeps three, which `propose_changes` (at most three) and `put_config` (a config and two proposals) both fit inside the stored schema's limit of eight.

### D-452: The agent puts one best proposal on the board first and asks questions only to refine it; each answer supersedes the proposal before. Replaces D-020's two or three alternatives. (2026-10-22 and 2026-10-28, BK: "Yes, replace it.")

BK, 2026-10-22: the agent builds the best proposal first, then asks questions only to refine it, only about the keys that matter, and handles the rest quietly; and this applies to every agent task, so it is one reusable loop. On 2026-10-28 he agreed to replace D-020's alternatives with it. D-020's displacement, reachability and one-undo rules stand.

- **One proposal per call.** `propose_changes` takes one proposal and `supersedes: <id> | null`. A one-element `{ alternatives }` is still read, because stored conversations and the review run use it; two or more is a tool error. While any proposal of the agent's is open in the conversation the declaration is required, and a call without it saves nothing and names the open ones. An id replaces that proposal: it must be `proposed`, in this conversation and this layout, and it is set aside as `superseded` in the transaction that saves the new one. The new one must pass the validator first (D-014); an invalid revision is refused and the old one stays current. `null` stands beside the open one, which is how an unrelated request behaves (BK's default, 2026-10-29).
- **The link is in `change_sets.tradeoffs.supersedes`** with the other ids of rows this one displaced (`supersededDecisionIds`), validated by the same zod object, so no migration was added. A keyloom from before it reads the row and ignores the key, and shows the old set as `superseded`, where a column would have made D-455 refuse the data directory. Reusing `proposal_group` was rejected: applying one member supersedes its siblings, and the chat joins a group's members into tabs.
- **Every answer is a revision**, with the same ops when it only confirms the proposal: the decision applying writes is the last draft, so an answer that gets no revision never reaches it. A revision inherits the superseded proposal's `sourceMessageIds`, which accumulate along the chain, adds every answer or message of his since that proposal was saved (so one the model did not revise for still links), and adds the current turn's, without duplicates. No decision is written per answer: applying writes one, whose reason carries his answers.
- **Questions refine.** `ask_user` takes `considerations` (1 to 3 lines), `step { n, of }` (`of` at most 5; the prompt asks for at most three questions) and, for the default single_choice kind, two or three options (the pickers keep their longer lists; a stored question with four still loads). The model is held to that shape; what is stored reads through a looser schema, so a question stored before it still loads while its conversation waits. The recommended option is drawn first and is the only one marked, whatever order the model sent (applied when the card is built, so the stored call is replayed unchanged). "Question n of m" shows only when m is 2 or more.
- **Propose, then ask, in separate replies.** The Anthropic and OpenRouter adapter runs a non-pausing call batched with the question before it stops, in the order the model wrote them, and answers only a second question with "Not run"; Codex runs calls in its own order, which the tool server already honours up to the pause, and refuses every call after it. A valid question ends the turn as `awaiting_answer` whatever the calls beside it or before it did: one refused at the 64-call activity limit gets an error result, and the limit no longer turns the turn into an `iteration_limit` with the question open on a failed run.
- **Applying while a question is open ends it** (BK's default for the proposal on screen, 2026-10-29; the same rule closes the question when any other proposal of the conversation is applied). Which proposal a question refines is recorded when the question is stored, never worked out at apply time: it is the last proposal saved before the question in the order the model made its calls (proposals of earlier replies of the turn, and calls before the question in its own reply; a call after it never counts), and none for a question asked before anything was proposed (a remembered-decision question). The adapter tells the turn where the question falls (`ModelRequest.onPause`); Codex needs no signal, because its tool server refuses every call after the question. The record is `questionRefines` in the turn's stored presentation, the JSON written when the run pauses, so no migration; the card carries it as `refines`. Applying any agent proposal of the conversation stores a result for the open question in the apply's transaction, resolves its presented question and completes the run that paused on it: for the proposal the question refines it is `BK applied the proposal without answering.` and the card reads "Skipped, you applied the proposal"; for any other it is `BK applied another proposal ("<title>") without answering. The layout has changed since you asked, so this question is closed; ask again if it still matters.` and the card reads "Closed, you applied another proposal". Every apply moves the layout head, and the two guards of durable runs (D-411) refuse an answer once the head has moved since the run paused, so a question left open would be one BK can see and cannot answer; the guards are unchanged. If an agent proposal of the conversation was applied while the turn was still running, the paused turn is committed with the result already stored (Skipped when it was the proposal the question refines, otherwise Closed) and the run does not wait. A proposal that was only rejected, or revised by a call in the same reply, ends nothing, because the head did not move. The result is read from its fixed text, so the card holds after a reload and a later message, and the model is told on the next request. The head moving by other means while a question waits (an editor edit, an undo, an apply in another conversation) still leaves it unanswerable and is logged in `docs/issues/open-question-unanswerable-after-layout-change.md`. A board pin follows a proposal when it arrives, not when its reply ends. On reload the question shown for a reply is the call without an error result, so a call the adapter refused (invalid input, or "Not run" beside the one that paused the turn) is not the one displayed.
- **Cost:** a task with two questions is three turns where it was two; a request with nothing to ask writes one proposal where it wrote up to three (12-cost-model).
- **Built with it:** the compact card says each function a proposal drops and its reason at rest (`docs/issues/compact-card-hides-dropped-functions.md`); the transcript marks the old card superseded as the new one streams in; the board pins the newest open proposal across the thread; the log re-places a card that text arriving after it pushed out of view; and `command-shift.eval.test.ts` is the live check, one run per provider.
- **Not in this decision:** a per-option board preview on the question (A2b), the copy adapting to the target board (A3), a "Fix issues" button (A4).

Evidence and comps: `docs/research/refine-loop/`.

### D-458: A question is answered even after the layout head has moved, and the model reads a note first. A refinement of D-411 and D-452. (2026-10-29, BK: "fix the issues"; the orchestrator chose option 2 of `docs/issues/open-question-unanswerable-after-layout-change.md`)

D-411's durable runs refused an answer once the layout head was not the one the run was accepted at, and D-452 left that standing, so a question BK could see could not be answered after an editor edit, an undo or an apply in another conversation. The answer is now taken whatever moved the head. This replaces D-452's sentences that the two guards "are unchanged" and that a head moved by other means "still leaves it unanswerable".

- `agent_runs.revision_id` is the head the run was accepted at. It was written once, at acceptance, and read in exactly two places: the refusal in `answerAgentRun` ("that question or its target is no longer current") and the one in `storeMessage` ("that question's target has changed"). Nothing a resumed turn does reads it. The answer starts a new run, which records the head at its own acceptance. `runAgentTurn` takes the layout from `ports.snapshot()`, and the tools that read or check the layout go through the ports each time they are called. `propose_changes` validates against the head at that moment and saves that head as the proposal's base, `applyChange` validates again (D-014), and effect receipts are keyed by run, operation and input, not by revision. Before D-411, `sendMessage` took such an answer with no check. 26b's contract calls the refusals "target-revision checks" made within acceptance and says no more about them. They kept an answer from reaching a layout the question was not about, and they could not make the model's earlier readings of the layout current.
- Those readings are what the note is for. The history holds the tool results the model read before it asked, and an answer about keys that moved is read against them. The stored result of an answer given after the head moved is a note, a blank line, then BK's words: `The layout changed after your last reply began (1 revision: "<summary>"). Read it again with get_layout before you revise anything. BK's answer:`. Several revisions read `(3 revisions, the latest "<summary>")`; a starting head that is not among the layout's revisions leaves the parenthesis out. The summary is the revision's headline on one line, cut to 100 characters with an ellipsis.
- "After your last reply began" is `revision_id`, the head the run was accepted at, not the head when it paused. A change made while the turn was still working is counted, and it was the case that left a question unanswerable from the moment it appeared.
- The note is stored with the answer, so the next message replays the history the model last read, and BK's words are recorded apart from it. The stored result has `content` (the note, a blank line, his words), `words` (his words alone) and `providerData` (the block as the API gets it). The card shows `words`, so it never depends on reading the note back out of the text, and an answer that begins with the note's own sentence is shown whole. `providerData` is there because an older keyloom sends a block with a key it does not know exactly as stored, which would put `words` on the wire. Built in `src/app/answer-after-move.ts`. An answer given with the head where the run left it is stored as before, as plain text.
- Codex is sent the stored conversation as text and cuts each tool result at 2,000 characters (`src/agent/codex/prompt.ts`). That suits a result it can fetch again and not BK's answer: the note can push an answer over the limit, and `keyloom agent answer` has no length cap (the HTTP routes cap an answer at 500 characters). The formatter now keeps the result of every `ask_user` call whole. Anthropic and OpenRouter share an adapter that sends a stored result as it is, and keyloom clips nothing there.
- What stays: the question must be the open one, the addressed run must be `waiting_user`, the conversation must belong to the layout, and a repeated request identity returns its first continuation. A message typed instead still answers the question in his words, with no note. Every revision the model then proposes is validated against the head as it is when proposed and again when applied (D-014), and BK applies it, so nothing is saved or applied against a layout it was not checked on.
- D-452's rule stays: applying an agent proposal of the conversation ends its open question, as Skipped for the proposal it refines and Closed for any other, with the Closed text unchanged. Its reason changes. The apply is BK deciding by acting, not a way to keep an unanswerable question off the card.
- Not covered: a turn started with `sendMessage` (the CLI's `chat` and the legacy stream route) creates no run row, so its question has no starting head and the legacy route's answer to it carries no note. That answer was never refused for the head, and still is not.

### D-459: `keyloom layout settings <layout>` prints the Settings page's view, read only. A change stays with `setFirmwareSetting` ops. Extends D-030 to firmware options. (2026-10-29, BK: "fix the issues")

The Settings page shows every firmware option with its value, default and forced state, and the CLI showed none of it: `layout show` carried only what the layout stores, which hides a Caps Word key's forced "on" (`docs/issues/cli-has-no-settings-view.md`).

- **One row per option the page offers** (`optionsFor(board)`): `key`, plain `name`, `group`, `kind`, `unit`, `value` (`currentValue`, forced values included; null when the stored text is an expression, whose result is not known here), `default` (`baselineOf`, which reads an Oryx `rules.mk` switch), `stored` (`isSet`), `source_text` (the stored expression when the value is not a number or switch, such as `(TAPPING_TERM + 10)`) and `forced_by` (`forcedOn`, the reason text or null).
- **Formats:** table (`KEY NAME VALUE DEFAULT STORED NOTE`, the forced reason in the note), json (the layout's ID, name, board and revision, then `settings`), jsonl (one option per line with `layout_id`), ids (the keys). `--rev` reads an older revision, as `layout show` does.
- **Read only.** No `set` verb: a write is a `setFirmwareSetting` or `removeFirmwareSetting` op through `change check`, `change propose` and `change apply`, so it passes the validator like every other change (D-014). `--help` and the table footer say so.
- **Not shown:** settings the layout stores that the page has no control for (`otherSettings`). They stay in `layout show --format json`. A board with no options (the MacBook's kanata) prints a one-line note.
- **Built in** `src/app/firmware-settings.ts` (`layoutSettings`) and `src/cli/main.ts`; tests in `test/cli/layout-settings.test.ts`.
