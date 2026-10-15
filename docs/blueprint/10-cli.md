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
  emulate <layout> (--keys "<script>" | --script <file>) [--rev R] [--board-rev B]
                                           run the real firmware logic and print what the keyboard would send
  flash --reboot-only [--board B]          only restart the attached keyboard into its bootloader (keyloom firmware only)
  doctor                                   Docker, toolchain images, pinned checkouts, attached keyboard and its firmware, API key, database
```

`<board>` is a board ID, such as `zsa/moonlander` or `moergo/glove80`. `<layout>` takes the `lay_` ID or the layout's name, provided the name is unique.

## Emulate prints what a layout types for a sequence of key presses

`keyloom emulate g80 --keys "hold 39 300 then tap 30"` runs the layout's firmware on this machine and prints the HID reports the keyboard would send, with the time of each in ms from the first key, then the text a US text field would show, then the warnings: behaviours the emulator replaced because they need hardware ([06](06-firmware-zmk.md#emulate-runs-zmk-itself-on-the-host-with-a-mock-keyboard) has the list). It needs Docker, like `build`, and no keyboard. ZMK boards work today; QMK boards say "emulating QMK boards isn't available yet" until its emulator lands (exit 2).

```
   281 ms  LSFT
   300 ms  LSFT + U
   340 ms  LSFT
   360 ms  (nothing down)
text: "U"
```

`--format json` prints `{ layout_id, revision_id, firmware, reports, text, warnings, log_path }`; each report is `{ at, kind: "keyboard", mods, keys }` or `{ at, kind: "consumer", usages }`, with keyloom's own key names (`A`, `BACKSPACE`, `AUDIO_VOL_UP`) and modifier names (`LCTL LSFT LALT LGUI RCTL RSFT RALT RGUI`). `jsonl` prints one report per line. A failed emulation exits 7, like a build.

The key script (`src/firmware/emulate/script.ts`) numbers keys as the editor does (position + 1). Steps are separated by `then`, `;` or new lines, and `#` starts a comment in a `--script` file:

| Step | Meaning |
|---|---|
| `tap 31` | press key 31 and let go 40 ms later; the next step starts 20 ms after that |
| `tap 31+32` | press both together and let go together, for a chord or combo |
| `hold 31 [ms]` | press key 31 and keep it down; the next step starts `ms` later (default 400) |
| `release 31` | let go of a held key; keys still down at the end are released, last pressed first |
| `wait 200` | let 200 ms pass |
| `@500 tap 31` | start the step at 500 ms instead of right after the previous one |

`hold 31 300 then tap 32` holds key 31 for 300 ms, taps key 32 while 31 is down, then lets go of 31. The same text is in `keyloom emulate --help`.

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
