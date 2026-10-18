# Integrated candidate acceptance evidence

Acceptance execution against the **compiled production app**, not the development editor or a mock UI. No production code was changed by this worker.

## Binary and isolation

- Build-owner source revision: `bf966949249d5371be8f272ed8cf1f923888d20c`; source tree: `993cc7cee0f9a78199418bad401468160a10ce90`.
- Binary: `/Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-review/dist/keyloom-darwin-arm64`.
- SHA-256, checked before and after execution: `b7f71a182c5f0b9baa3984f77b63c33fd2e7dd04706e46009bd4285c8586dd62`.
- The candidate still identifies as `0.41.1`; this is **not** evidence of a published 26a release.
- Scratch root: `/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-26a-candidate-qa-smoke-01`.
- Named isolated Chromium session: `keyloom-26a-integrated-smoke`. The actual token-bearing URL came from the owned server's private startup output; capability tokens and browser state are not included here.
- Only the repository's synthetic Moonlander import and deterministic fake Codex were used. HOME/XDG/TMPDIR were private, CODEX_HOME remained empty, fake `record.json` remained a `/dev/null` sink, and Moonlander autosync remained explicitly off. No provider credentials, paid model, real layout data, hardware write, Apply, sync, firmware build, flashing, recording or remapping was used. The real server was permitted to detect devices/read status.

The build worktree advanced during execution; a later read found HEAD `70159b6ae5773609a9483833e59e59b2e5fc3762`. It was not rebuilt or edited by this worker. The unchanged binary hash above, not that later worktree HEAD, identifies the tested artifact.

## Commands

```sh
parent=/Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-blueprint
binary=/Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-review/dist/keyloom-darwin-arm64
scratch=/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-26a-candidate-qa-smoke-01
bun "$parent/scripts/spikes/agent-release-smoke.ts" --binary "$binary" --scratch "$scratch" --prepare-only
bun "$parent/scripts/spikes/agent-release-smoke.ts" --binary "$binary" --scratch "$scratch" --serve --browser-scenario completed
agent-browser --session keyloom-26a-integrated-smoke open "$PRIVATE_PRINTED_URL"
```

The parent's harness was used by absolute path, including its capability-query URL fix. Prepare exited 0 with **21 passing checks**; see [cli-prepare.json](cli-prepare.json). The owned server was started once. Its scratch scenario was edited between browser requests without restarting the server or replacing the binary.

Browser actions used real controls: Ask → chat More → Conversations → stored conversation; composer fill and Enter; disclosure focus and Enter/Space; theme/media and viewport controls; chat close; shell Stop; review marker; global More → Settings; History; Library; Ask. No React state, transcript DOM or production handlers were replaced. No network route fixtures were used.

Read-only CLI inspections used an allowlisted environment and the same binary/data directory:

```sh
env -i PATH=/usr/bin:/bin HOME="$scratch/home" CODEX_HOME="$scratch/codex-home" \
  KEYLOOM_PROVIDER=codex KEYLOOM_CODEX_BIN="$scratch/fake-codex/codex" \
  "$binary" --data-dir "$scratch/data" --format json conversations show CONVERSATION_ID
```

Also executed: `conversations list LAYOUT_ID`, `config list --archived`, and `autosync status zsa/moonlander`. These commands did not send model requests or start device operations.

## Observed results

### Completed history and actual composer

The CLI-created conversation opened from the app's Conversations list with the final answer separate from folded working detail. Keyboard Enter opened the disclosure, Space folded it, and Enter reopened it. The detail contained the public working note and a completed Read layout operation.

A second synthetic inspection was sent through the actual composer. It completed with **two assistant answers, two working notes and two disclosures** in the conversation. Reload and reopening retained those counts. Both persisted turns have a succeeded `get_layout` operation (`op_1` within each original user-message namespace), canonical public-message links, no preparation effect and no warning. See [cli-completed.json](cli-completed.json) and [completed-reopened.ax.txt](completed-reopened.ax.txt).

The read operations completed too quickly to capture their running interval. No claim is made that a running read/tool row was observed. The hanging preparation scenarios below establish the actual ongoing-turn/Stop path instead.

### Preparation, ongoing turn and Stop

Two deliberate requests created distinct synthetic copies: `26a QA desktop copy` and `26a QA phone copy`. Each scenario said a public note, called real MCP `create_config` with `from: "this"`, said it was waiting, and hung. The turn remained live after Create config completed. Reduced-motion screenshots show a readable Working state and reachable Stop, without relying on animation.

- Desktop composer Stop cancelled the desktop turn.
- On the phone, closing chat kept the ongoing request alive and exposed **Show agent work / Stop** in the shell. Shell Stop was visible without scrolling (its rectangle was y=775–819 in the 844-pixel viewport) and cancelled the phone turn. Phone composer Stop was also visible at y=788–832 before closing chat; desktop composer Stop was at y=835–879 in the 900-pixel viewport.
- Reopening saved history and reloading showed **“Stop is not rollback”**. Both stored presentations are `cancelled`, retain the succeeded Create config operation and generated config reference, and set `effectsMayHaveOccurred: true`. See [cli-desktop.json](cli-desktop.json), [cli-phone.json](cli-phone.json), and the stopped AX snapshots.
- The original plus the two intentional copies remained: **3 configs before and after CLI/browser history reads**. The original head matches both copies' source revisions; the original remains the selected config and neither new copy is on the keyboard. These are database facts, not claims about physical firmware. See [cli-acceptance.json](cli-acceptance.json), [cli-after-browser-history.json](cli-after-browser-history.json), and [config-menu.ax.txt](config-menu.ax.txt).

### Exclusive sidebars

The actual Not looked over yet marker opened the real Board review panel. This scratch board had no completed review; no Look again/Look it over action or review-model call was requested. Global More → Settings replaced review. History replaced Settings, Library replaced History, and Ask replaced Library. In each step, exactly the expected tested pane was visible and the other four tested panes were not. See [sidebar-transitions.json](sidebar-transitions.json). The review fixture was **not mocked**.

## Screenshots

All matrix screenshots are viewport captures at 1440×900 or 390×844, light/dark, with reduced motion enabled. Phone reading views use the real sheet-height keyboard control where needed; chat content remains scrollable.

| State | Light desktop | Dark desktop | Light phone | Dark phone |
|---|---|---|---|---|
| Completed, reopened | [1440](completed-reopened-light-1440.png) | [1440](completed-reopened-dark-1440.png) | [390](completed-reopened-light-390.png) | [390](completed-reopened-dark-390.png) |
| Live hanging turn / Stop | [1440](running-stop-light-1440.png) | [1440](running-stop-dark-1440.png) | [390](running-stop-light-390.png) | [390](running-stop-dark-390.png) |
| Saved stopped warning | [1440](stopped-warning-light-1440.png) | [1440](stopped-warning-dark-1440.png) | [390](stopped-warning-light-390.png) | [390](stopped-warning-dark-390.png) |

Additional evidence: [phone shell Stop, light](running-shell-stop-light-390.png), [dark](running-shell-stop-dark-390.png); the completed phone operation scrolled into view [light](completed-operation-light-390.png), [dark](completed-operation-dark-390.png); [real review](sidebar-review-1440.png), [replacement Settings](sidebar-settings-1440.png).

The completed/running DOM measurements record document and body scroll widths equal to the viewport at both widths, plus reduced-motion state. This checks page-level horizontal overflow, not every nested scroll container.

Scoped axe-core 4.12.1 checks found **0 violations** in the completed and stopped chat states. Completed chat has one incomplete color-contrast rule (nine overlapping/offscreen nodes); contrast is therefore not fully certified. Stopped chat has no incomplete checks. Reports: [completed-axe.json](completed-axe.json), [stopped-axe.json](stopped-axe.json). These are scoped checks, not a full-app accessibility certification.

## Execution limits and handoff

No acceptance blocker was observed in the journeys above. Automation initially encountered hidden/remounted chat controls, a clipped disclosure, an incorrect shell-Stop selector, and a history selector matching the first button in every row. Fresh snapshots and explicit row selection corrected those control errors; invalid preliminary captures were replaced. Final completed phone DOM evidence asserts two assistant turns and no stopped warning. One Python batch had a syntax error and performed no actions.

No final release install, full suite, production edit, build, PR, commit, merge or deployment was performed. This is compiled-candidate acceptance, not published-release acceptance, independent review, real-provider evaluation, real-board review or hardware proof. Transient tool-running frames, live token streaming, failure/validation variants and broader sidebar combinations were not separately exercised. The parent owns those remaining gates and the release ledger.

The named task browser and only the owned harness/server process group were closed at the end. Private scratch data is retained for the parent. `SHA256SUMS` covers the evidence files in this directory.
