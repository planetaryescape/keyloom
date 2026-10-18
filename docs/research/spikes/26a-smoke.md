# Run the 26a installed-binary smoke

Run the real CLI and serve its bundled app with synthetic Moonlander data and deterministic fake Codex. This checks the [26a contract](26a-contract.md), not live provider quality or hardware. A completed CLI check does not certify the browser journey or a release.

## Prepare a binary

From the repository root, with dependencies installed:

```sh
binary=/absolute/path/to/keyloom-darwin-arm64
scratch=/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-26a-smoke-candidate
bun scripts/spikes/agent-release-smoke.ts --binary "$binary" --scratch "$scratch" --prepare-only
```

Choose a **nonexistent** scratch root with an existing parent directory. Existing roots are refused except when `--serve` reopens a harness-owned session. Symlinked paths, repository paths, shallow paths and hidden configuration directories are refused. The binary must be an absolute executable path; its resolved path and SHA-256 are saved. A reused session requires the identical binary path and hash. Use a fresh scratch root for each candidate and published release.

`--prepare-only` is the default. Each child command has a 30-second bound. The harness:

1. Imports `test/fixtures/oryx/synchronized` through the supplied binary.
2. Sets Moonlander autosync explicitly off and verifies `choice: false`.
3. Runs installed `chat --provider codex` with a public working note, a real MCP `get_layout` call, and a separate final answer.
4. Runs installed `conversations show <id> --format json` twice. It checks stable completed history, canonical message links, the persisted successful read operation and absence of preparation warnings.

Exit 0 means the checks in that invocation passed. Exit 1 means refusal or a failed command/assertion. Unsupported older releases fail rather than silently skip 26a checks. Inspect `results.json` for sanitized command exit codes and assertion results; raw child output and exception payloads are not retained. Setup refusal before creating a session emits only a generic error.

## Inspect the actual bundled app

```sh
bun scripts/spikes/agent-release-smoke.ts --binary "$binary" --scratch "$scratch" --serve --browser-scenario completed
```

The harness prints one JSON line containing the loopback URL, `layoutId`, `conversationId`, data path, fake executable and editable `scenario.json`. It then stays running until Ctrl-C. Open **that URL**, not a development/mock UI. Server startup has a 30-second bound; after startup the server stays available for manual inspection. Server checks go to `server-results.json`, preserving the earlier CLI results.

Manually verify:

- Open the synthetic Moonlander and its existing conversation. The working note appears as working detail, not a duplicate final answer.
- Expand completed working details, fold them, reopen the conversation, then reload. The same successful read operation and public-message grouping remain visible.
- Send another synthetic inspection request. Observe activity live, then repeat fold/reopen/reload on the completed turn. CLI persistence alone does not establish live start/finish rendering.

Do not click Apply, put/use config, sync, build, flash, device actions, typing recording or remapping controls. The real installed server can detect devices/read their status; it has no authorization to write to them. All stored configs must remain synthetic Moonlander configs and autosync must remain off.

## Check Stop after preparation

Stop the owned server, then restart with the preparation scenario:

```sh
bun scripts/spikes/agent-release-smoke.ts --binary "$binary" --scratch "$scratch" --serve --browser-scenario stop
```

In a **new chat on the original synthetic config**, request a synthetic copy. This scenario calls `create_config` with `from: "this"`, says the copy is prepared, then hangs. Wait for the completed Create config operation/prepared note before clicking **Stop**. Verify:

- The stopped turn does not claim success or rollback.
- Saved history warns **“Stop is not rollback”** and says preparation may already have completed.
- The synthetic prepared copy still exists, with the original config unchanged. Do not put either config on a keyboard.
- Reopen and reload without resending; the warning remains and no extra copy is created.

After Stop, inspect the saved conversation through the installed CLI too. Use the new conversation ID from the app, not the original inspection conversation ID:

```sh
conversation_id=conv_REPLACE_WITH_STOPPED_CONVERSATION
env -i PATH=/usr/bin:/bin HOME="$scratch/home" CODEX_HOME="$scratch/codex-home" \
  KEYLOOM_PROVIDER=codex KEYLOOM_CODEX_BIN="$scratch/fake-codex/codex" \
  "$binary" --data-dir "$scratch/data" conversations show "$conversation_id" --format json
```

This read does not run Codex. A disconnected stream may not deliver its terminal frame, so the persisted warning is the evidence. A separate process may report an active turn as `unobserved`; that is not success or proof of cancellation.

The scenario file uses the existing `FakeStep` shapes from `test/helpers/fake-codex.ts`. You can edit it between requests; omit `--browser-scenario` when restarting to preserve edits. The two presets overwrite it intentionally. Only use synthetic `say`, read-only `get_layout`, `create_config` with `from: "this"`, and `hang`/failure/exit steps. Give each preparation attempt a new synthetic copy name. Do not script device operations, blank-config firmware fetching or external requests. The harness trusts your edits; it does not add production tool restrictions or a test backdoor.

## Isolation and evidence

- Child environments are built from an allowlist, not inherited: private HOME/XDG/TMPDIR, an **empty** private CODEX_HOME, `KEYLOOM_PROVIDER=codex`, and the helper's fake executable. No provider API keys, proxy credentials, traces, real auth links or real Codex configuration are passed. The only login check reaches the fake executable.
- The existing fake helper normally writes an environment/MCP-token record. **Before any child starts**, its `record.json` is made a symlink to `/dev/null`. Never replace this sink or capture the fake record. Scratch roots are mode 0700; the harness checks for unexpected symlinks and nonempty CODEX_HOME before and after commands.
- Only known synthetic CLI arguments, exit codes, assertion booleans, generated IDs, scoped paths and the binary SHA are saved by the harness. The app's own synthetic database/logs remain under scratch. No real data directory, doctor/devices command, paid model, build, sync, flash, recording or remapper is used.
- Each installed child has a dedicated process group. Interrupt/timeout signals address only that owned group, including fake Codex descendants; there is no global process lookup or kill-by-name. `--exit-on-stdin-close` also scopes server lifetime to the harness.
- Scratch data is retained for inspection; there is no recursive cleanup or deletion of preexisting user data.

## Observed tooling checks (not release certification)

Source base/head: `6ba15e56f9f43fabafb3be1db31aa4c0e62a3db8`; committed tree: `63e5a5432ecafd1d9699fd9eff60b3b1b6b9cb01`. This worker changes only the harness and this note; no commits were made.

- The supplied stale worker path `/Users/bhekanik/code/planetaryescape/.worktrees/keyloom-agent-s54/dist/keyloom-darwin-arm64` was absent. The attempted prepare command exited 1 before creating scratch. It was not built as part of this work.
- Actual installed binary `/Users/bhekanik/.local/bin/keyloom` reports **0.41.1**, SHA-256 `3c519d305686c38ac207f35f9ba6c3564d39eb0b7ee2f1d96ee8565e9b253a10`. Prepare runs with scratch suffixes `keyloom-26a-smoke-installed-01` and `-02` under the temporary root above passed import, explicit autosync-off and deterministic real-CLI/fake-MCP chat. Both failed `conversations show` with exit **2**, classified as unknown command. This is an observed older-release limitation, not a skipped check or a 26a pass. Sanitized results remain in each scratch root.
- `--serve --browser-scenario completed` on session `-01` launched the actual installed server on an ephemeral loopback port and exited 0 after harness SIGINT. No browser interaction was performed. The server-results report does not overwrite the failed CLI report.
- Dedicated refusal checks used a synthetic sentinel in `keyloom-26a-smoke-refusal-01` and a link `keyloom-26a-smoke-link-01`. Both invocations exited 1; the sentinel and directory listing were unchanged. A third check temporarily linked an owned session's server-report path to the sentinel; reuse exited 1 without changing it, including on the error-reporting path. That test link was removed. The first installed session's CODEX_HOME remained empty, its record remained a null sink, and its root mode was 0700.
- Initial `bunx tsc --noEmit --pretty false` failed because this fresh worktree lacked `@types/bun`. After `bun install --frozen-lockfile --ignore-scripts`, the same typecheck passed. Inline TypeScript/simplification checks found no casts or relaxed compiler settings. `anti-slop-check` initially flagged the JSON helper's unknown return; parsing through a supplied Zod schema at that boundary fixed it, and the rerun passed.

**Remaining gate:** run prepare against the parent's final integrated compiled binary and the eventual installed release, using separate scratch roots. Then perform the actual browser completed-history and Stop journeys above. No final candidate build, full suite, browser screenshot gate, Stop journey, commit, push, merge, tag or deployment was performed here. Release-please and the orchestration ledger remain the parent's responsibility.
