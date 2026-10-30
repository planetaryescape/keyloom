# 30: Talk to any keyboard without losing the collection

Status: proposal, 2026-10-18. Source baseline: origin/main at `71934e13f8c0c8b702b6dc1beb57ca25993f7cf3`. D-401 broadens write targeting; D-402 proposes conversation continuity; D-407 distinguishes a registered collection from supported board definitions. No new hardware identity or conversation migration is built by this document.

Reconciled with origin/main at `72370d0494497ae4bdd6036106fcec9d3f6c1aab`; the agent-scope and persistence observations below are unchanged by that design update.

From any registered keyboard BK can ask about that keyboard, read another keyboard's setup, import part of it here, or send something to a named destination. The agent is one keyboard specialist with shared app capabilities. A different keyboard is a different context, not a different agent or an isolated memory silo.

## Registration, configs and USB observations are different facts

Today's code groups layouts and sync by `boardId`, the board definition ID. `boards list` is the supported-definition catalog; `list_layouts` reads stored configs. Neither is by itself an owned-physical-device inventory. [The baseline reading](../research/agent-native-baseline.md) pins these claims to code.

Build a collection read model from registered/configured boards and explicit registrations, their configs, their intended on-keyboard config, and current sync observations. Never add a supported template to "your keyboards" merely because it ships with Keyloom. A registered board with no config still appears and offers a starting workflow; an offline board remains available for reading and preparation (D-407).

| Fact | Identity | Why it is separate |
|---|---|---|
| Board definition | Existing `boardId` | Geometry, firmware, capabilities and recipes shared by a model |
| Registered keyboard | Stable collection reference; initially board-backed | The keyboard BK addresses, including when disconnected |
| Config | Existing layout ID, displayed as config | Several can belong to one board; editing is not activating |
| Revision | Existing revision ID | The exact content read, previewed or sent |
| Connection observation | Time, transport and observed device/marker | Ephemeral evidence, not ownership or a display name |

For the first rollout, a registered keyboard reference resolves to one existing `boardId`; aliases are labels only. Hardware plans continue to include that board ID and its config/revision, and refuse ambiguous physical matches. Q35 explicitly defers independent control of two physical keyboards of the same model. Do not add a new instance ID cosmetically while sync remains board-keyed.

S57 must settle stable matching and migrate config ownership, `board_config`, sync locks, auto-sync proof, device markers and recovery together before independent identical-model writes ship. Registration without a reliable device match is allowed for offline design; it does not authorize a hardware write.

## Every request captures what "this" meant when it was sent

```ts
// Proposed immutable context, stored with the request (D-402).
type RequestContext = {
  id: string;
  conversationId: string;
  focus: {
    boardId: string;
    configId: string;
    revisionId: string;
    layerId: string | null;
    selectedPositions: number[];
  } | null;
  draftRefs: string[];
  explicitSources: { boardId: string; configId: string; revisionId: string }[];
  explicitTargets: { boardId: string; configId: string; revisionId: string }[];
};
```

The application captures focus and selection on submit. The model may request explicit sources and targets, which the server resolves and appends as scoped operation context; it cannot rewrite the original snapshot. Do not send an unlabeled list of positions across boards.

Resolution rules:

1. An explicitly named keyboard/config wins. Resolve exact IDs or a unique registered name/alias; never fuzzy-match a destructive target into existence.
2. "Here", "this keyboard" and "these keys" refer to the request's focus and selection. If nothing is focused, ask with a keyboard picker.
3. A keyboard named without a config means its intended active config for reads, with that choice stated. For a full setup transfer, the default destination is a new inactive config, as in D-384. A request to modify an existing destination uses its explicit config and preview.
4. "My other keyboard" resolves only when there is exactly one other registered keyboard. Otherwise offer the actual collection, not a request for screenshots or an Oryx URL.
5. "Send this" needs an identified source artifact, selection or config. If several fit, show the concrete candidates. It does not mean the last tool's raw output by accident.
6. Expand a target group into exact IDs when preparing the plan. "All my keyboards" in a pending plan does not include a board registered after the preview.

The column header shows the focus for the next request. Each running task and artifact has its own source/target chips. If BK changes the stage during work, say "Still preparing changes for your Glove80" with an action to return there. Never steal the stage back repeatedly as background events arrive.

## Conversations can follow the user while operations stay scoped

Q31 assumes one thread may continue across board switches. Retain the existing conversation ID, messages, provider/model pin and original config reference. Treat that config as the origin for historical indexing, not an execution target. Add context per request/run; do not rewrite old selections or proposals into the newly viewed config.

Keep old layout-anchored conversation listing working. A collection-level conversation index can include all touched boards, derived from stored request contexts. The agent can be opened with no board selected to perform app-level tasks. Old chats retain their original scope and get context synthesized only from their recorded owner and selection, never from the board currently on screen.

[29](29-agent-app-control.md) specifies the `layout | workspace` conversation ownership migration. A new workspace conversation can have no origin, and deleting one source/origin config does not delete unrelated targets or their transcript. Preserve legacy conversation deletion semantics unless BK chooses to migrate an old conversation. Include the delete-one-target case in S55.

Replace the current read-only `CarriedThread` behavior only after S55's pause/switch/restart checks. Unapplied drafts stay attached to their original config; they do not follow the user onto a geometrically different board. The user can explicitly reference or transfer one, with the same mapping and validation as other content.

A pending key question remains about its original target even when another board is on the stage. "Show keyboard to answer" restores the relevant board/layer, while a list alternative can answer without navigation. Submission rechecks the question context. A changed head either leaves the selected identity valid for a read-only answer or makes the dependent plan stale.

## Importing and sending are the same scoped transfer

"Import Navigation from my Moonlander here" and "Send this navigation layer to my Glove80" resolve to the same transfer model. Only which side was initially focused differs.

```text
source config @ revision
        |
   select content: keys / layer / macro / combos / settings / whole config
        |
   deterministic correspondence + destination capability checks
        |
   transfer report + validated destination proposal @ destination head
        |
   review / resolve meaningful gaps / explicit Apply
        |
   destination revision -> existing sync policy -> device outcome

source config stays unchanged
```

Reuse `map_keys`, layer matching, `copy-plan`, `put-plan`, `previewPut` and `putConfig`, not a second model-generated mapping algorithm. `put_config` currently creates a new config with saved proposals outside the conversation; return those same proposal IDs as typed transfer artifacts in this conversation. Do not create duplicates just to make cards appear.

The preparation step records:

- Source board/config/revision and exactly which content was selected.
- Destination board/config and base revision, including whether the destination is a newly created inactive config.
- Key and layer correspondences, their reasons, confidence and unresolved placements.
- Added/reused dependencies: macros, profiles, tap dances, layer references and combos. Preserve target key letters and hand-specific modifiers where the existing mapping rules require it.
- Unsupported content, unavailable functions, replacements and deliberate omissions. Keep passthrough firmware code out of cross-firmware transfers unless the existing deterministic machinery explicitly supports it.
- Validation results and what Apply will do to sync, separately from what preparation already saved.

For settings or content not covered by the current mapper, add a deterministic domain operation with tests or report it unsupported. "Smart adaptation" is not permission to invent a plausible translation. The UI distinguishes an existing-device limitation from a gap in Keyloom's importer or generator.

Default harmless preparation immediately and disclose the choice, following D-384. Low-confidence mappings can be left unchanged and listed for review. Ask only when no safe default produces a useful result or when BK must make a consequential preference. Do not turn a copy into an interview about every layer.

### The reply says what came across, in one card

A copy's reply carries a `transfer` card (D-467). The card names both boards, says how many keys came across and how many of those were nearest-place guesses, and puts two disclosures under that sentence, both of which a keyboard opens: **Carried by layer**, the line-per-layer breakdown, and the drops — every key that did not come across, with the plan's own reason. The drops come first, because whether the copy is usable turns on what is missing, not on how it is spread over the layers. It then says how many combos copied or did not, naming each skipped one with the plan's reason, how many layer keys had nowhere of their own and were placed on free keys, which could not be placed, and, under **Left out**, the things that were never about keys: LED colours, firmware settings, passthrough code. It does not close by pointing at the new config's conversation: the card is in that conversation (and in the parent, after the app has already carried the reader there).

The card is built by the server from the plan the copy already computed — `transferReport` over the `PutPlan` — so it cannot disagree with the proposal it describes and the plan is never run twice. It is stored beside the reply's presentation rather than in a new table, which means an older binary reading a new row loses the card and nothing else. The reply that asked for the copy and the copy's own first reply both carry the same facts, because the app takes the reader to the new config and that is the reply he sees; a later reply in that conversation is about adapting the config and shows no second card. Everything is bounded (40 drops, 12 layers, 12 skipped combos, 8 notes, capped text) and anything a bound leaves out is counted, so the card says "and N more" instead of dropping it quietly. The report describes the plan; no op, proposal, decision or apply step reads it.

The CLI prints the same artifact: `keyloom chat` after the copy's reply, and `keyloom keyboard put` for the plan it just made. The terminal has no navigation, so `chat` adds the one line the card omits — that adapting continues in the new config's own conversation — and `keyboard put`, which makes no conversation, leaves it off. See [10](10-cli.md#the-copy-report).

## Revision checks protect both sides of a transfer

Read source content at a captured revision so a moving source cannot change the plan during mapping. Validate target ops against its current head when saving the proposal, and again on Apply through the existing path. A target edit invalidates the old plan; refresh the preview rather than silently rebasing its keys.

If the source changes after preview, keep the captured source revision visible and say a newer version exists. Do not silently replace the source. If BK asks for "the latest", prepare a new plan and require a new confirmation where effects changed.

Target-specific ports are built per operation. Do not mutate a shared singleton's current `layoutId` between asynchronous tools. Memory queries, warning scopes and proposal storage use the operation's target config; source preferences are provenance, not automatic priorities copied into a different config. A source key selection never becomes a target validator selection without explicit correspondence.

Undo is per saved target change, using existing revisions. It may trigger existing auto-sync if the target is active; say so. Removing a transfer does not delete the source, erase its history or pretend a flashed device can be rolled back atomically.

## Several targets get individual plans and honest outcomes

Q34 assumes prepare-all, then explicitly approve a named ready subset. A transfer group owns a stable list of targets and references one ordinary proposal/plan per target. Each target can be `ready`, `needs_choice`, `blocked`, `applied`, `sending`, `verified`, `offline` or `failed`; those states are summaries of existing proposal and job records, not a parallel sync engine.

```text
Send the selected macro to: Office Moonlander, Travel Glove80

Office Moonlander / Daily   Ready to apply     1 macro; 1 key changes
Travel Glove80 / Travel     Needs a key        Pick where it should go

[Review ready target] [Choose key for Glove80]
```

The example is synthetic. Show counts and names from real plans in the app.

One confirmation may cover an immutable, displayed ready subset, but each target gets its own validation, effect receipt and result. Cross-target apply uses compare-and-swap per config and reports partial results if another edit races the operation. Do not promise a cross-device transaction or roll back a successfully flashed keyboard because another is offline.

Use the existing global sync serialization. Prepare offline targets in Keyloom; do not send stale work automatically when they reconnect unless BK already approved that exact change under its existing sync policy. Reconnecting a device never counts as approval of a previously unconfirmed transfer.

After partial success, "Retry failed targets" references only failures and refreshes stale targets. Already successful config creation, applies and device jobs are reused by idempotency key. Final text might say "Saved on both configs; verified on the Moonlander; the Glove80 is offline". It must not say "Sent to both keyboards".

## Evals exercise intent, targeting and limits together

Extend the existing cross-board evals with scripted model tests first:

| Request or event | Required behavior |
|---|---|
| "Copy my Moonlander's navigation here" on Glove80 | Read stored source, deterministic mapping, Glove80 preview, no source write |
| "Send these combos to my MacBook" from Moonlander | Target-specific validation, dependencies, remapper limits and Escape/Control safeguards |
| "Make every keyboard use these colors" with a board lacking support | Supported destinations get previews; unsupported destination has an explicit reason |
| "My other keyboard" with three registered boards | Concrete keyboard picker; no guessed source |
| Board switch while a tool runs | Original target remains; the next request uses the new focus |
| Reload with a pending key question | Same question and scope; no model process waiting |
| Target head changes after preview | Stale confirmation refused; new preview required |
| Source head changes after preview | Captured version remains visible; no silent source substitution |
| Duplicate board models with ambiguous USB matching | Offline design may proceed; device writes refuse ambiguity |
| One batch target succeeds and another fails | Exact per-target results; retry does not repeat the success |
| New supported board definition with no registration | Does not appear as BK's owned keyboard |
| Registered but disconnected keyboard | Remains readable; prepare works; hardware outcome says offline |

After deterministic checks, run explicitly authorized live-provider evals through the existing eval setup and resource queue. Keep raw recordings and credentials out of prompts. Hardware checks remain opt-in per session, using scratch data and fake adapters by default. The delivery rungs are in [13](13-roadmap.md).
