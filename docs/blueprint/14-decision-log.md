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
