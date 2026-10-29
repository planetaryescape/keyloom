# 11: Observability and evals

Status: logs, recovery commands and eval harness built. The audit closeout adds apply logging, doctor credential checks and the two missing D-006 scenarios with offline oracle tests. Paid live evals and hardware checks were not run for this audit.

keyloom calls a model and flashes hardware. Both need evidence when something goes wrong. "The agent suggested something odd" and "the keyboard stopped typing after a flash" are the two failures that matter, and both must be diagnosable from logs, not from memory.

## Logs

- Structured JSON lines use the custom synchronous append/rotation writer in `src/persistence/log.ts`, not `pino` (D-417). They go to `<data dir>/logs/keyloom.log`, rotated at 10 MiB with five files total (current plus four backups). Logging is best-effort; an I/O failure does not fail the operation it describes. Build and flash output also has a separate log per run.
- **Completed agent turns log:** conversation/message IDs, provider, model, effort, `usage` (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`), duration, `stopReason`, tool names/durations and validation-failure codes. A provider-reported cost is included when available. Failed turns log an error category, not a fabricated complete usage total. The records carry IDs rather than message text or API credentials.
- **Committed applies log** layout/revision/change-set/decision IDs, source, `ok`, and distinct error/warning codes, not ops or the user's reason. A rolled-back apply leaves no success line. **Build and flash summary records** carry their IDs, board and status; builds also identify the layout/revision and artifact or error. Use the database's build/flash rows and per-run output logs for timing, pinned source and subprocess details. The summary is not a complete tool-version manifest.
- `keyloom doctor` checks:
  - Docker is reachable
  - each pinned checkout matches its SHA
  - `zapp` is installed
  - each configured Anthropic/OpenRouter API key resolves through `models.retrieve`, with a five-second timeout and no generation. Rejected credentials fail; missing keys or an inconclusive network check warn. This does not verify a Codex subscription
  - the database opens read-only, passes integrity/WAL checks and has current migrations; doctor does not migrate it

## Recovering from a bad flash

Every flash records its build; the build identifies the revision. After explicit permission to write the keyboard, `keyloom flash --build <earlier-build>` can reflash a retained successful artifact without rebuilding. The artifact must still exist locally and match the board/revision. Check the running server's auto-sync setting before recovery: otherwise it may put the current head back afterwards. Bootloader entry can still need the board's manual procedure, and recovering an unusable keyboard may need another keyboard.

History does **not** offer an old-artifact "flash this revision" action. Go back creates a new head revision containing the old document; Put on keyboard for a version restores it first, then syncs that head (or selects the config and syncs). It is not an exact reflash of an old binary. D-416 supersedes the earlier D-172 promise; [25](25-configs-and-versions.md#versions) describes the version workflow. No hardware permission follows from opening History or inspecting a build.

## Evals for the agent

Proposals are where the model can be wrong in ways the validator can't catch. A valid change can still be a bad idea. The eval set is a folder of scenarios in `evals/scenarios/`. Each scenario is:

- a fixture layout (BK's imported Moonlander and Glove80 layouts, plus small synthetic ones)
- the user messages, including any selection
- deterministic checks on the resulting proposals

| Scenario | Source | Implemented checks |
|---|---|---|
| Option–Option | D-019, D-025 | At least one valid alternative, a plain LALT or two-tap Option macro found in the document, and no native/macro replacement of S. This legacy heuristic does not independently prove reachability or reject a modelled tap dance on S |
| Command–Shift | D-020, D-025, D-452 | One valid proposal before the first question, each question with considerations and a step, a revision that supersedes the one before so one proposal stays open, stated Backspace/F16 priorities recorded, displacement shown, the final proposal keeps Backspace and its decision reason carries what BK answered, and apply/undo restores the document |
| Number layer | D-006 | Synthetic Glove80: digits 1–0 under A–semicolon, shifted digit symbols immediately above on the same reachable non-base layer; Base letters stay intact. Every alternative is revalidated |
| Home row mods on F and J | D-006 | Synthetic Glove80: F and J keep their taps and hold only LGUI. Each has opposite-hand protection or a surfaced `homerow_same_hand_mods` warning identifying that key. Every alternative is revalidated |
| Do that here too | D-011, D-012, D-064 | Changes exactly the selected keys whose mirrors have mods (three Moonlander keys, four Glove80 keys), keeps each tap, mirrors modifiers and ZMK trigger positions |
| Remembered reason | D-022 | With a decision on the Command–Shift key, a request to replace it makes the agent mention the stored reason before proposing |
| Cross-board | D-220 to D-229 | Three cases: refuse unsupported Glove80 LED colours, copy supported Moonlander colours, and map home-row mods with the correct hand and trigger positions |
| Hostile prompt | D-110 | No applied change or head movement; every stored proposal is accounted for by the handler and only allowed keyloom tools were called |

The original table promised six scenarios. All six now have definitions, alongside cross-board and hostile-prompt coverage: eight files and ten live tests (cross-board has three). Definitions and a skipped run are not evidence of model quality. The new predicates in `evals/vocabulary-oracles.ts` also run offline against passing and adversarial failing proposals in `test/evals/vocabulary-oracles.test.ts`.

```sh
bun test test/evals/vocabulary-oracles.test.ts
bun run evals
```

The second command safely skips live tests by default. `evals/provider.ts` requires **both** `KEYLOOM_LIVE_EVALS=1` and the selected provider's credential. `KEYLOOM_EVAL_PROVIDER=anthropic|openrouter|codex` selects it (default Anthropic); the credential is its environment API key, or a successful `codex login status`. `evals/bunfig.toml` keeps real flashing and real data blocked while permitting this explicit live gate; ordinary `bun test` additionally strips credentials.

Only with separate permission to spend model credits, run through the shared local resource queue:

```sh
KEYLOOM_LIVE_EVALS=1 KEYLOOM_EVAL_PROVIDER=anthropic agent-work run -- bun run evals
```

The key must already be supplied in the environment; never put it in a report or command history. Executed scenarios write `evals/reports/<date>-<provider>-<model>-<effort>-<scenario>.md`, with pass/fail, usage and available cost (Codex can report tokens only). Skipped scenarios write no report. Paid evals are manual, not CI: before changing model, effort or prompt, and after a rung touching `src/agent/` when authorized.

Change the model or effort only when the evals show an improvement worth its cost ([12](12-cost-model.md)).
