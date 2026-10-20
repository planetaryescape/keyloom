---
name: keyloom
description: Drive the keyloom keyboard configurator through its CLI to inspect layouts, prepare validated changes, export configs, or inspect saved agent work. Use for keyloom tasks; hardware writes require explicit session permission.
---

# Drive keyloom through the CLI

## Establish the target

1. Run `keyloom --help` and the relevant subcommand's `--help` on the installed version. From a source checkout, substitute `bun src/cli/main.ts` for `keyloom`.
2. For tests, examples and agent verification, choose a new scratch data directory and pass `--data-dir <scratch>` on every command. Use the user's real data only when the task explicitly requires it.
3. Inspect `boards list`, `boards show <board>` and `layout list`, then `layout show <layout>`. Prefer IDs when names are ambiguous. `--format json` includes the IR and a `schema_version`; positions in ops are zero-based.

```sh
keyloom --data-dir <scratch> import --board moergo/glove80 <layout.keymap>
keyloom --data-dir <scratch> --format json layout show <layout-id>
```

## Prepare, validate, then apply

Read the head revision and current bindings before writing an ops JSON array. Preserve displaced functions, or use a deliberate `dropFunction` with the user's reason. Keep imported native source intact.

```sh
keyloom --data-dir <scratch> --format json change check <layout-id> --ops <ops.json> --base <head-revision-id>
keyloom --data-dir <scratch> change propose <layout-id> --ops <ops.json> --explain '<what changes>' --reason '<why>'
keyloom --data-dir <scratch> change show <change-set-id>
```

Continue only when the check is valid and the warnings, displaced functions and remembered reasons have been reviewed. Show the proposal and obtain approval before applying to user data. Apply revalidates against the current head; exit 5 means the base is stale, so reread and recheck rather than retrying blindly.

```sh
keyloom --data-dir <scratch> change apply <change-set-id>
keyloom --data-dir <scratch> layout show <layout-id>
keyloom --data-dir <scratch> version list <layout-id>
```

An Apply, undo or version restore on an active config can trigger a running server's auto-sync. A scratch directory with no proven board is the safe verification target. Do not start `serve` on real data just to inspect a layout.

## Read, export and recover without hardware

- `layout export <layout> [--rev <revision>] --out <file.json>` writes the versioned keyloom layout document. Reimport with `import --board <same-board> <file.json>` or `config new <name> --from import <file.json> --board <same-board>`. This copies the layout, not its conversations, decisions or history.
- `version list`, `version compare` and `version restore` replace the old planned `layout history` workflow. Restore creates a new head revision; account for auto-sync before using it on real data. `undo --rev` expects the current head, not an arbitrary restore target.
- `agent show <run-or-request>` and `conversations show <conversation>` inspect saved work without starting a model. `chat`, `agent start`, `agent answer` and `review --run` can spend provider credits; run them only when authorized.
- `boards check <folder> --offline` checks local board data without fetching firmware. Omit `--offline` only when the task permits fetching pinned geometry.

## Hardware permission

Never flash a keyboard unless the user explicitly asks in this session. This includes `flash --build`, bootloader-only restarts, `sync`, `config use`, enabling auto-sync and MacBook remapper writes/reloads. A past permission or a proposed change is not permission to write hardware now. Stop at a checked proposal or generated source when permission is absent.

When hardware work is explicitly authorized, read the board's recipe and command help first; explain the target config/revision, existing auto-sync state and recovery path. See [the CLI reference](../../docs/blueprint/10-cli.md) and [recovery limits](../../docs/blueprint/11-observability-and-evals.md#recovering-from-a-bad-flash).
