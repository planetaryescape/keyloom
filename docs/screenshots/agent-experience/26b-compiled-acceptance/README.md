# Corrected 26b compiled acceptance

**GREEN for the bounded journeys below.** The previous Stop-before-acceptance RED reproduction now passes on this exact compiled candidate. The earlier source RED packet is preserved unchanged. This is execution QA, not independent review or proof that every agent capability is complete.

## Exact artifact and resources

- Binary: `/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-focus-0421-install-e8hjxff3/keyloom-26b-candidate-19c6ce52`.
- SHA-256 measured before/after execution: **`30801e2cf2a0b2cfed5a252798e431069da3022b1b6fb71b94ddc8542057e2cc`**.
- Observed version: `0.42.1` **candidate**, not a public 26b release.
- Build-owner source base: `e2e2eab5be53542727f342d33193e3bbd65a7e8d`; worker source revision: `19c6ce5232673a0a6b2b74ffbf4c489437854758`; full worker tree: `b7b3704515a0f6d776e514e7af36ae01b31ba7eb`.
- Fresh scratch: `/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-26b-compiled-acceptance-01`. The old source-wrapper root was not reused because its binary hash differs.
- Named browser: `keyloom-agent-26b-acceptance`; owned port **4510** only. Server/group **47704** exited **−9** during the intentional crash; restarted server/group **49403** and phone follow-up group **51555** each exited **0** after owned SIGINT. The task browser was closed. See [resources.json](resources.json) and [shutdown.json](shutdown.json).

The executable was supplied by the build owner; this worker did not rebuild it. All application journeys used the compiled executable, not a source wrapper, development editor, response mock or transcript DOM replacement. No production files, prior evidence or parent resources were changed.

## Stop before acceptance: actual RED → GREEN

The actual composer issued a synthetic prepare-copy request while a browser fetch wrapper held its first `/api/agent/v1/runs` POST **before** calling the original fetch. Other requests passed through unchanged. The visible Stop was clicked once.

1. Stop called `/api/agent/v1/requests/<request-id>/cancel` and received **202**, `status: "pending_acceptance"`, `cancelRequested: true`.
2. The original, unmodified acceptance POST was released once.
3. Its accepted snapshot was already **`cancelled`**, with **0 committed preparations** and no operation execution.
4. Exactly **one acceptance POST**, **zero fake-Codex exec calls**, and **one config** (the original) were observed. **No second Stop was clicked.**

To measure exec calls without recording arguments/environment/tokens, a counter-only line was added to the owned generated fake Codex script. It increments a scratch integer only for `exec`, not `login status`. The counter was reset after the initial CLI fixture smoke, and remained zero through this probe and reload. The script continued to use the existing helper's actual MCP calls and `/dev/null` record sink.

The same actual pre-acceptance Stop was also executed separately at **390×844**. Its pending intent returned 202, the single released POST yielded `cancelled`/zero preparations, the exec counter stayed **6 → 6**, and configs stayed **3 → 3**. No second Stop was used. This phone check did not reset the counter or remove prior synthetic data.

Evidence: [desktop protocol](early-stop-protocol.json), [phone protocol](early-stop-phone-protocol.json), [terminal CLI snapshot](early-stop-final-run.json), [desktop AX](early-stop-desktop.ax.txt), [phone AX](early-stop-phone.ax.txt), [desktop screenshot](early-stop-green-desktop.png), [phone screenshot](early-stop-green-phone.png).

**Held-acknowledgement control also passed:** after the real server accepted a read-only hanging run, its acknowledgement was held before reaching the client. Visible Stop returned 200 for the existing request identity. Releasing the unchanged acknowledgement ended in `cancelled`, with zero preparations. See [held-ack-control.json](held-ack-control.json).

## Saved preparation, explicit Stop and restart

- The real composer prepared **one** synthetic saved-run copy and hung. Repeating the exact accepted request returned the same run ID and no second copy: [saved-run-repeat.json](saved-run-repeat.json).
- Hide chat → Show agent work → reload retained that same **running** run and **one committed preparation**. Explicit Stop then persisted **cancelled** with its receipt/reference: [after reload](saved-run-after-reload.json), [after Stop](saved-run-stopped.json).
- A separate request prepared one crash-test copy and hung. The owned server group alone received SIGKILL. After restarting the **same compiled binary** on 4510, inspection reported **interrupted**, one receipt, and visible config reference **`lay_01M58JCBMNMATT2M6P6KF7Q3K7`** in the actual browser. The reference was visible at both desktop and phone widths.
- The exec counter stayed **3** across restart/recovery reads (one held-ack read, one saved-run preparation, one crash preparation). Config count stayed **3**: original plus the two intentional copies. There was no automatic model replay or duplicate copy.

Evidence: [before crash](crash-before.json), [recovered run](crash-recovered.json), [recovered AX](crash-recovered.ax.txt), [phone receipt](recovered-receipt-phone.png), [desktop receipt](recovered-receipt-desktop.png).

## Consecutive questions

Two separate fake-Codex executions each emitted inner `item_0`. Their canonical IDs differed:

- `codex_c6305c46-4669-4ea0-9d81-aacef8721eed_item_0` → **Keep first**.
- `codex_7ca4a0e0-4865-4d0c-993b-715024e12c64_item_0` → **Use second**.

The second question remained unanswered after reload until its own real answer button was clicked. Both distinct answers and the final reply survived another reload. Config count remained three. The final exec count was six, adding exactly the two question executions and final reply. See [second question waiting](question-second-waiting.json), [final history](questions-final.json), [AX](questions-reloaded.ax.txt), and [phone screenshot](questions-reloaded-phone.png).

## Commands, isolation, health and limits

Preparation used the candidate's existing `scripts/spikes/agent-release-smoke.ts` with the absolute binary and fresh scratch above; **all 21 checks passed**. Servers were launched directly from that same compiled binary with `--data-dir "$SCRATCH/data" serve --no-open --port 4510 --provider codex`. Read-only CLI checks used `agent show`, `conversations list/show`, `config list --archived`, `autosync status` and `--version`. See [commands.json](commands.json), [prepare-results.json](prepare-results.json), and [assertions.json](assertions.json).

Child environments were allowlisted; private CODEX_HOME stayed empty; fake `record.json` stayed linked to `/dev/null`; autosync stayed explicitly false. Only synthetic Moonlander data was used. There were no provider API keys, paid/live models, real data, device writes, Apply, sync, firmware builds, recording or remapping. Browser URLs, headers and environment/token records are excluded from public evidence.

[health.json](health.json) records **zero uncaught browser errors** and aggregate network facts for the main run: 144 HTTP 200, nine intentional HTTP 202, one favicon 404, seven requests without terminal status, and one `/api/events` 401 in the run spanning the intentional server crash/token restart. The missing statuses and event-stream 401 are not certified as successful requests; no broader event-stream recovery claim is made. The [separate phone follow-up](phone-follow-up-health.json) also recorded zero uncaught browser errors. Tested run/history journeys completed successfully. One initial keyboard-open automation wait timed out before any acceptance request; a fresh snapshot and the actual Ask button opened chat, after which the desktop probe ran once.

No full suite, build, eval, production edit, commit, push, merge, release or focus-matrix rerun was performed. Lost-ack GET recovery, cancellation-intent capacity exhaustion, other providers and native/hardware behavior were not separately exercised. Published release, exact-candidate CI and integration remain the parent's gates.
