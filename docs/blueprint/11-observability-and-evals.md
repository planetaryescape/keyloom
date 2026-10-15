# 11: Observability and evals

keyloom calls a model and flashes hardware. Both need evidence when something goes wrong. "The agent suggested something odd" and "the keyboard stopped typing after a flash" are the two failures that matter, and both must be diagnosable from logs, not from memory.

## Logs

- Structured JSON lines via `pino`, written to `$XDG_DATA_HOME/keyloom/logs/keyloom.log`, rotated at 10 MB with 5 files kept. Build and flash logs are separate files per run, linked by build ID.
- **Every agent turn logs:** conversation and message IDs, model, effort, `usage` (input, output, `cache_read_input_tokens`, `cache_creation_input_tokens`), latency, `stop_reason`, each tool call with its name and duration, and each validation failure with its codes. It never logs the API key. Message content is already in the database, so the log carries IDs, not text.
- **Every apply logs** the revision, change set, validator result and decision ID. **Every build and flash logs** the revision, the pinned firmware SHA, the tool versions (Docker image digest, `zapp --version`), the exit status and the duration.
- `keyloom doctor` checks:
  - Docker is reachable
  - each pinned checkout matches its SHA
  - `zapp` is installed
  - the API credential resolves (a `models.retrieve` call, not a generation)
  - the database opens and its migrations are current

## Recovering from a bad flash

Every flash records the build and revision it came from. `keyloom flash --build <earlier build>` reflashes a known-good artifact without rebuilding. The web app's history view offers "flash this revision" for any revision with a successful build. If a flash leaves the keyboard unusable for typing, BK recovers with another keyboard and one command.

## Evals for the agent

Proposals are where the model can be wrong in ways the validator can't catch. A valid change can still be a bad idea. The eval set is a folder of scenarios in `evals/scenarios/`. Each scenario is:

- a fixture layout (BK's imported Moonlander and Glove80 layouts, plus small synthetic ones)
- the user messages, including any selection
- deterministic checks on the resulting proposals

| Scenario | Source | Checks |
|---|---|---|
| Option–Option | D-019, D-025 | At least one valid alternative. LALT is reachable as a plain `modifier` or through an Option–Option macro. No alternative puts a multi-tap behaviour on S |
| Command–Shift | D-020, D-025 | Valid alternatives place `modifier LGUI+LSFT`. No function is lost without `dropFunction`. Pinned priorities aren't moved without a `moved_pinned` warning |
| Number layer | D-006 | Digits 1–0 on the home row of a new or existing layer. Symbols on the row above. The layer is reachable |
| Home row mods on F and J | D-006 | F and J are `holdTap` with LGUI. The profile has an opposite-hand constraint, or a `homerow_same_hand_mods` warning is surfaced |
| Do that here too | D-011, D-012 | With five keys selected, the proposal changes exactly those five slots |
| Remembered reason | D-022 | With a decision on the Command–Shift key, a request to replace it makes the agent mention the stored reason before proposing |

`bun run evals` runs every scenario against the configured model. It writes a report to `evals/reports/<date>-<model>-<effort>.md` with pass/fail per check, token usage and cost. Evals cost money, so they run by hand: before changing the model, effort or system prompt, and at the end of any rung that touches `src/agent/`. They never run in CI.

Change the model or effort only when the evals show an improvement worth its cost ([12](12-cost-model.md)).
