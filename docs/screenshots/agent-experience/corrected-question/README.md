# Corrected Codex question-order acceptance

**Passed:** the refreshed compiled app handled a failed earlier question whose completion arrived after a later valid question had paused the provider. The valid question remained answerable, accepted Keep, and survived history reload with the same operation facts. This was acceptance execution, not independent review.

## Artifact

- Build-owner source: `72233df8dfcee0670d665232cc6bb55933cb9726`.
- Source tree: `da7de95df56b8a06e42a4119125679306f76fbc8`.
- Binary: `/Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-review/dist/keyloom-darwin-arm64`.
- SHA-256, verified before and after execution: `c3b45ec343d4f9f268540b669b99fca712ddb082695575c6a6772505587b58d4`.
- Fresh parent-prepared scratch: `/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-26a-corrected-candidate-01`.

The parent's existing 21-check preparation result is copied to [parent-prepare-results.json](parent-prepare-results.json). This worker did not rerun preparation, build, run the full suite, edit production, or repeat the earlier UI matrix.

## Executed journey

The owned scratch scenario used the parent's updated fake Codex helper:

1. `ask_user` with malformed input (`question: 7`, a synthetic canary in `options`) and `deferCompletion: true`.
2. `ask_user` with **Keep or replace?**, options **Keep** and **Replace**.

The helper called the real compiled app's MCP wrappers. Its first completion was buffered until the second MCP call had executed. No transcript DOM, React state or API response was mocked.

The real composer created a new conversation on the original synthetic Moonlander config. Observed before answering:

- A real QuestionCard displayed **Keep or replace?** and clickable Keep/Replace buttons.
- Activity showed the first Ask a question step **Failed** and the second **Completed**.
- The saved presentation was `waiting_user`, linked to the valid second call, `questionToolUseId: item_1`. It was not an iteration-limit ending or an unanswerable waiting state.

Before clicking the real **Keep** option, the owned scenario was changed to a single public response: **Kept the original arrangement.** The app then showed the original question answered Keep and the separate final response. Reload → Ask → More → Conversations → the saved conversation retained that grouping.

CLI inspection confirmed the old and new presentations were both `completed`, the old operation facts were unchanged (`failed`, `succeeded`), and the original user-message/question-call correlation remained unchanged. A second CLI read was identical. The config count remained one and autosync remained explicitly off. Exact assertions are in [assertions.json](assertions.json).

## Commands and evidence

The parent's harness was started by absolute path, **without** `--browser-scenario`, so it preserved the edited scenario:

```sh
parent=/Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-blueprint
binary=/Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-review/dist/keyloom-darwin-arm64
scratch=/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-26a-corrected-candidate-01
bun "$parent/scripts/spikes/agent-release-smoke.ts" --binary "$binary" --scratch "$scratch" --serve
agent-browser --session keyloom-26a-corrected-question open "$PRIVATE_PRINTED_URL"
```

Only that private printed URL was used. Capability URLs, browser state and fake environment/token records are not included in public evidence.

Read-only installed commands, under the isolated allowlisted environment, were `conversations list LAYOUT_ID`, `conversations show CONVERSATION_ID --format json`, `config list --archived`, and `autosync status zsa/moonlander`.

| Evidence | File |
|---|---|
| Answerable question and both operation outcomes, 390×844 | [waiting-question-phone.png](waiting-question-phone.png), [question-waiting.ax.txt](question-waiting.ax.txt) |
| Answered question, retained failed/succeeded steps and final reply after reload | [answered-reloaded-phone.png](answered-reloaded-phone.png), [answered-reloaded.ax.txt](answered-reloaded.ax.txt) |
| Public history before/after answer | [cli-waiting.json](cli-waiting.json), [cli-answered-reloaded.json](cli-answered-reloaded.json) |
| Final DOM facts and assertions | [answered-reloaded.dom.json](answered-reloaded.dom.json), [assertions.json](assertions.json) |

The synthetic canary was absent from the inspected rendered UI/AX and installed CLI **public history projection**, including presentations. **Private provider replay was not inspected; no claim is made that its canary was absent.**

CODEX_HOME stayed empty, fake `record.json` stayed linked to `/dev/null`, and no API keys were passed to children. No Apply, sync, flash, firmware build, recording, remapping, real user data or paid provider was used. The browser and only the owned harness/server process group were closed after the check.

No blocker was observed in this narrow journey. Real Codex, other ordering combinations, the unchanged web matrix and a published-release install were not tested here. Release installation remains the parent's post-merge gate. No commits, pushes or production changes were made.
