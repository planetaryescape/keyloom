# 26b source-runtime acceptance

**RED: Stop before POST acceptance can still allow preparation after Stop.** Other exercised saved-run, crash-receipt and consecutive-question journeys passed. This is execution QA, not independent review or a claim that the whole agent is complete.

## Source and resources

- Candidate source directory: `/Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-closeout` (read only).
- Supplied base HEAD: `e2e2eab5be53542727f342d33193e3bbd65a7e8d`.
- Supplied dirty snapshot: `d3fd2dcb8316a3866bcc6bba6b940a6e54f85fa1`; `src` tree: `81719d32f482e66d0bf682a7d3fb527b4696119b`.
- Runtime: `/opt/homebrew/Cellar/bun/1.3.14/bin/bun` executing the candidate's absolute `src/cli/main.ts`.
- Scratch: `/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-26b-source-acceptance-01`.
- Named browser: `keyloom-agent-26b-acceptance`.

**This is source acceptance, not compiled or published proof.** The temporary executable wrapper's SHA-256 is `37cf5564edc8f95f9814cc619b30e5c1365e11264bb9eac615f3097a7fbab1a9`; that identifies only the wrapper, not a compiled candidate or complete source snapshot.

Exact owned PIDs/ports/paths are registered in [resources.json](resources.json): initial source server **27398**, harness **27378**, port **56815**; refused restart harness **33508**; final direct source server/group **38376**, port **4510**. No parent browser, forbidden parent port, real server, user data directory or installation was used.

## Blocker: visible Stop precedes acceptance, but work executes later

Affected source: `src/web/chat/useChat.ts` lines 77–87 and 156–160; `src/web/chat/api-chat.ts` lines 20–27 and 39–40.

Exact observed reproduction:

1. On the actual candidate app, install a browser fetch wrapper that holds only the first `POST /api/agent/v1/runs` **before** calling the original fetch. Other requests pass through unchanged. The wrapper changes no request body, response, DOM or application state.
2. The real composer sends a synthetic prepare-copy request. The UI exposes Stop while the acceptance POST is held.
3. Click that visible Stop. It sends `/api/agent/v1/runs/<pending-request-UUID>/cancel`; the real server returns **404** because acceptance has not occurred.
4. Release the original, unchanged POST. The server accepts run `run_01M58HQPYE23GGRKAPN4VSZ598` with `cancelRequested: false`. The fake Codex executes real MCP `create_config` and creates `lay_01M58HQQ8PTGS674MGQPWGS4E9` **after the first Stop**.
5. The turn remains running. A second explicit Stop after acceptance returns 200 and cancels the owner, retaining one preparation receipt.

The client saves the request UUID before awaiting acceptance, but the early cancel's 404 is only reported as a problem. On acknowledgement, it observes the accepted run without retiring/cancelling that pending request. This is a concrete failure of the early Stop journey, not a speculative transport concern. No production fix was made.

Evidence: [pre-acceptance-protocol.json](pre-acceptance-protocol.json), [pre-acceptance-stop.ax.txt](pre-acceptance-stop.ax.txt), [after-pre-acceptance-stop.ax.txt](after-pre-acceptance-stop.ax.txt), [red screenshot](pre-acceptance-stop-red-phone.png), [final run](pre-acceptance-final-run.json), [config list](pre-acceptance-configs.json).

**Control:** hold the acknowledgement only **after** the original fetch has accepted a read-only hanging run. Stop by the still-pending request UUID returns 200; releasing the unchanged acknowledgement ends in `cancelled` with zero preparations. See [held-ack-control.json](held-ack-control.json) and [held-ack-final-run.json](held-ack-final-run.json). The failure is therefore acceptance-before-cancellation ordering, not a general inability to cancel by request identity.

## Other observed journeys

- **Accepted identity is idempotent:** repeating the same real acceptance request returned the same run ID and left exactly one copy for that run. See [saved-run-repeat.json](saved-run-repeat.json).
- **Close/reopen/reload does not cancel:** the accepted prepare-and-hang run stayed `running` with one committed preparation after hiding chat, Show agent work, and page reload. Explicit Stop then persisted `cancelled` with the receipt. See `saved-run-*.json`, [AX](saved-run-reloaded.ax.txt), and [screenshot](saved-run-reloaded-phone.png).
- **Crash recovery:** after one crash-test copy completed, SIGKILL was sent only to owned source server 27398. Its harness killed its owned group and exited 1, as expected for the injected crash. After restart, the saved run was `interrupted`, retained one preparation, and the actual browser visibly displayed config reference **`lay_01M58HT9KZBXTKWBEP360S9A53`**. Reading history created no extra copy. See [recovered run](crash-recovered-run.json), [AX](crash-recovered.ax.txt), [screenshot](crash-receipt-phone.png), and [intentional crash lifecycle](intentional-crash-lifecycle.json).
- **Consecutive questions:** separate actual fake-Codex executions both emitted inner `item_0`; their canonical IDs were distinct: `codex_0414b1ca-4e3e-49d3-91d2-745928e8b2d8_item_0` and `codex_7afe3531-2a91-460c-8c5e-0c3d0b7c1f4e_item_0`. The first remained answered **Keep first**, while the second remained unanswered across reload until **Use second** was clicked. Both answers and the final response survived another reload. See `question-*.json`, [final history](consecutive-questions-final.json), [AX](consecutive-questions.ax.txt), and [screenshot](consecutive-questions-phone.png).

Config counts were: original **1**, early-Stop probe **2**, saved-run copy **3**, read-only acknowledgement control still **3**, crash copy **4**, and consecutive questions/history reads still **4**. All four are synthetic Moonlander configs. No automatic replay or duplicate config was observed in the exercised recovery/idempotency journeys. See [final-configs.json](final-configs.json).

## Commands, tooling corrections and limits

The candidate's `scripts/spikes/agent-release-smoke.ts` ran with `--binary` pointing to an owned temporary executable wrapper and `--scratch` pointing to the fresh root above. Source preparation passed its 21 checks. It then used `--serve` without scenario reset while owned `scenario.json` was edited between requests. Model work was deterministic fake Codex through real MCP wrappers, with empty private CODEX_HOME, a `/dev/null` record sink, allowlisted child environment and explicit autosync-off.

Two manual CLI inspections through the wrapper failed because its initially selected `bun` was a mise shim. That shim also created an unexpected tracking symlink inside the private HOME; the smoke harness correctly refused a restart rather than following it. Only that owned symlink was removed, not its target. No mise trust or global configuration was changed. Further CLI inspection and the final restart used the real Bun executable directly, with the same isolated environment:

```sh
/opt/homebrew/Cellar/bun/1.3.14/bin/bun \
  /Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-closeout/src/cli/main.ts \
  --data-dir "$SCRATCH/data" serve --no-open --port 4510 --provider codex
```

Read-only checks used `agent show <run-or-request-id>`, `conversations show <id> --format json`, `conversations list <layout>`, `config list --archived`, and `autosync status zsa/moonlander`. No raw tokens, headers, environment records or provider replay are included in public evidence.

The task browser was closed. The final owned direct server/group received SIGINT and exited **0**. All owned harnesses exited; scratch evidence is retained for the parent. No real provider, paid model, hardware write, Apply, sync, firmware build, remapper, typing recording, production edit, heavy build, full suite, commit, push or release action was used. No focus matrix was repeated. Compiled/published acceptance and the parent's final CI gates remain separate.
