# 03: Agent

Revision, 2026-10-29: D-452 replaced D-020's alternatives. `propose_changes` takes one proposal and `supersedes`, and `ask_user` takes considerations and a step; the tool table and the loop below say how.

Extension, 2026-10-18: [28](28-agent-experience.md), [29](29-agent-app-control.md) and [30](30-agent-keyboard-context.md) broaden the agent into an app-wide keyboard specialist and specify its presentation/runtime. Rung 26a implements observed work, public-message grouping and bounded saved presentation; [compiled acceptance](../screenshots/agent-experience/integrated/README.md) records what was checked. Durable execution and broader app/collection control remain proposals. D-401 proposes replacing the one-conversation-layout write limit; D-403 preserves validated proposals and user approval. The historical provider and post-Apply wording below must not override the current provider chapter or actual auto-sync state.

The agent turns BK's frustrations and goals into proposals (D-004, D-005, D-010). It reads the layout, the board, BK's stated priorities and the remembered decisions. It asks what it needs to know, and it proposes one to three structured change sets (D-020). It never applies a change and never writes firmware source (D-014). Applying is BK's action, in the editor or with `keyloom change apply`.

## Model and SDK

- **Provider:** Anthropic, through `@anthropic-ai/sdk` (D-031). The SDK's Tool Runner (`client.beta.messages.toolRunner` with `betaZodTool`) drives the tool loop. keyloom's zod schemas are already the source of truth for change sets, so the tools reuse them directly.
- **Model:** `claude-opus-5-5`, with adaptive thinking and `output_config.effort` set explicitly, because Opus 5.5's default effort is `medium` (claude-api skill, cached 2026-10-06). Start at `medium`. Raise it only if the evals in [11](11-observability-and-evals.md) show proposals improving. The model ID is a config value, `agent.model`.
- **Tool choice:** `auto`, with `strict: true` on the tools whose input is small. `analyse_change` and `propose_changes` are not strict: the ChangeOp union makes a grammar the API rejects as too large (400, checked live 2026-10-15), so zod validates their input instead. Opus 5.5 rejects forced `tool_choice` (`any` or `tool`) with a 400, so the system prompt names the tool to use instead.
- **Streaming:** responses stream to the chat panel. Tools set `eager_input_streaming: true`. Each tool input is validated with its zod schema before it runs, because streamed inputs aren't validated by the API.
- **Refusal fallback:** requests include the server-side fallback beta (`server-side-fallback-2026-07-01`, `fallbacks: "default"`) and check `stop_reason` for `refusal` before reading content. Keyboard layouts are unlikely to trigger a classifier. The fallback costs nothing when unused.
- **Credentials:** BK's own key, read by the SDK's normal resolution order (`ANTHROPIC_API_KEY`, or an `ant auth login` profile). keyloom never stores a key in its database. Other users bring their own key (Q3).

## What the agent sees

The prompt is assembled in this order. The stable parts come first so prompt caching holds across a conversation:

1. **System prompt** (`src/agent/prompts/system.md`): its role, D-014's rule that it proposes and never applies, the principles from [00](00-overview.md), and how to use the tools. It must ask before guessing a priority (D-021). It must offer two or three alternatives when a change displaces something (D-020). It must treat comfort claims as hypotheses (D-018).
2. **Board context:** the board definition summary (key count, hands, rows, thumb cluster, finger assignment per position) and the board's `SKILL.md`, if it has one ([04](04-boards-and-contributions.md)).
3. **Firmware capabilities:** what this firmware can and can't express, from [05](05-firmware-qmk.md) or [06](06-firmware-zmk.md), as a short generated list.
4. **The active decisions and priorities** for this layout, all of them ([08](08-decision-memory.md)). They are short and few, so there's no retrieval step.
5. **The conversation**, with each user message carrying the selection made when it was sent (D-012), rendered as `Selected on Layer 0 (layer id layer-0): S hold ⌥ (left ring, home row) at position 30; D (left middle, home row) at position 31` (D-063, D-279). The agent names keys to BK by what they print and where they sit under the hand, never by number; positions are for ops only. The board context also lists the board's mirror pairs.

The layout itself is fetched through tools, so the prompt doesn't go stale after an edit within the conversation.

## Tools

Each tool is a `betaZodTool` in `src/agent/tools/`, one file per tool.

| Tool | Input | Returns | Why it exists |
|---|---|---|---|
| `list_layouts` | `{}` | Every layout: id, name, board, firmware, layers, and what its board can and cannot do ([20](20-cross-board.md)) | So the agent looks at BK's other keyboards before asking him for them (D-220) |
| `get_layout` | `{ layout?: string, layers?: string[] }` | The head revision as one text grid per layer (labels placed by the board's physical rows, with a legend), plus the IR JSON for the requested layers | The grid is how the model reasons about position. The JSON is what it edits against |
| `find_function` | `{ function: string }` | Every position and layer producing that function, and how each layer is reached | Answers "where is Option now?" deterministically, not by reading grids |
| `analyse_change` | `{ ops: ChangeOp[] }` | The validator's result for those ops against head ([07](07-change-validation.md)), without saving anything | Lets the agent check an idea before proposing it |
| `propose_changes` | `{ title, ops, explanation, tradeoffs, decisionDraft, supersedes?: id \| null }`: one proposal (a one-element `{ alternatives }` from before D-452 is still read) | Its change set ID and validation result, and which proposal it superseded | The only way a proposal reaches BK. An invalid one comes back with errors so the agent can fix it, and the proposal it was revising stays current. `supersedes` is required while another proposal of the agent's is open in the conversation: an id replaces it, `null` stands beside it (D-452) |
| `mirror_keys` | `{ positions: number[], layer: string }` | For each position, the key at its mirror position, the binding this position should hold to match it (its own letter, the right hand's modifiers, a mirrored ZMK profile where the original lists the other hand's keys), and ops covering exactly the keys that change, validated | "The same as the other hand, mirrored" without the model counting positions or guessing hands (D-060) |
| `put_config` | `{ from, board, name?, layers?, placements? }` | A new config on the other board, its proposals (the mapping, and with the layer keys placed), what was not carried and why, and the keys that could take each unplaced layer key | "Put my Glove80 setup on my Corne" (D-372). Applies nothing; the proposals wait in the new config, outside this conversation |
| `ask_user` | `{ question, considerations (1 to 3 short lines), step: { n, of } (of at most 5), options (2 to 3 for the default single_choice kind, more for the pickers: label, description?, recommended?), allowOther?, kind and the picker fields }` | Nothing: the turn stops, and BK's answer comes back later as this call's result (D-382) | A question that refines the proposal already on the board, when the choice is really BK's and nothing he said answers it (D-380, D-452). The recommended option is drawn first. A call that carries no considerations or step is refused, so the model repeats it; a question stored before D-452 still loads |
| `create_config` | `{ name, from: this \| blank }` | A new config on this board, not on the keyboard | "Make me a Colemak config" (D-384) |
| `map_keys` | `{ from, fromLayer?, toLayer?, strategy?, positions?, carry?, comboIds?, minConfidence? }` | Which key of another layout is the same key here, with a reason and confidence, the keys with no counterpart, and with `carry` checked ops that copy colours, behaviours or combos | Matching keys across boards that differ in size and shape, which a model gets plausibly wrong (D-221) |
| `get_typing_findings` | `{}` | Aggregated findings from BK's recorded typing sessions on this layout: misfire, typo, missed and double counts, per-finger numbers, the findings in plain words, and the setting changes already tried on his recording with before and after counts and key-name examples. Never the passage, the typed text or the trace | So "my home row mods misfire" in chat is answered with evidence from his hands, not a guessed number (D-280, D-286) |
| `record_priority` | `{ subject, priorityKind, statement, reason? }` | The new priority's ID | Captures "keep Backspace where it is" or "I barely use Caps Lock" as a decision of kind `priority` (D-021). It shows in the chat as a chip BK can remove |
| `update_decision_outcome` | `{ decisionId, status: "tried_helpful" \| "tried_unhelpful", note }` | A line confirming it | Records "that fixed it" or "that feels slow" against an earlier decision, in BK's words (D-018). It refuses a priority and a decision that no longer applies (D-055) |

```ts
type Proposal = {
  title: string;                       // "Plain Option on the symbol layer"
  ops: ChangeOp[];
  explanation: string;                 // why this solves what BK described
  tradeoffs: { gains: string[]; costs: string[] };
  decisionDraft: DecisionDraft;        // 08
};

type Slot = { layerId: string; position: number };

type ChangeOp =
  | { op: "setBinding"; at: Slot; binding: Binding }
  | { op: "moveBinding"; from: Slot; to: Slot }        // what was at `to` is displaced
  | { op: "swapBindings"; a: Slot; b: Slot }
  | { op: "addLayer"; layer: { id: string; name: string }; afterLayerId: string } // filled with transparent
  | { op: "removeLayer"; layerId: string }
  | { op: "renameLayer"; layerId: string; name: string }
  | { op: "duplicateLayer"; layerId: string; layer: { id: string; name: string } } // copy goes last (D-181)
  | { op: "moveLayer"; layerId: string; afterLayerId: string }                    // never the base layer, nothing before it
  | { op: "setLayerStyle"; layerId: string; shortLabel: string | null; color: number | null }
  | { op: "upsertMacro"; macro: Macro }
  | { op: "removeMacro"; macroId: string }
  | { op: "upsertCombo"; combo: Combo }
  | { op: "removeCombo"; comboId: string }
  | { op: "upsertHoldTapProfile"; profile: HoldTapProfile }
  | { op: "setFirmwareSetting"; setting: FirmwareSetting }
  | { op: "dropFunction"; function: string; reason: string };  // the only way to lose a function (07)
```

Ops apply in order to a copy of the head document. `src/layout/apply-ops.ts` is a pure function, `(Layout, ChangeOp[]) => Layout | OpError`, shared by the editor, the agent, the CLI and the validator.

### "Do that here too" is expanded into plain ops

BK's bulk request (D-011, D-012), such as "give these five keys the same hold behaviour as F", becomes one `setBinding` per position in the proposal. The agent expands it, or the editor's "repeat on selection" command does (D-061). For a mirror request the agent calls `mirror_keys` and builds the proposal from the ops it returns. A proposal made from a selection that edits keys outside it is warned about with `outside_selection` (D-062). A pattern op type would be one more thing to validate and render. Expanded ops cost nothing extra, and the preview shows exactly what changes.

## The loop for one message

1. BK sends a message, with a selection if he made one. It's stored in `messages`.
2. keyloom calls the model with the assembled prompt and the tools, and streams the reply.
3. The model reads, records priorities, and calls `propose_changes` with its one best proposal. Then, if a choice would really change it, it asks one question with `ask_user`, in a reply of its own after it has read the proposal's result (the turn ends there and resumes when BK answers: D-380 to D-382, D-452). If it batches the two in one reply, the proposal is run first and a second question is not.
4. The proposal is applied to a copy of head and validated. A valid one is saved as a `change_sets` row with `status = 'proposed'`. An invalid one goes back to the model as an error `tool_result` listing the validation errors, and the model may retry. After three failed attempts in one turn, the agent tells BK what it couldn't make valid instead of retrying further.
5. The editor shows the proposal and pins it on the board: highlighted positions, the function it drops and why, reminders from earlier decisions ([08](08-decision-memory.md)), and the explanation and trade-offs.
6. BK answers the question, applies the proposal, or says what he'd prefer ("I'd rather have a combo"). Every answer makes the agent call `propose_changes` again with `supersedes` set to the proposal it replaces (the same ops when the answer only confirms it), which sets that one aside as `superseded` in the same transaction and puts the new one on the board; an invalid revision is refused and the old one stays current. The reason in the revision's decision draft carries his answers, and applying writes that one decision (D-022). At most three questions, one at a time. Applying the proposal while a question is open (the proposal it refines is the one saved earlier in its own turn, recorded with the pause; a question asked before proposing refines none) stores a result for the question, so it reads Skipped after a reload and a later message.

## Option–Option, worked through

BK's first real problem (D-019, D-025): Option sits on S as a home row mod, there's no plain Option key, and some apps want Option–Option.

- `find_function("mod:LALT")` returns only the hold half of S on the base layer.
- The agent asks what it needs. Which layer does BK reach most easily with his left hand free? Which app needs Option–Option?
- It proposes up to three of the remedies from D-019:
  1. On a layer BK already holds with the other hand, make S a plain `modifier` LALT. Then holding that layer and tapping S twice sends Option–Option.
  2. Add a macro `opt-opt` (tap LALT, wait, tap LALT) on a free position or a combo.
  3. Change the shortcut in the app. This has no ops, so it's an explanation only.
- It never proposes a double-tap behaviour on S. Doubled letters ("class") would break, and the validator warns on it ([07](07-change-validation.md)).

## Make room, worked through

BK's second problem (D-020, D-025): he wants one key for Command–Shift, and every position is used.

- The agent puts its best placement on the board first, from his priorities and the layout, then asks which shortcuts he uses it for, so it knows which hand needs to stay free, and checks priorities and decisions for keys that must not move. Each answer revises the proposal (D-452).
- The proposal places `{ kind: "modifier", mods: ["LGUI", "LSFT"] }`. It moves whatever it displaces to a reachable slot or drops it with a `dropFunction` op and a reason. It also lists what gets less convenient.
- The preview shows the relearn cost: how many functions moved and which ones.
