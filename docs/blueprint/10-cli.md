# 10: CLI

The CLI is the canonical surface (D-030, taken from spotuify). Everything the web app can do, a `keyloom` subcommand can do, and both call the same core modules ([01](01-architecture.md)). The CLI is how coding agents check their own work while building keyloom, and how BK or an agent scripts it. A feature that exists only in the web app is incomplete.

## Command tree

```
keyloom
  serve [--port 4477] [--no-open]          start the local web app and open it in the browser
  boards list                              boards keyloom has definitions for
  boards show <board>                      physical keys, hands, firmware, build and flash recipe
  boards check <dir>                       validate a board definition (for contributors, 04)

  import --board <board> <file> [--name N] import an existing layout; prints the new layout ID and an import report
  layout list
  layout show <layout> [--layer L] [--rev R]   grid per layer, or the IR with --format json
  layout history <layout>                  revisions, newest first
  layout export <layout> [--rev R] --out <file.json>
  layout delete <layout>

  change check <layout> --ops <file|->     validate ops against head; prints the ValidationResult (07)
  change propose <layout> --ops <file|-> --explain <text> [--reason <text>]   save an editor-style change set; --reason is remembered when it is applied
  change list <layout> [--status proposed]
  change show <cs>                         ops, explanation, trade-offs, validation, reminders
  change apply <cs>                        prints the decision it wrote, if any
  change reject <cs>
  undo <layout> [--rev R]                  undo the head revision (or R)

  chat <layout> [--conversation C] [--select L:12,13,14] <message>
                                           one agent turn; streams the reply; prints any proposals
  conversations list <layout>

  decisions list <layout> [--status S] [--kind choice|priority]
  decisions show <dec>
  decisions edit <dec> [--goal …] [--choice …] [--reason …] [--status …]
  decisions retire <dec>
  decisions outcome <dec> --status tried_helpful|tried_unhelpful --note <text>
  decisions due <layout> [--now <time>]    choices a week old that have not been asked about (Q6)
  decisions dismiss <dec>                  stop asking whether it worked out

  generate <layout> [--rev R] [--board-rev B] --out <dir>  write firmware source without building
  build <layout> [--rev R] [--board-rev B] generate and build; prints the build ID and artifact path
                                           (--board-rev reva|revb; detected from a connected keyboard when omitted)
  flash [--build B] [--layout L]           flash the newest successful build of L, or B
  flash --reboot-only [--board B]          only restart the attached keyboard into its bootloader (keyloom firmware only)
  doctor                                   Docker, toolchain images, pinned checkouts, attached keyboard and its firmware, API key, database
```

`<board>` is a board ID, such as `zsa/moonlander` or `moergo/glove80`. `<layout>` takes the `lay_` ID or the layout's name, provided the name is unique.

## Global flags

- `--format table|json|jsonl|ids`. The default is `table` on a TTY, and `json` otherwise. JSON output carries `schema_version`, so agents can depend on its shape. `ids` prints one ID per line for piping.
- `--data-dir <path>` overrides `$XDG_DATA_HOME/keyloom`. Tests and agents use a scratch directory so they never touch BK's real layouts.
- `--quiet`, `--verbose`.

## Output contract

- Every command that creates something prints its ID first, in table mode and in JSON.
- `layout show` in table mode prints each layer as a grid placed by the board's physical rows, the same rendering the agent gets from `get_layout` ([03](03-agent.md#tools)). What the agent sees and what a human debugging it sees are the same text.
- `chat` streams assistant text to stdout as it arrives. With `--format json` it prints one final object: `{ conversationId, messageIds, proposals: [{ changeSetId, title, validation }] }`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unexpected error (a bug). The message includes the log path |
| 2 | Usage error: bad flags or arguments |
| 3 | Not found: layout, revision, change set, decision, build or board |
| 4 | Validation failed: `change check` or `change apply` found errors. The JSON body has them |
| 5 | Stale base: the head moved since the change set was proposed |
| 6 | Toolchain unavailable: Docker isn't running, or a pinned checkout is missing |
| 7 | Build failed |
| 8 | Flash failed or timed out waiting for the bootloader |
| 9 | Model API error: auth, rate limit or refusal after fallback |

## Agent skill

The repo ships `skills/keyloom/SKILL.md`, so coding agents and BK's own agents can drive keyloom through the CLI. It covers the loop, which is to `import`, `layout show`, `change check`, `change propose` and `change apply`. It also covers the `--data-dir` rule for tests, and the rule that `flash` is never run without BK asking, because it rewrites the keyboard he types on. There's no MCP server, which follows BK's standing preference for a CLI plus a skill.
