# 27: Board review

Status: engine built (checks, agent part, triggers, routes, events and CLI), 2026-10-17; screens built (D-340); the fix run built 2026-10-30 (D-461). Explicit activity profiles, baseline measurement and independently tested review suggestions are built in source (D-473), 2026-11-01. [Source/runtime evidence](../research/workload-board-review.md) includes real QMK/ZMK comparisons, a compiled CLI journey and UI checks. This does not establish published availability or hardware acceptance.

BK: "when I connect a keyboard, the ai immediately analyses that board and stores a state of the board with all the warnings and hints and suggestions … and I can just see them somewhere without me needing to ask for them or dig into some menus … it would be nice if it's proactive."

## What it is

A board review is what keyloom found in one revision of a config. It is made without being asked, stored, and read from `GET /api/layouts/:ref/review`. There is one per revision (`board_reviews`, unique on config and revision), so a revision is never reviewed twice.

The checks fill in at once and need nothing. The agent's part arrives after, on whichever model provider is set up, and the page hears about it on the events stream. If there is no provider, or the run fails, the review says so in words and the checks still show.

## The review and its items

```ts
type BoardReview = {
  id; layoutId; revisionId;
  trigger: "connect" | "apply" | "import" | "manual";
  checkedAt;
  checks: { status: "done"; summary: { layers; keys; combos } };
  ai: { status: "pending" | "running" | "done" | "unavailable" | "failed"; reason: string | null; model: string | null };
  items: ReviewItem[];   // hidden ones included, with dismissedAt
  fixed: FixedItem[];    // the previous review's items this revision no longer produces
};
type ReviewItem = {
  id; source: "check" | "agent"; kind: "problem" | "hint" | "suggestion";
  severity: "error" | "warning" | "info"; code; title; body;
  keys: { layerId; position }[]; layers: string[];
  proposalId: string | null;   // a suggestion's change set
  fixes: string[];             // ids of the problems or hints a suggestion fixes
  dismissedAt: number | null;
};
```

- `id` is `${source}:${code}:${layerIds}:${slots}`, derived from what the finding is about and never from its words. A finding about different keys is a different finding, so hiding "9 keys do nothing" does not hide "8 keys do nothing". A very long list of keys is shortened to a count and a hash.
- `title` and `body` carry markers for the screen to draw: `{key:<layerId>:<position>}` as a cap and `{layer:<layerId>}` as a chip. The agent's markers are checked against the layout, and one that names a layer or key that is not there is written as plain words.
- Problems are `error` (the layout can't be built or saved as it is) or `warning`. Hints and suggestions are `info`.
- `source` is `agent` where the comps said `ai`, so the word matches the code (`source: "agent"`, D-343).

## The checks

`reviewChecks` (`src/validation/review-checks.ts`, pure) turns `standingIssues` into items: every rule the validator applies to a change, read against the layout alone. `layer_unreachable` and `layer_trap` mark the layer. The advice-shaped findings (`homerow_same_hand_mods`, `doubled_letter_tapdance`, `tap_dance_same_action`) are hints, and the rest are problems. The one check the validator had no rule for is `keys_do_nothing`: keys that are empty or transparent on the base layer, as one hint.

## The agent's part

One run per revision, with the conversation's own tools (`get_layout`, `find_function`, `analyse_change`, `get_typing_findings`, `propose_changes`) and no tool that needs BK, plus `submit_review`, which is how it hands the structure back.

- A suggestion is a real change set saved by `propose_changes` outside any conversation, validated against the head (D-014). It shows in the config's open proposals (D-336). A suggestion whose `proposalId` the run didn't save is dropped. Nothing is ever applied.
- The budget is 10 requests and 14 tool calls. A model past its tool calls is told to submit. The run takes the review first (`claimAi`), so the server and `keyloom review --run` never both pay for one.
- A run that stops at its limit after saving a fix is `done`, with that fix attached and a reason saying so; with nothing usable saved it is `failed`.
- A run that finds the layout has moved on fails with that reason and withdraws its proposals; the new revision gets its own review.
- No provider is `unavailable`, not a failure. A refused, cut-off or erroring run is `failed` with the provider's own words. A later `POST …/review/run` retries either; `force: true` runs a finished one again.

## Triggers

The review engine (`src/app/review-engine.ts`) is level-triggered, like the sync engine. Every second it looks for a head with no review that should have one:

- **connect:** the config on a board's keyboard, when the sync engine's last view shows that keyboard connected;
- **apply** and **import:** a head made since the server started, once the quiet time (3 s, as the sync engine's) has passed with no further change, so a burst of Applies is one review of the last of them.

A config nothing touched while its keyboard was away has no review until `POST …/review/run` or `keyloom review --run`.

## Test suggestions against your activities

```sh
keyloom review my-layout --run --activities prose,shortcuts
keyloom review my-layout --json
keyloom review my-layout --run --activities none
```

Choose activities before dropping a layout on the import screen, while copying a config to a new board, or under **Activity tests** in its review. The CLI also accepts `import --activities prose,shortcuts` and `keyboard put … --activities prose,shortcuts`. Supported IDs are `prose`, `typescript`, `python`, `json`, `shell` and `shortcuts`; selection is explicit and starts empty. Choosing activities permits the selected tests to run on later automatic reviews of this config. Disable them with **Turn off tests** or `--activities none`. You cannot change the profile in the middle of an active review.

Tests need Docker and can download pinned firmware sources and images. They run before the model, so baseline results still arrive when no provider is configured. Suggestions still need a provider. Neither path applies a change or accesses the keyboard. Windows and Kanata retain the review's ordinary checks while workload replay reports unavailable.

A new-board copy starts as an empty config with its mapping waiting for Apply. Automatic activity review waits for that mapping to be applied instead of reviewing the temporary blank. An explicitly requested manual review can still test the current head before Apply.

The model sees aggregated costs and physical-key use, never sample text or traces. It can propose at most two visible changes for independent testing. The app reuses one in-memory baseline, validates each actual saved patch and refuses pin changes before candidate replay. Results are stored under the review's optional `workload` field:

- `activities`, `status`, `reason` and `identity` describe the selected tests and their snapshot/evaluator inputs.
- `baseline` contains each task's status, requested output count, verified physical keydowns, peak simultaneous keys, layer/modifier entries and bounded physical-key-use counts. Unknown costs are null, not zero.
- `comparisons` ties a proposal ID and patch hash to its candidate task results, deltas and verdict. `verified-improvement` needs complete verified evidence for every selected task, an improvement in keydowns or peak simultaneous keys, and no worsening in either. Other outcomes are `equivalent`, `regression`, `tradeoff`, `inconclusive` and `not-tested`.

Open **Baseline results** or a suggestion's **Test results · current → suggested** to see the numbers and coverage gaps. A missing route only means the bounded planner did not find one in its supported subset. An unverified baseline blocks an improvement claim even when the candidate gains a verified route. The eight-minute review deadline can leave tests incomplete; reduce the selected activities and rerun rather than treating incomplete evidence as success.

These short US-ANSI transcription and HID samples do not measure editor behavior, typing speed or comfort. A measured suggestion is still a preview. Apply revalidates against the current head; an old review's evidence never approves a later change.

## Fixed, hidden and replaced

- A review of a revision lists, in `fixed`, the previous review's problems and hints that the new revision no longer produces, each with `fixedSince: <previous review id>`. A finding still about some of its keys has changed, not gone. A finding BK had hidden is not ticked off. The agent's findings count only when the agent finished in both reviews.
- Hiding is `review_dismissals`, keyed by config and item id. It follows the finding to later revisions and is lifted by restore.
- A new review rejects the change sets the previous review's suggestions left open, so the open-proposals list does not fill up with proposals for revisions that are gone.

## Fixing what it found

**Fix issues** in the panel's footer starts one agent run on this config and opens the chat beside the board; `keyloom review fix [layout]` does the same from the terminal (D-030). Both send the same fixed request (`REVIEW_FIX_REQUEST`, `src/api/review.ts`) in a new conversation. The findings are not copied into the message: the run reads them with the read-only `get_review` tool, so the two surfaces cannot format them differently and they cannot drift from the stored review.

- The offer is for the visible problems and hints. A suggestion is already a checked proposal, so it neither adds the offer nor takes it away. There is no button when the review found nothing of those, and it is disabled with its reason while the review is of an older revision, its own look is still being written (`ai.status` `pending` or `running`), another review action is busy, or no model is ready.
- `get_review` returns the non-hidden items with their plain words (the markers written as key and layer names, as `reviewWords` writes them), the keys by position, and a suggestion's `proposalId` and validated `ops` while its change set is still `proposed`; one that was applied, superseded or rejected is named with that status and no ops. Hidden findings are counted and left out, because hiding is BK's decision (D-340).
- The prompt asks for one change covering the findings that need changing, because applying a proposal moves the head under the next. Where two findings cannot both be fixed, the agent asks one question that refines the proposal (D-452).
- A review of an earlier revision is a pointer: the tool says `current: false` with both revision ids, and the agent uses the findings while the validator decides against the current head (D-458). Nothing is applied without BK.
- The run's proposal, questions and Apply are the chat's ordinary cards; the panel has no proposal of its own, and it closes when the chat opens.

## API, events and CLI

- `GET /api/layouts/:ref/review` gives `{ layoutId, headRevisionId, review }`, the newest review of the config. The review is stale while its `revisionId` is not `headRevisionId`.
- `POST /api/layouts/:ref/review/run` (202) stores the head's checks and answers with them; measurement and the agent's part continue. Body `{ force?: boolean, activities?: ("prose"|"typescript"|"python"|"json"|"shell"|"shortcuts")[] }`. Supplying activities remembers the profile and reruns the same revision; `[]` disables tests. Unknown/duplicate IDs fail schema validation before writes. The response's optional `workloadActivities` names the current profile, while `review.workload.activities` names the profile that produced that evidence.
- `POST /api/layouts/:ref/review/items/:id/dismiss` and `…/restore` (`:id` URL-encoded). 404 for an id the latest review doesn't have.
- `GET /api/events` carries `event: review` frames (`{ type: "review", layoutId, revisionId, reviewId, aiStatus }`) when a review is made and each time its agent part moves. The frame holds no review; the page reads it again.
- `keyloom review [layout] [--run] [--force] [--json]` prints the review in plain words, or the JSON with `schema_version`. `--run` makes the head's review now and waits for the agent.

## The screens

Built in `src/web/review/`: `useReview` reads `GET …/review` on open, on every new head and on each `event: review` frame for the config; `ReviewMarker` sits in the caption; `ReviewPanel` is the side column (a sheet on a phone). The caps and the strip are marked from `keys` and `layers` of the items that show. D-340 has the states.

## What the screens need

The marker by the config name, the cap and tab marks, the panel, the "looking over your change" state and the tick are the designer's half. They read `GET …/review`, listen for `event: review`, and mark keys from `keys` and tabs from `layers`. The web events parser takes an `onReview` callback and ignores review frames when it has none.
