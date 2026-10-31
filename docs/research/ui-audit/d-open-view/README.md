# D: acknowledged view opens

Candidate implementation on base `a82b9f9955f70b32de0d6aeeaa953d3d5c5c4953` (v0.65.0). Runtime: macOS arm64, Bun 1.3.14, React 19.3.0, TypeScript 7.0.2, Zod 4. The candidate report records the final commit and frozen-tree checks. This is not browser or hardware acceptance.

## Run the synthetic app for Computer Use

```sh
bun test/web/open-view-server.ts 4526 <new-task-owned-scratch-directory>
```

Open the printed localhost URL. The fixture serves the real Viewer, ChatPanel, useChat, durable app coordinator, `open_view` tool and acknowledgement route. Its two configs come from the published Oryx test fixture. The deterministic in-process model calls a view tool and writes its actual result; it never calls a provider. The fixture starts no sync engine or device transport. Recording and domain mutation endpoints are refused. Do not substitute a real data directory or `keyloom serve`.

Send `Open History`, `Open the typing lab`, `Show my Decisions` and `Open settings`. Reopen chat to inspect the saved result. History must be layout versions, not Conversations. Lab must show its existing start screen with recording disabled. Settings must open without saving anything. Decisions must show the existing subview. The existing Stop button must remain reachable while a view replaces chat. Send `delay Open History` to leave 1.5 seconds for Stop, New, editing or a config switch before the tool is called.

Computer Use journeys and captures at 1440×900 and 390×844, both themes, are **pending**. The user explicitly chose Computer Use. This child has no Computer Use or `node_repl` tool; MCP discovery returned no resources. The skill is available and was read. No agent-browser, CDP, Playwright, osascript or alternative UI automation was used. HTTP 200 for the fixture page proves asset compilation/serving only, not UI behavior.

Pending browser checks: all four destinations and render-before-ack ordering; repeated open; historical/reload/foreign-tab and duplicate snapshots; Stop, New, config switch/unmount; dirty key/combo/composer, recording and user navigation; delayed or obsolete observer replies; keyboard-only Stop/recovery; both themes and viewport sizes. The real app fixture is ready for that gate, not evidence it passed.

## Verified non-browser scope

`test/app/open-view.test.ts` exercises publication-before-wait, exclusive results, each destination, wrong owner/run/config/intent, strict input, exact and contradictory duplicates, timeout, Stop, concurrent tools, eight-receipt limit, restart inertness, unavailable legacy/old clients, simulated old-server negotiation, authenticated ack routing, and presentation count/byte contracts. Timeout tests inject 1–5 ms deadlines rather than long sleeps. The initial waiter regressions failed before implementation because the module did not exist.

`test/cli/open-view.test.ts` drives both command families through the real SDK tool loop. The scripted provider asserts that `unavailable/unsupported` reaches its next request before answering; ordinary inspection retains a declined operation and no pending intent.

`test/web/open-view-ack.test.ts` checks that a stalled acknowledgement fetch is aborted with its initiating intent. The same deadline/cancellation signal bounds both rendering and the acknowledgement transport; a lost acknowledgement is never retried as a new action.

For a task-local installed production candidate:

```sh
agent-work run -- bun build --compile src/cli/compiled.ts --outfile <task-owned-bin>/keyloom
bun test/cli/open-view-installed.ts <task-owned-bin>/keyloom <new-task-owned-scratch-directory>
```

The latter script uses the unmodified production entry point, a loopback-only scripted Anthropic SSE endpoint and a synthetic key. It runs `chat`, `agent start`, conversation inspection and run inspection. It does not replace the user's installed binary. No paid model, real credential, keyboard, kanata or user data is involved. This source compile does not package or verify a native helper, which these commands do not use.

## Lifecycle exits

| Pending exit | Result and cleanup |
|---|---|
| Matching rendered acknowledgement | Save `opened` or `already-open`; clear timer/abort listener; unblock model |
| Matching refusal acknowledgement | Save `unavailable` with bounded reason; same cleanup |
| Five-second deadline | Save `unavailable/timeout`; late success is refused |
| Stop, process drain or waiter disposal | Save `unavailable/cancelled`; no late upgrade |
| Publication fails | Reject the tool; clear timer/listener and release in-flight slot |
| Process death/restart | Reconcile saved pending intent to unavailable/cancelled; no waiter or execution is recreated |
| Client loses observation, foreground or initiating screen | Revoke local send permission; acknowledge unavailable if observed, otherwise server deadline settles it |
| Dirty activity or user navigation | Refuse with draft/recording/moved; preserve existing edits and recording |
| Concurrent call or ninth action | Immediate busy/limit; no second pending intent and no overwritten receipt |

An exact duplicate receipt remains readable after termination. A wrong owner or contradictory duplicate never changes it. Owner UUIDs remain in accepted-request metadata, never public snapshots, prompt content or tool results. The browser also checks intent expiry, so a delayed pending snapshot cannot navigate after its deadline. Historical reads have no action callback.

## Compatibility and boundaries

New client/new server negotiate per send. Old client/new server returns unavailable immediately. New client/old server receives no `viewProtocol` echo and cannot execute an intent. Legacy fallback has no view negotiation. Older presentation parsers strip the additive fields and preserve normal chat. Copies' autonomous child runs and automatic reviews have no injected view port.

No new database table, status, protocol major, marker kind, generic router or capability registry. No URL/selector/HTML/JS comes from the model. Navigation reports rendering only, not loaded data, recording, Apply, settings saved or a hardware change.

## Inline review

TypeScript review used schema-validated boundaries and exclusive result/intent unions; structural wire/persistence contracts are tested without crossing the module table. Simplification reused the shell's existing `busyHere` activity guard, removed an unnecessary optional-call fallback, and replaced casts with explicit types. React Doctor found hooks below an early return and render-phase ref writes; those were moved above the return and into layout effects. Its remaining strict-schema deprecation warnings are compatible with installed Zod 4 and the repository's strict-schema pattern.

Test-quality self-check: expected results are requirement literals, owner/terminal mutations are rejected, and deleting the implementation breaks the assertions. App and CLI tests exercise public behavior with only model I/O scripted. The small waiter tests intentionally bind to that helper's public lifecycle; they are not substitutes for the app tests or the pending real-browser gate. No mutation-testing tool was run.

During iteration, a broader cancellation check broke an existing legacy copy-recovery test. The check was narrowed to capable view runs and the existing copy handoff path; the focused copy suite then passed. An initial auth assertion expected 403, but the unchanged token guard correctly returns 401; the test was corrected. No user or unrelated changes were reverted.
