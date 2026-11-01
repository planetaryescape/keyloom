# 10: CLI

Status: CLI built, including layout export, layout settings, board geometry, provider selection and review-finding controls. The [audit closeout](../research/blueprint-audit-closeout.md) records verification. Use the installed version's `--help` to check availability.

The CLI is the canonical surface (D-030, taken from spotuify). Everything the web app can do, a `keyloom` subcommand can do, and both call the same core modules ([01](01-architecture.md)). The CLI is how coding agents check their own work while building keyloom, and how BK or an agent scripts it. A feature that exists only in the web app is incomplete.

## Command tree

Encoder turns use `setSensorBindings` through `change check`, `change propose` and `change apply`, not a separate encoder command. See [the scratch mouse/media recipe](../encoder-layers.md) for availability and a complete example.

```
keyloom
  serve [--port 4477] [--no-open]          start the local web app and open it in the browser (also: web)
                                           [--reuse | --replace] [--client-protocol N]   see Serving beside another keyloom
  boards list                              boards keyloom has definitions for
  boards show <board>                      physical keys, hands, firmware, build and flash recipe
  boards check <dir>                       validate a board definition (for contributors, 04)
  boards geometry <board-or-dir>           regenerate geometry.json from the pinned firmware tree
  keyboard detect [--search T]             the QMK and ZMK keyboards on USB: the board keyloom has, or ranked candidates with the reasons (22)
  keyboard add --candidate C [--home-row N] [--layout L] [--controller B]   derive a board from the firmware tree, check it, store it in the data directory
  keyboard put <layout> --on <board> [--name N]   map a layout onto that board as proposals on a new config; nothing is applied or flashed

  import --board <board> <file> [--name N] import an existing layout; prints the new layout ID and an import report
  layout list
  layout show <layout> [--layer L] [--rev R]   grid per layer, or the IR with --format json
  layout settings <layout> [--rev R]       the firmware settings the Settings page offers: value in force, default, stored or not, why forced (read only, D-459)
  layout export <layout> [--rev R] --out <file.json>
  layout upgrade <layout>                 read recognised kept Oryx colours and tap dances into the model

  change check <layout> --ops <file|->     validate ops against head; prints the ValidationResult (07)
  change propose <layout> --ops <file|-> --explain <text> [--reason <text>]   save an editor-style change set; --reason is remembered when it is applied
  change list <layout> [--status proposed]
  change show <cs>                         ops, explanation, trade-offs, validation, reminders
  change apply <cs>                        prints the decision it wrote, if any
  change reject <cs>
  undo <layout> [--rev R]                  undo the head; --rev asserts the expected head, not a restore target

  chat <layout> [--conversation C] [--select L:12,13,14] <message>
                                           one agent turn; streams the reply; prints any proposals
  conversations list <layout>
  conversations show <conversation>         stored public messages and working details
  agent show <run-or-request>               inspect saved work without executing it
  agent start <layout> <message> --request-id <id> [--conversation C] [--provider P]
  agent answer <run> <question-tool-id> <text> --request-id <id>
  agent cancel <run-or-request>             request Stop; committed preparation remains
  agent cancel <request-id> --request       save Stop even before the request is accepted
  provider status [--json]                 active provider/model and credential availability; no generation
  provider use <provider> [--model M]       save the default for new conversations in config.json
  review [layout] [--run] [--force] [--provider P]   show saved review; --run can call a model
  review fix [layout] [--provider P]        one agent run that fixes what the review found
  review dismiss|restore <item> [--layout L]   hide or restore a finding

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
  flash --reboot-only --board B --half H  ZMK: ask one half (left|right) to restart; the bootloader is not verified
  sync <layout> [--wait]                   build the head, flash it hands-free and check the keyboard came back running it
  sync status                              each board's state, and the config on its keyboard
  config list [--board B] [--archived]     a board's configs, marking the one on the keyboard
  config new <name> --from <config> [--rev R | --from-version V] | --from import <file> --board B | --blank --board B
  config rename|archive|restore <config> [name]   archive hides a config; it refuses the one on the keyboard
  config delete <config> <name>            name typed again; refuses the one on the keyboard
  config use <config> [--wait]             make it the config on the keyboard and sync it once
  version list <config>                    versions newest first, revisions folded under each
  version name <config> <revision|version> <name>
  version restore <config> <revision|version|name>   a new revision (the go-back path); not a sync
  version compare <config> <revision|version|name>   key-by-key diff against the head
  autosync on|off|pause|resume|status <board>   whether Apply puts the change on the board by itself
  remap <subcommand>                        MacBook kanata setup and management; see remap --help (21)
  doctor [--device-helper-only]            installed helper; normally also Docker, checkouts, keyboards, API key and database
```

`<board>` is a board ID, such as `zsa/moonlander` or `moergo/glove80`. `<layout>` takes the `lay_` ID or the layout's name, provided the name is unique.

`layout history` and `layout delete` were planned names, not implemented aliases. Use `version list <config>` for history and `config delete <config> <name>` for guarded deletion. `boards check --offline` checks local files without fetching the pinned geometry.

## Read a layout's firmware settings

```sh
keyloom --data-dir <scratch> layout settings <layout> [--rev <revision>]
```

One row per option the Settings page offers for the layout's board: `key`, plain `name`, the `value` the firmware gets (a forced value included; null, shown as `expression`, when the layout stores text such as `(TAPPING_TERM + 10)`, with the text in `source_text`), the `default` with no setting from keyloom, whether the layout `stores` it, and `forced_by` when something forces it, such as a Caps Word key turning on `CAPS_WORD_ENABLE`. `--format json` carries `layout_id`, `name`, `board_id`, `revision_id` and `settings`; jsonl prints one option per line; ids prints the keys. The command only reads. To change a value, send a `setFirmwareSetting` op through `change check` and `change propose` ([D-459](14-decision-log.md)).

## Export a layout and import it as a new config

```sh
keyloom --data-dir <scratch> layout export <layout> --out <unused-file.json>
keyloom --data-dir <scratch> config new <new-name> --from import <unused-file.json> --board <same-board>
```

Export writes a JSON envelope with `kind: "keyloom-layout"`, `schema_version: 1`, `board_id`, `layout_name`, `revision_id` and the complete `layout` IR. `--rev` chooses a stored revision; otherwise it reads the head. The parent folder must exist. Writing uses a temporary sibling and rename, replacing an existing target file only after the new document is complete, so choose a new filename when keeping an older export.

`import --board <same-board> <file.json>` also reads this format. Unknown format versions, malformed documents and board mismatches refuse. Reimport starts a new config/history: the informational revision ID does not import conversations, decisions, old revisions or build artifacts. This is a keyloom document, not a QMK/VIA or vendor-editor export.

## Inspect saved agent work before continuing it

```sh
keyloom --data-dir <scratch> --format json agent show <run-or-request-id>
keyloom --data-dir <scratch> conversations show <conversation-id>
```

These reads do not launch a model or repeat a tool. The run snapshot includes its status, sequence, cancellation request and committed preparation references. An interrupted run is not automatically retried.

Use a fresh request identity for intentional new work. `start` and `answer` wait for work owned by that CLI process; repeating the same identity with exactly the same scope/input returns its original run instead of executing again. Changed input with an existing identity refuses. A configured model provider is required to start new work.

```sh
keyloom --data-dir <scratch> agent start <config> 'Explain this layout' --request-id <unique-request-id>
keyloom --data-dir <scratch> agent answer <run> <question-tool-id> Left --request-id <unique-answer-id>
```

A run that stops on a question prints the question, its options and the `keyloom agent answer …` line in table format, whether it is a copy's target or the run the command started; then the turn is BK's to answer.

Stop is explicit and does not roll back saved configs, proposals or memory. `agent cancel <run-or-request>` requests cancellation of accepted work; `--request` can also persist cancellation before acceptance. Its `pending_acceptance` result is an intent, not an invented run. A live foreign owner observes the request; only its recorded terminal result confirms it stopped. The [26b contract](../research/spikes/26b-contract.md) specifies the wire shapes and fail-closed pending-Stop limit. Legacy `chat` retains stream-owned execution for ordinary conversations; copies use the bounded handoff coordinator (D-460).

## The typing lab records your typing and tunes the board to it

When a saved session has an interruption warning, `keyloom lab sessions` shows `incomplete` and `warnings` in JSON/JSONL and marks the table row `incomplete`; analysis refuses the partial trace before replay or proposals. The native-helper candidate verified this interruption path for QMK. ZMK capture gives the same guarantee on the legacy serial transport (D-429); the Rust serial backend and physical S59 serial evidence remain 24d work.

`keyloom lab start g80` prints what it records (which key, when, and what you type in this terminal), that it stays on this Mac, and how to delete it, then shows the passage and your typed text until Ctrl-C. It needs a keyboard running a keyloom build (the Moonlander over raw HID, the ZMK boards over the module's serial port), and says what to do when there is none. In JSON and JSONL formats the notice is printed on stdout with the passage, before capture starts, so stderr holds only an error document and the result is the one JSON document at the end of stdout. Table mode keeps the notice on stderr. `keyloom lab analyse typ_…` replays the recording through the layout's firmware logic in Docker, prints what went wrong per finger, and stores each setting change that clearly helps as a proposed change set with the counts from the recording; `--no-propose` prints them without storing. JSON has the counts, findings, per-finger rows and each suggestion's evidence and ops, never the passage or the typed text. [24](24-typing-lab.md) has the design.

## Emulate prints what a layout types for a sequence of key presses

`keyloom emulate g80 --keys "hold 39 300 then tap 30"` runs the layout's firmware on this machine and prints the HID reports the keyboard would send, with the time of each in ms from the first key, then the text a US text field would show, then warnings for hardware behaviours the emulator replaced. Both [QMK](05-firmware-qmk.md#emulate-runs-the-generated-keymap-on-qmks-own-core) and [ZMK](06-firmware-zmk.md#emulate-runs-zmk-itself-on-the-host-with-a-mock-keyboard) emulation are built. They need Docker, like `build`, and no keyboard. The CLI does not offer kanata emulation (exit 2); the separate kanata simulator is used by tests.

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

`keyloom sync status` prints a row per board that has a layout: `{ board_id, board_name, layout_id, layout_name, config_id, config_name (the config on the keyboard), other_configs, head_revision_id, state, step, changes, why, error, instruction, reason, detail, auto_sync: { on, choice, paused, proven, proven_at }, last_sync }`. `state` is `in_sync`, `syncing`, `behind`, `needs_hand`, `not_connected` or `not_keyloom`. It reads USB, so it is the keyboards as they are now. It exits 0 whatever it finds.

`keyloom autosync on|off|pause|resume|status <board>` prints `{ board_id, auto_sync: "on"|"off", choice, paused, proven, proven_at }`. `on` before a flash keyloom did by itself was verified is exit 2, with how to get one. The choice lives in the database, so a running `keyloom serve` sees it at its next look.

## review shows what keyloom found in a config

`keyloom review [layout]` prints the newest review of the config in plain words: problems, suggestions, hints, what the last revision fixed, what was checked and how the agent's part went. `--run` makes the head's review now and waits for the agent (it needs a model provider; the checks run without one), `--force` runs the agent again on a revision it already looked at, `--provider` picks the model as for `chat`. JSON is `{ layout_id, head_revision_id, stale, review }`, where `review` is null before any, and otherwise `{ id, layout_id, revision_id, trigger, checked_at, checks, ai: { status, reason, model }, items: [{ id, source, kind, severity, code, title, body, keys, layers, proposal_id, fixes, dismissed_at }], fixed }`; `title` and `body` keep the `{key:…}` and `{layer:…}` markers. `--format ids` prints the item ids. [27](27-board-review.md) has the design.

`review fix [layout]` starts one agent run on the config with the same request the review panel's **Fix issues** button sends, and follows it like `agent start`: a run that stops on a question prints the question and the `keyloom agent answer …` line. The findings are not pasted into the request; the agent reads them with its `get_review` tool, so they cannot be out of date with the stored review, and it answers with one validated change that reuses any suggestion still on the board. It refuses before calling a model when the config has no review or nothing is left to fix (hidden findings do not count). `--json` prints the run snapshot; `--provider` picks the model as for `chat`.

`review dismiss <item> --layout <config>` hides a finding; `review restore` shows it again. Neither runs a model. `--layout` may be omitted only when there is one saved config. `review show` is the explicit form of the default read, and `--json` forces JSON output.

`provider status` (also bare `provider`) reports `{ active, locked_by, providers }`; `active` carries provider, model and effort or is null. `provider use <provider> [--model <model>]` saves a default without generating text. Existing conversations stay pinned; a flag or `KEYLOOM_PROVIDER` can override the saved choice. Both accept `--json`. This checks availability, not whether an API key is accepted; `doctor` performs the credential read.

## config and version keep several layouts per board and go back to old ones

A config is a layout. Each board has one config on its keyboard (D-300); `keyloom sync <config>` refuses any other and names `keyloom config use`. All JSON carries `schema_version`.

- `config list` prints `{ configs: [{ id, name, board_id, board_name, head_revision_id, created_at, updated_at, on_keyboard, archived_at, copied_from: { layout_id, layout_name, revision_id } | null }] }`. `config new|rename|archive|restore` print `{ config }`; `delete` prints `{ deleted: { id, name } }`. A taken name, a missing source and the refusals above are exit 2 or 3.
- `config use` prints what `sync` prints, and has `sync`'s exit codes. The keyboard must be attached and running keyloom firmware, or it is exit 2 and the choice is unchanged. `config new` takes `--from-version`, not `--version`, which is the program's own flag. `--blank` starts from the board's firmware default keymap where keyloom can read one, else the empty Base layer, and `config new` prints the note saying which and why (JSON: `note`). `--from import <file> --board B` reads a file with the importers `keyloom import` runs (D-370, D-371).
- `version list` prints `{ layout_id, head_revision_id, pending: [revision], versions: [{ id, revision_id, name, put_on_at, ended_at, current, summary, created_at, revisions: [revision] }] }`. `pending` is revisions newer than the newest version. A version with `put_on_at: null` was named without being put on a keyboard.
- `version compare` prints `{ layout_id, from, to, same, keys: [{ layer_id, layer_name, position, before, after, before_label, after_label }], layers_added, layers_removed, layers_renamed, layers_reordered, lighting, macros, tap_dances, combos, hold_tap_profiles, settings, passthrough }`. `before` is the revision's binding and `after` the head's.
- `version restore` prints `{ revision_id, restored_revision_id }` (exit 4 for a rule it would break, exit 2 for no change). It creates a new head revision; there is no CLI `undo --to` flag. A running server may auto-sync the restored head, so restore is not a hardware-safe read on real data.

## doctor checks the installed helper without opening a keyboard

```sh
keyloom --data-dir /tmp/keyloom-doctor-scratch doctor --device-helper-only
keyloom --data-dir /tmp/keyloom-doctor-scratch doctor --device-helper-only --format table
```

The flag skips database, provider, Docker, USB/serial discovery and remapper probes. Without it, doctor keeps those checks and adds the helper row. A successful helper check verifies the embedded manifest/hash, exact release/protocol/target handshake, ping, shutdown acknowledgement and observed child exit. It does not check device permissions or enumerate keyboards.

JSON retains `{ schema_version, ok, checks }`. The `device helper` row adds `deviceHelper: { available, hostVersion, protocol, target, capabilities, helperVersion?, helperSha256?, code? }`. Successful diagnostics advertise `capabilities: []`. A source/dev invocation has no helper asset: it reports `not_bundled` as a warning, without starting a process.

An invalid installed pair sets `ok: false` and exits 1, matching doctor's existing failed-check convention. Stable helper codes are `version_mismatch`, `integrity_error`, `unsafe_cache`, `protocol_error`, `timeout`, `helper_exited` and `helper_unavailable`. The helper exchange has a two-second deadline; cleanup has separate bounded waits and terminates a stalled child. Error output contains no helper payload or stderr text.

Inspect the selected cache before repairing it:

```sh
keyloom --version
ls -ld "${XDG_CACHE_HOME:-$HOME/.cache}/keyloom/device-helper"
```

Use a user-owned, nonsymlink cache that other users cannot write. Reinstall the matching keyloom release for a wrong/missing pair. If that release's extracted cache was changed, remove only its named release directory and retry; keyloom re-extracts its embedded bytes, never downloads or searches for another helper. Import/editing remains available after a helper failure. See [build and packaging reference](../../native/device-helper/README.md).

## Global flags

- `--format table|json|jsonl|ids`. The default is `table` on a TTY, and `json` otherwise. JSON output carries `schema_version`, so agents can depend on its shape. `ids` prints one ID per line for piping.
- `--data-dir <path>` overrides `$XDG_DATA_HOME/keyloom`. Tests and agents use a scratch directory so they never touch BK's real layouts.
- `--quiet`, `--verbose`.

## Output contract

- Every command that creates something prints its ID first, in table mode and in JSON.
- `layout show` in table mode prints each layer as a grid placed by the board's physical rows, the same rendering the agent gets from `get_layout` ([03](03-agent.md#tools)). What the agent sees and what a human debugging it sees are the same text.
- `chat` streams assistant text to stdout as it arrives. With `--format json` it prints one final object: `{ conversationId, messageIds, proposals: [{ changeSetId, title, validation }] }`.
- A reply may name a config, a proposal, a layer or a key with a typed marker (D-468). `chat` writes the name in table mode and keeps the marker itself in `text` under `--format json`, exactly as stored; see [What a reply names](#what-a-reply-names).

## Serving beside another keyloom

One server serves a data directory (D-323). `serve --reuse` attaches to a live one and exits 0 (the desktop app uses it). `serve --replace` stops it with SIGTERM, waits for its process to exit (it finishes a keyboard write first; it is never killed; the lock wait and this wait share two minutes), and serves from this keyloom; it is refused when the live server is newer, and `--reuse` and `--replace` are exclusive. `serve --client-protocol N` is the desktop app saying which protocol it was built for (`DESKTOP_PROTOCOL`, 1): a keyloom that speaks another refuses to start, and `--reuse` with it refuses a live server whose `serve.json` `protocol` differs, or is missing, by printing `keyloom cannot attach: …` (and `keyloom can replace it: …` when the server is older or unknown) and exiting 10. Without `--client-protocol`, `--reuse` attaches to any live server. Every `serve` first takes a lock in the data directory (`serve.lock`) until its server has announced itself, so concurrent starts take turns. `serve.json` records `version` and `protocol`.

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
| 10 | Incompatible keyloom: the data directory's database was migrated by a newer keyloom (`schema_too_new`), `serve --client-protocol` names a protocol this keyloom doesn't speak (`client_protocol_mismatch`), or the server already running can't be used (`server_incompatible`) (D-454, D-455) |

## Agent skill

The repo ships `skills/keyloom/SKILL.md`, so coding agents and BK's own agents can drive keyloom through the CLI. It covers the loop, which is to `import`, `layout show`, `change check`, `change propose` and `change apply`. It also covers the `--data-dir` rule for tests, and the rule that `flash` is never run without BK asking, because it rewrites the keyboard he types on. There's no MCP server, which follows BK's standing preference for a CLI plus a skill.

## Continue a copied setup on its target

```sh
keyloom --data-dir <scratch> agent start <config> 'Put my source setup on this board' --request-id <copy-request>
keyloom --data-dir <scratch> agent show <target-run> --format json
keyloom --data-dir <scratch> conversations show <target-conversation> --format json
keyloom --data-dir <scratch> agent answer <target-run> <question-tool-id> 'Use the inner thumb' --request-id <answer-request>
```

A successful copy returns the original source run with `handoff: { layoutId, conversationId, runId, requestId }` identifying its separate target. The command waits for the target's owned work before exiting. Table output names the target question and answer command; JSON stays one source snapshot. Repeating the original request ID returns those same artifacts.

Legacy one-shot `chat` follows the handoff and returns the target outcome, including `question` when waiting and the original `configs_made`. `copy_source` reports the source turn's model, usage and any reported cost separately from the target outcome, so the two turns are not added twice. Interactive chat continues on that target layout and conversation. Ordinary legacy chats retain stream ownership; only a copy enters the durable handoff coordinator. Applying the target proposal and selecting its config for the keyboard remain separate actions.

## The copy report

`chat` on a copy and `keyboard put` print the report the app's card shows, from the same artifact (D-467). `chat` adds one line the card leaves out, because a terminal has no navigation (the card sits in that conversation already):

```
Moonlander -> Corne
156 keys came across on 6 layers, 15 of them nearest-place guesses
  Layer 0: 42 carried, 6 guessed, 30 left off
  Layer 1: 33 carried, 27 left off
  ...
112 keys did not come across:
  F1 (left pinky, function row, outer) (Layer 0): the new board has no key in this place
  ...
  and 104 more
8 combos copied
4 layer keys had nowhere of their own and were placed on free keys
2 layer keys could not be placed: the layer has no way back on this board
left out:
  LED colours were not carried: ...
  5 firmware settings on Moonlander daily (timings, features) were not carried; set them for this board once it works
  firmware code keyloom does not model (passthrough) was not carried
adapting it continues in the new config's own conversation
```

`chat` prints it once, after the copy's own reply, and `--format json` adds it as `transfer_report`. `keyboard put` prints it for the plan it made instead of the old `N keys did not come across (reasons)` line, with the per-key lines bounded to the first eight drops and "and N more"; it has no conversation, so the last line is left out. The JSON for `keyboard put` is unchanged and still carries the plan itself (`layers`, `not_carried`, `combos`, `notes`).

## What a reply names

A reply names a config, a proposal, a layer or a key with a typed marker instead of the name: `{config:<config id>}`, `{proposal:<change set id>}`, `{layer:<layer id>}`, `{key:<layer id>:<position>}` (D-468). The marker carries an id, so the client draws the name; the stored message keeps it, and an older keyloom shows the marker text, which is why it stays short.

In table mode `chat` writes the name on the stream, while the reply arrives: a marker can be split across two deltas, so an open `{` holds the text back until it closes, and a backtick that may still open a code span holds the same way (at most 64 characters each; a brace or backtick that never closes is printed as it came, a lone backtick being just a character). What it writes is a layer's name, what the key prints, a config's name, a proposal's title; a marker whose id names nothing keyloom still holds keeps the id as words, and one inside backticks stays as typed — in the stream and in the route lines alike, because a code span is code everywhere a reply is read. After the reply, one line per reference that has a command, and nothing for a layer or a key, because the board is their surface:

```
Saved it on Glove80 copy, the Layer 2 layer, and the ⌫ key. The change is on the board.
to open it: keyloom config use lay_01M65JGHPMH04G6XWDXBKF9QR3
to review it: keyloom change show cs_01M65JJX62REZ96VCR35FPNRD2
```

`--format json` is unchanged: `text` is the reply the model wrote, markers included, because a machine reader can resolve them itself and the stored message is the same text. The web draws a link on each marker that names something live ([28](28-agent-experience.md#results-use-app-owned-views-instead-of-prose-imitations)).
