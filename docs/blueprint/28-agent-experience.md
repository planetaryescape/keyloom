# 28: The agent works beside the keyboard

Status: partly implemented, 2026-10-20. Rung 26a shipped in v0.42.0. Rung 27 interactive question kinds (single/multiple choice, short text, layer, key, keyboard_or_config), explicit recommendation, reopened selection actions, typed artifacts, and confirmation/outcome cards are built on feat/rung27-interactive-questions. Agent-made configs open themselves and the reply carries a config card (D-450, 2026-10-22). Proposal, config, question and footer cards were made calmer (D-456, D-457, 2026-10-28). The agent proposes one best proposal first and refines it with questions, each answer superseding the proposal before (D-452, built on feat/refine-loop). Cross-keyboard target plans below remain proposals. Original source baseline: `71934e13f8c0c8b702b6dc1beb57ca25993f7cf3`.

Reconciled with origin/main at `72370d0494497ae4bdd6036106fcec9d3f6c1aab`: inherit the no-accent-stripe/no-sparkle rule in [18](18-visual-design.md#patterns-keyloom-doesnt-use) and separate case/keycap controls (D-319).

BK approved the synthetic 26a running/waiting/completed/failure visual proposal (Q30, D-409). The compiled candidate passed completed-history, composer, folding/reopening, reload and Stop-after-preparation journeys in both themes and desktop/phone sizes. Stop remains reachable when another sidebar replaces chat (D-410). These checks use a deterministic provider and synthetic data, not a real model or keyboard. Later cross-board/key-picking designs are not covered by that approval.

The agent must feel like part of a keyboard configurator. BK can point at keys, describe a frustration, operate the app, and carry something between keyboards without translating his request into firmware syntax. While Keyloom works, he can see what is happening. Afterward, the result takes the space and routine working detail folds away (D-396 to D-398).

Read [29](29-agent-app-control.md) for execution and events, and [30](30-agent-keyboard-context.md) for keyboard context. Existing code and reuse points are in [the baseline reading](../research/agent-native-baseline.md).

## The keyboard remains the object being worked on

Keep [23](23-design-concept.md)'s concept, "the keyboard under the light" (Q30). The extension is visible work beside that object: a quiet conversation column with clear activities and results that point back to the board. Do not redesign Keyloom as a full-screen chatbot or make a permanent tool dashboard compete with the keyboard.

The visitor is operating an instrument they type on every day. They should leave knowing which keyboard changed, what changed, and whether that change reached the device. A long answer is not the measure of success.

The shared mental model is the collection of boards, each board's configs, their layers and keys, and changes that may or may not be on the keyboard. A task is how Keyloom groups work; it need not become another noun BK must learn.

```text
Collection / board switcher                       Keyboard state
                 |
                 v
       Board -> config -> layer -> keys  <------>  Agent column
                 |                                request + scope
                 |                                work / question
                 +-------- preview <------------- result / Apply
                 |
          saved revision -> sync -> verified device outcome
```

The stage, conversation and sync line use the same target names and status sentences. Clicking a result may reveal a board or layer; it must not apply it. Switching the board does not change the target of work already running (D-402).

## Each turn has a request, visible work and an outcome

```text
┌──────────────────────────────────┐
│ Ask keyloom               Close  │
│ Editing  Glove80 · Daily          │
│                                  │
│                         You      │
│    Copy my Moonlander's           │
│    navigation layer here.         │
│                                  │
│ Moonlander / Daily -> Glove80     │
│ keyloom                          │
│ Reading Navigation…              │  subtle shimmer while active
│   Read source layer        Done  │
│   Match keys             Working │  actual operations, not a timer
│   Check reachability     Waiting │
│                                  │
│ [Stop]                           │
│                                  │
│ Reply or ask for something else  │
└──────────────────────────────────┘

After the proposal is ready:

┌──────────────────────────────────┐
│ Moonlander / Daily -> Glove80     │
│ keyloom                          │
│ > Read 2 configs; checked mapping│  collapsed in place, before the answer
│                                  │
│ Navigation is ready to preview.  │
│ Your current config is unchanged.│
│                                  │
│ [Navigation preview on the board]│
│ 12 mapped · 1 needs a place       │  illustrative counts, not real data
│ [Choose key]  [Review changes]    │
└──────────────────────────────────┘
```

Use these blocks, with one renderer per job (D-398, D-404):

| Block | What it carries | What the person can do |
|---|---|---|
| Request | BK's exact message, sent-time scope and selected keys | Reopen referenced keys without changing their meaning |
| Working section | Current phase, concise public notes and real tool activities | Expand details or stop future work |
| Question | One unresolved choice with an appropriate input | Answer without composing a technical reply |
| Result | Short answer and typed artifacts | Inspect the result in its native form |
| Confirmation | Named plan, targets, effects and device consequences | Approve that exact plan or cancel |
| Outcome | What was saved and what reached hardware | Open the affected config, undo a saved change or resolve a failure |

User messages are compact, inset and trailing-aligned, with a quiet filled surface. Agent responses are leading-aligned and mostly unboxed, with room for a readable result. Working details use smaller secondary text and compact rows. Labels and structure distinguish roles without color. Do not give every message, activity and result the same rounded card.

## State explains what is happening without inventing thoughts

| State | Visible behavior | Way forward |
|---|---|---|
| Ready | Context-aware composer; suggestions only when useful | Send a request |
| Accepted | Echo the request and its target immediately | Stop is available |
| Thinking | "Thinking…" or "Working out a mapping…" when that intent is known | Subtle shimmering status, elapsed time |
| Using tools | Name the real activity, target and its result as it arrives | Expand input/result summary |
| Writing | Stream the public response when the provider supports it | Do not keep an old tool falsely marked running |
| Waiting for BK | Stop shimmer; make the question or confirmation primary | Answer, approve or cancel |
| Ready to apply | Keep the proposal and unapplied label visible | Preview, compare, Apply |
| Sending | Follow the sync engine's actual phase | Stop only where the device operation can safely stop |
| Completed | Give the answer and artifacts the space; fold routine work | Reopen working or continue |
| Failed or blocked | Keep the failing operation, effects and recovery visible | Retry a safe step, fix a prerequisite or choose another target |
| Stopped or disconnected | Say whether work stopped or the connection was lost | Inspect recorded effects; reconnect or explicitly retry |

"Thinking" is a public activity state. Never show opaque provider thinking blocks or request hidden chain-of-thought. A short explanation such as "I’m checking whether that layer remains reachable" describes the job, not the model's private reasoning (D-399).

## The working section becomes quiet when the job is done

While running, show the current activity plus a few recent completed rows. Older rows live under "Earlier steps"; a long tool loop must not push the current status offscreen. A row has an operation label, target, state, elapsed duration and optional result summary. Raw JSON and diagnostic logs stay behind details, sanitized and bounded.

Use keyboard-specific labels: "Reading your Moonlander's navigation layer", "Checking that Symbols is still reachable", "Matching the thumb keys", "Preparing the MacBook preview". Unknown tools get an honest generic label and remain inspectable. Never manufacture a sequence of tasks to make an idle timer look productive.

On successful task completion, fold ordinary activity into a one-line disclosure, such as "Read 2 configs · checked 12 mappings · 8 s". Derive it from events. Do not collapse an unanswered question, pending Apply, unsent device change or error. If the person expanded the section themselves or has focus inside it, leave it open. Preserve scroll position when folding (D-397, D-405).

Keep that section before the final answer while running, folded and reopened. Finishing a reply must not move its working notes underneath the answer. BK corrected this ordering after seeing it in the live app (D-412); the follow-up implementation is not part of v0.43.0's proof.

A model reply can finish while a hardware job continues. In that case the answer is readable, but "Sending to your Glove80" remains live until the sync engine verifies it or reports another state.

## Questions use the keyboard when the answer is on the keyboard

Extend `QuestionCard`, preserving pause-and-resume rather than keeping a model process waiting (D-380 to D-382).

| Kind | Example | Input and stored answer |
|---|---|---|
| Single choice | "Keep the old hold, or replace it?" | Radio-like options; explicit value IDs |
| Multiple choice | "Which of these keyboards should receive the macro?" | Checkboxes and one submit; exact selected IDs |
| Short text | "What should this config be called?" | Labeled field with validation |
| Keyboard or config | "Which Daily config did you mean?" | Name, board silhouette, config and connection state |
| Layer | "Which layer should receive Navigation?" | The same layer chips and names as the strip |
| Key | "Where should this layer key go?" | Allowed keys highlighted on the target board; keyboard-accessible selection |

The initial kinds are assumed, not separately requested by BK (Q33). Use one meaningful question at a time. Do not ask for things Keyloom can read, choices already made, or harmless defaults already established in D-384. Distinguish a user preference from approval to mutate a config or device.

Picking a key is a temporary selection mode, not a binding edit. The prompt names the target board and layer, dims disallowed keys, provides a text/list alternative, and offers Cancel. Escape exits this mode before closing the agent. Answering after the target revision changes either remains valid by stable identity or asks for a refreshed choice; it never applies a stale position (S55).

Options have proper labels and focus states. Recommendation is an explicit field, not inferred from "first in the array". Do not steal focus from someone typing or editing elsewhere; announce the waiting state and offer "Answer question". Once answered, reduce the card to the question and answer with its original target.

## Results use app-owned views instead of prose imitations

| Information | Presentation | Connection to the rest of the app |
|---|---|---|
| Proposed binding, layer or timing changes | Existing proposal card and canvas preview | Same validated change set and Apply |
| Two possible approaches | Comparison with concrete gains, costs and changed keys | Preview each on the same target |
| Cross-keyboard transfer | Source -> destination, mapped/skipped/uncertain items, loss explanations | Inspect source or target; resolve a target key in place |
| Keyboard collection | Compact rows with silhouettes, configs and real connection/sync states | Open the selected board without applying anything |
| Where a function lives | Key chips and layer-access path | Reveal and highlight the actual keys |
| Version or config comparison | Existing diff-on-board plus named non-key changes | Restore through the normal preview path |
| Typing findings | Per-finger counts and evidence-backed suggestions | Existing lab findings only; no recorded text to the model |
| Build or sync | Current step, device target and verification result | The existing sync engine, not invented percentages |
| Import or diagnostics | File/board summary, preserved/unsupported features, actionable findings | Existing importer and doctor results |
| Safe explanation | Markdown with restrained formatting | No card needed for an answer with no structured result |

A config the agent makes (`put_config`, `create_config`) is the one result built end to end so far. The reply ends with a config card that the client builds from the turn's operation references and the config list: the config's name, its board, where it was copied from, how many proposals wait on it, and its actions: "Open" when the config isn't on screen; once BK is on it, "Review N proposals", which shows them beside the board, with "Back to" the config he asked from beside it. A config deleted since shows a sentence and no button. When BK watched the reply finish and is not in the middle of anything, keyloom also opens the config itself, carrying the chat thread with it (D-317) and leaving its proposals one click away (D-336). It stays put while a key card, combo, placed key or unapplied draft is open, once BK has gone to another config, and for any reply replayed from history, a reload or a carried thread; then the card is the offer. The agent no longer tells BK where to find the config (D-450). The typed `config_result` artifact stays unwired: the card needs no server field, and what did not carry across is the server-built `transfer` artifact's job.

The model supplies content and references, not HTML, JSX, CSS or runnable components. Large results show a summary and an inspectable list with counts. Unsupported features remain visible even if some keys transferred successfully (D-404).

## Motion supports activity and then stops

Inherit Instrument Sans, the existing size scale, spacing, surfaces, icons and semantic colors from [23](23-design-concept.md) and `src/web/tokens.css`. Keep the board's light and color semantics. A completed read step uses a quiet check and "Read", not device-green "On your keyboard".

## One proposal, then questions that refine it (D-452)

The agent puts its single best proposal on the board first, using defaults it says in a line, and asks only about a choice that would change it and that nothing BK said answers (at most three questions, one at a time). Every answer produces a revised proposal (the same ops when it only confirms the proposal, so the answer is in the decision), which the validator checks and which supersedes the one before: only the newest can be applied, and the board pins it the moment it arrives, even if the reply is then cut off. The flow applies to every task the agent proposes changes for and every provider. Comps and design note: [refine-loop](../research/refine-loop/README.md). A new request while a proposal is open sits beside it unless the agent says it replaces it.

## Card shapes: a line or two, details on demand

BK called the cards wordy (2026-10-28); the shapes below are built (D-456, D-457). Each says what changes and what it costs in a line or two, with one primary action; the board preview carries the key-level detail.

- **Proposal.** Title, the explanation's first sentence, "N keys change" with the cost (cut at two lines), a line for each function the proposal drops with its reason ("Drops F16 · you said you barely use it"), one validator line when there is a finding (the full text a tap away), Details (the keys, the rest of the reasoning, gains, costs, what keyloom will remember), then Not this and Apply. There is one proposal, and a revision replaces it: the old card folds to one line, "Superseded by the revised proposal", with Details and no Apply. Tabs appear only for a group of alternatives stored before D-452. The panel for a copy's waiting proposals uses the same card, with tabs for its two ways of putting a config on.
- **Config.** Name, board and source, and "Review N proposals" as the one primary button; "Back to X" is a text link. The count is not repeated as a fact.
- **Question.** A neutral surface (D-457) with "Question n of m" (only when m is 2 or more), the question, one to three considerations, and numbered options of at least 44px with the recommended one first and marked (D-452). It sits under the proposal it refines. Answered, it is a quiet line without the count; when BK applies the proposal instead, it reads "Skipped, you applied the proposal".
- **Activity and footer.** Remembered chips with an icon and no label, working notes folded into one line when the run is clean, and one USD figure under the reply (D-456).

No question, proposal, result or confirmation gets a colored stripe on its edge, a substitute glow or a sparkle/wand icon for AI. Reuse the existing title glyphs, plain labels and marks on the keyboard. A color picker can address the case or keycaps separately; neither setting is firmware lighting.

Proposed motion values for the comps (Q30):

- Active text gets a low-contrast luminance sweep, about 1.8 s per pass, limited to the short status label. It remains legible throughout. No rainbow, whole-message shimmer or layout-changing animation.
- Activity rows arrive with a 140 ms opacity change; completion replaces the activity indicator in place.
- Folding working takes about 180 ms and preserves the viewport anchor. Do not animate when the user is reading within it.
- Applying reuses the existing key press and sync light. Do not add a second success celebration.
- Under reduced motion, use static status text and icons, immediate changes and no shimmer. A pause-animation setting may stop continuous motion without stopping work.

## The same work fits a phone and assistive technology

The desktop agent remains a column beside the stage, with a resizable width bounded by a readable board and readable prose. On a phone, use the existing full-width sheet. "Choose key" can lower the sheet to expose the target board and keeps the question pinned; returning to the question preserves the chosen key.

All controls work with a keyboard. Disclosures expose `aria-expanded`; status announcements are polite and limited to meaningful transitions, not every token or timer tick. Questions use native form semantics. Tool errors do not repeat in multiple live regions. Touch targets follow the existing 44 px question-card floor. New text and non-text contrast pairs join the existing tests.

Work that survives closing the agent gets a quiet header status, such as "Checking your Glove80" or "Needs your answer". Closing a panel is not Stop. Reopening shows the same run; it must not create another one.

## Walk the important moments through the whole app

1. **Fix the keys in front of me.** Select S and D, ask to mirror their holds, see their context on the request, watch actual reads/checks, preview amber on those keys, Apply, and follow the existing sync line. The final outcome says whether the keyboard was verified; undo remains one saved change.
2. **Copy from another keyboard.** Ask on the Glove80 for a named Moonlander layer. Read it from the collection, show source/destination, surface compatibility losses, resolve only a meaningful gap, and preview on the Glove80. The Moonlander remains unchanged.
3. **Send to another keyboard.** From the Moonlander, name the MacBook as destination. The proposal stays in the conversation with a MacBook target, not hidden in another config. Review on the MacBook and return without losing the request. Apply uses the destination's validator and remapper safeguards.
4. **Operate the app.** Ask to create a config, compare last week's version, pause sync or change the theme. Each returns the same result and affordances as direct manipulation. It does not merely quote a CLI command BK must run.
5. **Recover without guessing.** Disconnect after a config was created but before the answer arrived. Reopen the run, see the config already exists and the unfinished step, and retry without creating another copy.

## The design gate checks comprehension, not only rendering

Before implementation, show comps or a small prototype for running work, a question on the keyboard, a cross-board preview, a completed collapsed turn, and a failed/partially completed turn. Q30 approval covers this extension, not a whole-app rebrand.

Use the existing [design gate](23-design-concept.md#the-design-gate), including both themes at 1440×900 and 390×844. Also check a narrow laptop beside an eight-layer board. Test short and long messages, one and many tool calls, zero results, offline targets and large transfer reports. Walk the five journeys with keyboard-only input and reduced motion.

The new UI passes when BK can tell who spoke, what Keyloom is doing, which keyboard it targets, whether it needs an answer, and whether the result is only prepared, saved or actually on the device. Passing the parser, network and unit tests does not answer those questions.
