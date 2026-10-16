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
  lab passages <layout>                    the passages the typing lab can ask for, built from the layout's own home row
  lab start <layout> [--passage P | --text T]  record the connected keyboard while you type a passage; Ctrl-C ends it
  lab analyse <session> [--no-propose] [--max-runs N] [--show]  replay it, say what went wrong per finger, try other settings on it
  lab sessions [layout]                    recorded sessions, newest first
  lab delete <session>                     delete a session with its recording and what you typed
  flash ... --wait <minutes>                how long to wait for a bootloader key press (1 to 60, default 2)
  flash --reboot-only [--board B]          only restart the attached keyboard into its bootloader (keyloom firmware only)
  sync <layout> [--wait]                   build the head, flash it hands-free and check the keyboard came back running it
  sync status                              each board's state: in sync, syncing, behind, needs a hand, not connected, not keyloom's
  autosync on|off|pause|resume|status <board>   whether Apply puts the change on the board by itself
  doctor                                   Docker, toolchain images, pinned checkouts, attached keyboard and its firmware, API key, database
```

`<board>` is a board ID, such as `zsa/moonlander` or `moergo/glove80`. `<layout>` takes the `lay_` ID or the layout's name, provided the name is unique.

## The typing lab records your typing and tunes the board to it

`keyloom lab start g80` prints what it records (which key, when, and what you type in this terminal), that it stays on this Mac, and how to delete it, then shows the passage and your typed text until Ctrl-C. It needs a keyboard running a keyloom build (the Moonlander over raw HID, the ZMK boards over the module's serial port), and says what to do when there is none. `keyloom lab analyse typ_…` replays the recording through the layout's firmware logic in Docker, prints what went wrong per finger, and stores each setting change that clearly helps as a proposed change set with the counts from the recording; `--no-propose` prints them without storing. JSON has the counts, findings, per-finger rows and each suggestion's evidence and ops, never the passage or the typed text. [24](24-typing-lab.md) has the design.

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

## sync and autosync put the head on the keyboard

`keyloom sync <layout>` runs one sync in the foreground: it builds the head revision (or flashes the build it already has for it), restarts the keyboard into its bootloader itself, writes it, and waits until the keyboard comes back running that build. Progress goes to stderr; the result goes to stdout.

- It never replaces firmware keyloom didn't build (exit 2, naming `keyloom build` and `keyloom flash --layout`), and it needs the keyboard attached (exit 2).
- A failed build is exit 7. A failed flash, a flash that can't be verified, a flash that needed a key pressed and didn't get one, and a keyboard unplugged midway are exit 8. A keyboard already running the head is exit 0 with `status: "in_sync"`.
- Another sync running (the server's) is exit 2. `--wait` waits for it to end first.
- `--format json` prints `{ status: "synced"|"in_sync", board_id, layout_id, revision_id, sync_id, build_id, flash_id, timings_s: { wait, build, flash, apply_to_verified } }`. The times are in seconds, from the Apply that made the head.

`keyloom sync status` prints a row per board that has a layout: `{ board_id, board_name, layout_id, layout_name, head_revision_id, state, step, changes, why, error, instruction, reason, detail, auto_sync: { on, choice, paused, proven, proven_at }, last_sync }`. `state` is `in_sync`, `syncing`, `behind`, `needs_hand`, `not_connected` or `not_keyloom`. It reads USB, so it is the keyboards as they are now. It exits 0 whatever it finds.

`keyloom autosync on|off|pause|resume|status <board>` prints `{ board_id, auto_sync: "on"|"off", choice, paused, proven, proven_at }`. `on` before a flash keyloom did by itself was verified is exit 2, with how to get one. The choice lives in the database, so a running `keyloom serve` sees it at its next look.

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
