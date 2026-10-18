# Rung 26a component evidence

Production chat components rendered by `test/web/agent-ui/serve.ts`, with explicitly synthetic component props and the shipped Moonlander renderer. This is not evidence of an integrated backend stream, durable execution or reconnect behavior. The approved prototype under `../comps/` is unchanged.

Run `bun test/web/agent-ui/serve.ts` and open `http://127.0.0.1:4501`. No API, persisted data directory, model provider or device adapter is attached. The state controls are fixture controls, not production UI.

Final integration must repeat screenshots and stream checks against the exact combined candidate.

## Handoff status

The approved composition is implemented as production components, with the explicit phone Stop condition. **The observed-activity path is not connected to a server contract.** Existing chat still works and displays a truthful unavailable-history fallback instead of inventing completed operations from old tool-name hints. Closing a stream may still abort it; there is no durable-run or safe-retry promise.

### Public component input (not a wire schema)

- `AgentWorking({ view: AgentWorkView, motionPaused?: boolean })` in `src/web/chat/AgentWorking.tsx`.
- `AgentWorkView` in `work-view.ts`: either `{ kind: "unavailable", status }`, or `{ kind: "observed", status, label, notes, operations }`. Status is `running | waiting | completed | failed | stopped | disconnected`. `label` is a short public phase or null, not private thinking. Notes are `{ id, text }`.
- `AgentOperationView`: `{ id, label, target, status, durationMs, summary }`. Target, duration and summary are nullable. Operation status is `running | succeeded | failed | cancelled | unknown`. IDs and outcomes must come from correlated backend observations. Duration is an observed value; the component has no progress timer.
- `AssistantMessage` accepts optional `working?: AgentWorkView` and `motionPaused?: boolean`; all existing props/callbacks remain. The adapter must supply the terminal public answer as `turn.text` and explicitly classified public working notes in `working.notes`. There is no prose heuristic or provider-history parser here.
- `UserMessage` accepts optional `context?: string`. `ChatPanel` accepts optional `configName?: string`; the parent should pass the shell's human-facing config name. Old callers fall back to `layoutRef`.
- `AgentMotionToggle({ paused, onChange })` affects animation only. `ChatStopButton({ onStop, quiet? })` is reused in the composer and while the conversation's History/Decisions view is open.

### Parent integration changes

1. Connect the finalized, validated observation projection to the `working` prop at the `AssistantMessage` call in `ChatPanel`. Keep turn IDs stable; a new turn gets a new key, not each event. Do not edit the wire protocol to fit these component types without reconciling the backend packet.
2. Feed only allowlisted public summaries. Strings are clipped for display, not scrubbed for secrets. Parent correlation must enforce unique operation IDs. Raw input/output JSON, credentials and provider thinking do not belong here.
3. Preserve proposals, priorities and unanswered questions in their existing fields. They remain siblings of routine working. Failure/unknown/cancelled rows are outside the routine disclosure. A terminal reply does not convert an unfinished operation to success.
4. Connect actual public-phase announcements deliberately: the current legacy log's `aria-busy={streaming}` can defer nested live announcements. The component fixture does not test that wire/log combination. Keep token streaming quiet without silencing meaningful observed phase changes.
5. Pass `configName` from the shell. Future immutable request/target context is not synthesized from a newly focused board here.
6. Stop is verified in the visible phone chat at full/peek sizes and lives outside the scrolling log. The shell must also verify reachability when another side pane replaces chat; this worker did not change `Viewer` or `SidePanel` ownership.

Routine history is bounded to 100 displayed operations and 20 notes, with bounded labels/targets/summaries. Truncation is explicit and prevents automatic success folding. These are presentation limits, not a storage contract. Reconcile them with S54's final bounds rather than silently discarding meaningful failures.

## Checks

- `bun test test/web/agent-work.test.ts test/web/agent-turn.test.ts test/web/chat-failure.test.ts test/web/question-card.test.ts test/web/chat-preview.test.ts test/web/chat-compare.test.ts test/web/no-ai-patterns.test.ts test/web/spacing.test.ts test/web/contrast.test.ts`: **81 pass, 0 fail, 205 assertions**.
- `agent-work run -- bun run typecheck`: passed on the final source (task 9188). The earlier final attempt caught fixture-only undefined-layer narrowing; it was fixed with a checked non-null fixture boundary, not a cast or compiler relaxation.
- `agent-work run -- bun run depcruise`: exit 0, 628 modules / 2608 dependencies, no rule violations. The existing tool warns that TypeScript 7's compiler API is unsupported and some dependencies may be missed.
- `git diff --check`: passed. `anti-slop-check --base origin/main`: no changed-line findings; four untouched-line findings stayed out of scope.
- Inline TypeScript/simplifier pass: retained the existing proposal/question/provider callbacks; extracted the shared Stop control; removed unnecessary disclosure refs/effects; used `satisfies` for the finite status dictionary; no new unsafe assertions, widened JSON inputs, dependencies or wire contracts. A whole-file lint invocation initially included unrelated old findings; the diff-scoped command above is the relevant result.
- React Doctor changed scope: 5 tracked files, 81/100, no reported diagnostics. A separate explicit scan of new `AgentWorking.tsx` and `work-view.ts` also found no issues. The full scan reported 230 mostly pre-existing repository diagnostics; this is not a clean whole-repo health claim. No dependencies/configuration were installed into the repository.
- Mechanical design detector: one warning for the explicitly approved active-label shimmer. No stripe/sparkle substitutes were added.
- Mounted React checks in `browser-checks.json`: focus preservation through completion and blur; user-open persistence; closed-summary focus; question focus; success folding; visible failure/question/proposal siblings; pause behavior; Stop callback; 44px Stop visible without scrolling in phone peek; no 390px horizontal overflow. All passed.
- `reduced-motion.json`: actual reduced-motion emulation yields no animation and readable solid text. This caught and fixed an active-selector specificity bug that the static comp could not prove.
- `a11y.json`: zero violations; one incomplete contrast rule covers inherited room gradients and short key legends (33 nodes). No production accessibility certification is claimed. The existing contrast tests passed.
- `preview-validation.json`: the component fixture's preview passes the real validator and Apply is enabled; existing timing-profile warnings remain visible. The fixture explicitly acknowledges the modifier functions it replaces. Actual Apply in this fixture deliberately refuses with a synthetic-only explanation.
- `legacy-app.json` / `legacy-completed.json`: the safe `scripts/dev-editor.ts` app showed a visible phone Stop while streaming, no invented operation rows, unavailable-history fallback, and a pending proposal outside working with Apply enabled. The stream finished before a subsequent Stop click; this does not prove backend cancellation behavior.

## Screenshot evidence

Each of `running`, `waiting`, `completed`, `failed`, `stopped`, `disconnected` has `1440x900-light`, `1440x900-dark`, `390x844-light`, `390x844-dark` captures. There are also two `stop-peek-390x844` captures and one `legacy-app-390x844-light` capture. The contact sheets are `desktop-states.png` and `phone-states.png`, ordered by moment with alternating light/dark.

Final component captures use reduced-motion emulation for stable images. Motion itself is checked through computed browser styles and the pause/reduced-motion assertions. All final captures were opened, individually or in contact sheets. Inspection was bounded; correction work addressed validation truth and reduced-motion behavior, not a new design direction.

PNG dimensions were independently checked against all 27 viewport-named capture filenames; none differed. The extra served-app tab was explicitly reset to 390×844/light before its final capture rather than assuming tabs inherit emulation settings.

The 34 files covered by the approved comp's existing `SHA256SUMS` were checked and remain byte-for-byte unchanged.

## Still required on the combined candidate

Real backend lifecycle/message boundaries, provider failure/validator rejection, stream disconnect/Stop with already prepared effects, old conversation replay, long loops and scroll anchoring at actual event rates, meaningful screen-reader announcements, other side-pane Stop reachability, installed CLI/binary agreement, the final full suite and served-app screenshot matrix. Durable execution, idempotent recovery and reconnect survival belong to 26b and are not claimed by this UI.

The stage is not done until the integration owner connects and reviews the exact candidate, releases it through the established channel, and runs the installed smoke checks. No commit, push, PR, merge, deployment, paid model, real-data server, recording, credential access or hardware operation was performed here.
