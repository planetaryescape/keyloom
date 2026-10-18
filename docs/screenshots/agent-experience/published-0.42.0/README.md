# Published 0.42.0 acceptance

**Passed all four assigned core journeys on the published installed CLI and its actual bundled web app. No acceptance blocker was observed.** This was execution QA, not independent review.

## Exact artifact

- Version observed with `--version`: **0.42.0**.
- Binary: `/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-0.42.0-published-install/bin/keyloom`.
- SHA-256, checked before and after execution: `e11d7d75ed772ef229181d6eed13f0b7b9d59b8cfcb50eb7ddc41334c018d56c`.
- Release source: `92347e61b22e4e9e86db61853da2f0cdacdefd68`; tree: `5a22970710c121083bb95f4e50b487540e380198`.
- `src` tree: `7ac6b63e4aa81ec2e8421a751f467cda014ddd36`, verified equal to corrected candidate `72233df8dfcee0670d665232cc6bb55933cb9726` with `git rev-parse`.
- The earlier full-matrix candidate and release have identical `src/web` trees: `5598a06bbe8242ee73727399fc9346ac66bba2c8`. Earlier matrix evidence is carried only for that unchanged web source; the core journeys below were freshly executed on the published binary.

The parent supplied this fresh install from the normal public release and reported installer/checksum/asset-digest verification. This worker independently checked its installed version and file hash, not the download transaction.

## Execution and isolation

```sh
parent=/Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-blueprint
binary=/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-0.42.0-published-install/bin/keyloom
scratch=/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-0.42.0-release-smoke-01
bun "$parent/scripts/spikes/agent-release-smoke.ts" --binary "$binary" --scratch "$scratch" --serve --browser-scenario completed
agent-browser --session keyloom-published-0420 open "$PRIVATE_PRINTED_URL"
```

The parent's existing **21 passing preparation checks** are copied unchanged in [parent-prepare-results.json](parent-prepare-results.json). The server was started once; later scenario edits did not restart it or use another scenario flag. The real printed capability URL stayed private. No DOM/transcript replacement, network mocking or development UI was used.

All model work used deterministic fake Codex through real MCP wrappers. Child environments were allowlisted, CODEX_HOME remained empty, fake `record.json` remained a `/dev/null` sink, and autosync remained explicitly off. Only the original synthetic Moonlander and one intentional synthetic copy existed. No real user data, credentials, paid provider, Apply, sync, flashing, firmware build, remapping, typing recording or review-model action was used. The real server could detect devices/read status.

Read-only installed inspections used `conversations list LAYOUT_ID`, `conversations show CONVERSATION_ID --format json`, `config list --archived`, and `autosync status zsa/moonlander`, under the same isolated environment.

## Fresh observed journeys

1. **Completed history and composer.** Opened the CLI conversation through Ask → More → Conversations. The final answer was separate from public working detail. Keyboard Enter/Space opened, folded and reopened that detail. Reload/history retained the conversation. One new inspection through the real composer produced two answers, two working notes and two disclosures; persisted history contains two completed correlated presentations. See [cli-completed.json](cli-completed.json) and [completed-initial.ax.txt](completed-initial.ax.txt).
2. **Exclusive sidebars.** The actual Not looked over yet marker opened the real empty Board review. More → Settings replaced it at both 1440×900 and 390×844; no review/Hints pane remained visible behind Settings. Desktop History replaced Settings and Ask replaced History. Document/body scroll widths equalled each viewport width. No Look now action or review fixture was used. See [sidebar-checks.json](sidebar-checks.json).
3. **Prepared copy and phone shell Stop.** A new conversation called `create_config` with `from: "this"`, completed one copy, published notes and hung. Closing chat at 390×844 exposed a visible shell Stop at y=775–819 without scrolling. Clicking it cancelled the turn. Reload/history retained the completed operation/config reference and **“Stop is not rollback”** warning. The config count stayed exactly two across history reads; the original head and selection were unchanged. See [cli-stopped.json](cli-stopped.json), [running-phone.ax.txt](running-phone.ax.txt), [stopped-reloaded.ax.txt](stopped-reloaded.ax.txt), and [assertions.json](assertions.json).
4. **Deferred malformed question and Keep.** The first malformed `ask_user` deferred completion until after a valid Keep or replace? call ran. The real QuestionCard remained answerable, showing failed first/succeeded second activity. After changing the owned scenario to the final public reply, clicking Keep answered the original question and displayed **Kept the original arrangement.** Reload/history and CLI inspection retained both completed presentations, unchanged operation facts and `questionToolUseId: item_1`. The synthetic canary was absent from the inspected UI/AX and public CLI projection. **Private provider replay was not inspected or certified.** See `cli-question-*.json` and `question-*.ax.txt`.

## Four screenshots

- [Completed desktop, light](completed-desktop-light.png)
- [Replacement Settings on phone, dark](settings-phone-dark.png)
- [Saved stopped warning on phone, dark](stopped-phone-dark.png)
- [Answered question after reload on phone, dark](question-answered-phone-dark.png)

Phone reading screenshots use the real sheet-height keyboard control. There was no matrix/polish rerun. One initial chat-menu action did not expose its menu; a fresh snapshot and explicit menu wait corrected the automation before proceeding.

## Runtime health and shutdown

[runtime-health.json](runtime-health.json) contains only sanitized request paths/statuses, not headers or capability queries. The named browser reported **zero uncaught errors**. Of 76 captured requests, 74 had HTTP 200, `/favicon.ico` had HTTP 404, and one `/api/chat/provider` fetch had no terminal status recorded. That last request is not counted as a confirmed success or failure. No other HTTP error was observed. The intentionally malformed MCP question is a handled tool-validation failure, separate from browser exceptions or failed HTTP requests.

The owned task browser was closed and only the owned harness/server group was interrupted. The harness exited **0**, all **9 server checks passed**, and its private stderr had no unhandled/error/failure marker. Isolation remained intact after shutdown. See [server-lifecycle.json](server-lifecycle.json) and [shutdown.json](shutdown.json).

No production edits, builds, full suite, commits, pushes, release changes or real-provider/hardware checks were performed. The native desktop ZIP was **not launched or certified**; notarization was not tested. This packet verifies these published CLI/web journeys, not every provider, ordering variant, accessibility state or native platform.
