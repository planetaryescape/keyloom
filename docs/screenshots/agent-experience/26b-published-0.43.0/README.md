# Public 0.43.0 durable-agent acceptance

**GREEN for the four bounded public-client journeys below.** These checks executed the actual installed public binary and its bundled app, not the earlier candidate, source wrapper or development editor. Prior RED and compiled packets are unchanged. This is execution QA, not independent review or a claim that the whole agent is complete.

## Artifact and resources

- Observed version: **0.43.0**.
- Binary: `/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-0.43.0-published-install/bin/keyloom`.
- SHA-256 measured before/after execution: **`836357f25df7d7a550f12a146f2cc8093d2040e61bc6323c9ffdea48521df6a7`**.
- Release source: `42cc77f4716faa207350c2b7a723599a0c188eda`; tree: `ac44bd523bdb1dbef35d652745645e0ba6b00b37`; supplied `src` identity: `19c6ce5232673a0a6b2b74ffbf4c489437854758`.
- Fresh scratch: `/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-26b-published-acceptance-01`.
- Named browser: `keyloom-agent-26b-acceptance`; owned port **4510**. Server/group **60388** exited **−9** during the intentional crash. Restarted server/group **64144** exited **0** after owned SIGINT. The task browser is closed. See [resources.json](resources.json) and [shutdown.json](shutdown.json).

The parent supplied the checksum-verified public install. This worker independently checked the installed version/hash and executed it; it did not repeat the download transaction or install anything globally.

## Actual public journeys

### 1. Stop before acceptance

A fetch barrier held the composer's initial acceptance POST **before** original fetch, passing all other requests through unchanged. The visible Stop button's keyboard activation returned **202 pending_acceptance**. Releasing the one unchanged POST produced **cancelled**, **zero preparations**, **zero fake-Codex execs**, and no new config. No Stop after acceptance was needed.

The first phone pointer attempt produced no request; it is recorded in [initial-pointer-stop-observation.json](initial-pointer-stop-observation.json), not called a successful click. Keyboard activation then exercised the same actual button and route before releasing acceptance. A separate settled **desktop native-pointer** probe also passed with one click, one acceptance POST, no Stop after acceptance, zero preparations and no additional fake exec. See [phone protocol](early-stop-protocol.json), [desktop pointer protocol](desktop-pointer-stop-protocol.json), and their AX snapshots.

The owned generated fake Codex helper was instrumented only to increment a scratch integer for `exec`; it records no input, arguments, environment or tokens. The counter was reset after fixture preparation. The early phone probe observed zero, and the later desktop probe left the counter unchanged at six.

### 2. One saved preparation, reconnect and explicit Stop

The actual composer prepared one synthetic `0.43.0 saved-run copy` and hung. Repeating the identical accepted request returned the same run ID and no additional config. Hiding chat, Show agent work, and page reload retained that same **running** run with **one committed preparation**. Explicit Stop then persisted **cancelled** and retained the receipt/reference. See [repeat](saved-run-repeat.json), [reloaded run](saved-run-reloaded.json), and [stopped run](saved-run-stopped.json).

### 3. Crash and recover without replay

A separate real request committed `0.43.0 crash receipt copy` and hung. Only the owned server group received SIGKILL. Restarting the same public binary yielded **interrupted**, one saved preparation and config reference **`lay_01M58JZGZYD24V60JTBYZP4SEN`**, visibly rendered on phone and desktop.

The measured counter stayed **3 → 3** across restart and recovery reads; configs stayed **3 → 3** (original plus the two intentional copies). No automatic replay or additional config was observed. See [pre-crash snapshot](crash-before.json), [counter baseline](crash-counter-baseline.json), [recovered run](crash-recovered.json), and [AX](recovered.ax.txt).

The pre-crash counter was three rather than an inferred two. Its extra earlier exec was not attributed during this bounded check; no forbidden early-Stop copy or duplicate config existed. Recovery's no-replay assertion uses the **observed** baseline, not an assumed invocation count.

### 4. Consecutive questions and different saved answers

Two real fake-Codex executions emitted separate canonical IDs:

- `codex_c4d7de75-fa53-4ba4-9934-11fa47abdd2d_item_0` → **Keep first**.
- `codex_a9cdb8ef-d428-4a7d-a5ea-cfdc1d044100_item_0` → **Use second**.

The second remained unanswered after reload until its own button was clicked. Both different answers and the final response survived another reload. Installed CLI inspection agreed with the browser. Configs remained three; the final exec counter was six. See [second question waiting](question-second-waiting.json), [final history](questions-final.json), and [AX](questions-reloaded.ax.txt).

## Commands, proof and isolation

```sh
binary=/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-0.43.0-published-install/bin/keyloom
scratch=/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-26b-published-acceptance-01
/opt/homebrew/Cellar/bun/1.3.14/bin/bun \
  /Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-closeout/scripts/spikes/agent-release-smoke.ts \
  --binary "$binary" --scratch "$scratch" --prepare-only
"$binary" --data-dir "$scratch/data" serve --no-open --port 4510 --provider codex
```

All **21 preflight checks passed**, including installed CLI import/chat/conversation projection. See [prepare-results.json](prepare-results.json). Read-only installed inspection used `agent show`, `conversations list/show`, `config list --archived`, `autosync status`, and `--version`. Bounded assertions/commands are in [assertions.json](assertions.json) and [commands.json](commands.json).

Fresh private HOME/XDG/TMPDIR, empty CODEX_HOME, a `/dev/null` fake record sink, allowlisted child environments and explicit autosync-off remained in force. Only synthetic Moonlander data and real MCP wrappers with deterministic fake Codex were used. There were no response/DOM fakes, provider API keys, live paid models, real data, device writes, Apply, sync, firmware builds, remapping or recording. Capability URLs, headers and environment records are not public evidence.

## Four screenshots and health

- [Early Stop, phone](early-stop-phone.png)
- [Recovered receipt, phone](recovered-phone.png)
- [Recovered receipt, desktop](recovered-desktop.png)
- [Two answered questions after reload, phone](questions-reloaded-phone.png)

[health.json](health.json) records **zero uncaught browser errors**. Captured traffic: 310 HTTP 200, ten intentional HTTP 202, one favicon 404, four requests without terminal status, and one `/api/events` 401 during the run spanning the intentional crash/token restart. Missing statuses and that event-stream rejection are not certified as successful requests; no broader event-stream health claim is made.

One counter assertion initially assumed two pre-crash execs and failed; CLI inspection then confirmed the actual run/receipt/config facts and recorded the observed baseline three. No test was rerun until green by changing production or expected domain outcomes.

No production edit, build, suite, eval, commit, push, merge, release or global installation was performed. Native desktop signing, launch and running-backend verification were **not** this worker's gate. This packet covers durable existing preparation/questions on the public CLI/web app, not every capability, provider, cancellation-capacity limit or hardware/native behavior. Scratch is retained; only owned processes/browser were stopped. Parent owns the ledger and real installation handoff.
