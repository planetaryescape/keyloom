# keyloom: project context for AI agents

keyloom is an open-source, local-first keyboard configurator. You describe a frustration with your layout, an agent proposes validated changes you can preview on the keys, and keyloom builds the firmware and puts it on the keyboard. It runs on QMK boards (ZSA Moonlander), ZMK boards (MoErgo Glove80, foostan Corne, Keebart Corne Choc Pro BT) and the MacBook's built-in keyboard through kanata. It is a bun web app on localhost plus a CLI. There is no hosted backend.

The code is built and released (v0.65.0 at the time of writing). The blueprint in `docs/blueprint/` is the design it follows and the record of why. `docs/blueprint/13-roadmap.md` says what each rung shipped in and what was checked on hardware. If the code and a document disagree, the code is current. Fix the document.

## Where to start

1. `README.md` for what a user sees.
2. `docs/blueprint/README.md` for the reading order, then the chapter for the area you are touching. Each chapter's status line says what is built.
3. `docs/blueprint/14-decision-log.md` before you change a direction. Most alternatives were considered and rejected there, with reasons.
4. `docs/blueprint/15-open-questions.md` for spikes and product questions, and `docs/research/` for the evidence behind them.
5. `CONTRIBUTING.md` and `.claude/skills/add-keyboard/SKILL.md` to add a board.
6. Before changing HID/serial transports or native-helper packaging, read `docs/blueprint/31-device-helper.md` through `33-device-helper-platforms.md` and `docs/research/rust-device-helper.md`. Apple Silicon releases select the combined native HID/serial helper (D-433); Intel and Linux retain legacy transports and diagnostics-only helpers until their own hardware evidence. The platform plan grants no hardware access.

## Stack

- TypeScript (strict, ESM) on bun 1.3.14. React 19 served through Bun's HTML imports. `bun:sqlite`, zod, commander, ulid, fflate.
- `web-tree-sitter` with the C and devicetree grammars, to import Oryx's C and ZMK keymaps.
- The agent runs on one of three providers behind `AgentModel`: Anthropic (`@anthropic-ai/sdk` Tool Runner, `claude-opus-5-5`), OpenRouter, or the Codex CLI through a loopback MCP server (`@modelcontextprotocol/sdk`).
- QMK firmware builds in Docker from ZSA's fork, and flashes with Zapp (Moonlander). ZMK builds in Docker, either MoErgo's template (Glove80), `west build` against upstream ZMK (foostan Corne and derived boards), or a pinned hardware module (Keebart Corne). UF2 boards flash by copying to each half's boot drive.
- Apple Silicon release CLI and desktop sidecar use one paired Rust helper for HID and serial, including 1200/1201-baud touch. Intel Macs and Linux keep the legacy TypeScript transports and diagnostics-only helper (D-433).
- Hands-free flashing: the Moonlander restarts into its bootloader over raw HID. ZMK boards run keyloom's `keyloom-zmk` module (`firmware/zmk/keyloom-zmk`), which restarts a half when its serial port is closed at 1200 baud.
- The MacBook keyboard is a board whose "firmware" is a kanata config. Apply writes it and reloads kanata over TCP.
- Tests: `bun test` and `fast-check`. Releases: release-please, then `bun build --compile` binaries, then `install.sh`.
- Licence: AGPL-3.0-or-later (D-342; `LICENSE`). Contributions come in under the same terms.

## Where things live

`src/` is split by job, and `.dependency-cruiser.cjs` enforces which folder may import which (the module table in `docs/blueprint/01-architecture.md`).

| Folder | Job |
|---|---|
| `src/layout/` | The firmware-neutral layout model, change ops, keycodes, colours. Pure. |
| `src/validation/` | The validator: errors, reachability, warnings. Pure. |
| `src/boards/` | Board definitions, geometry, recipes, and board derivation for new keyboards (`derive/`) |
| `src/firmware/` | `qmk/`, `zmk/`, `kanata/` generators, importers and flashers; `toolchain/` (Docker, USB, UF2); `emulate/` |
| `src/agent/` | Prompts, tools, providers (`anthropic-model.ts`, `codex-model.ts`), the turn loop |
| `src/memory/` | Decisions and their outcomes |
| `src/lab/` | Typing lab analysis |
| `src/persistence/` | SQLite schema and migrations |
| `src/app/` | The use cases the CLI and server both call: changes, firmware, sync engine, board review, configs |
| `src/api/` | The HTTP wire contract shared by server and web |
| `src/server/` | The localhost server, routes and event stream |
| `src/cli/` | The `keyloom` command and its subcommands |
| `src/web/` | The React app, by screen (`card/`, `chat/`, `sync/`, `lab/`, `review/` and so on) |

Elsewhere: `boards/` holds one data folder per board (no code), `firmware/zmk/` the ZMK module, `infra/glove80/` the Glove80 build image, `evals/` the live agent scenarios, `test/` mirrors `src/` with fakes in `test/helpers/`, and `scripts/` the generators and dev servers. `docs/blueprint/` is the design, `docs/research/` the evidence, `docs/issues/` the issue tracker.

## Run, test, build

- `bun install`, then `bun src/cli/main.ts <command>` runs the CLI from the clone. `bun src/cli/main.ts serve` starts the app. `bun scripts/dev-editor.ts` runs the editor over a fake backend, with no Docker or keyboard, on the synchronized Oryx layout (`test/fixtures/oryx/synchronized`) and the live Moonlander board.
- `bun test` runs the suite. The preload in `bunfig.toml` blocks real flashing, real credentials and paid models. `bunx tsc --noEmit` type-checks. `bun run depcruise` checks the module table. CI runs all three.
- Live agent evals in `evals/scenarios/` are skipped unless a provider credential is set. `KEYLOOM_EVAL_PROVIDER=anthropic|openrouter|codex` picks the provider. They cost money.
- Docker tests are gated by `KEYLOOM_DOCKER_TESTS`.
- `bun run gen:keycodes` and `bun run gen:keyboard-index` regenerate checked-in tables.
- Release binaries come from `bun run scripts/build-binaries.ts`. The importer and the web app work in the compiled binary because of how they import `.wasm`, SQL and `boards/` (S10). Don't replace those imports with paths built from `import.meta`.

## Rules

- **The blueprint is the spec, and the decision log is its history.** If you change a decision, add a new entry to `14-decision-log.md` that replaces the old one. Don't drift silently. Update the chapter's status line when you build or drop something.
- **Check the ledger before building on a spike.** `15-open-questions.md` lists each spike, its result and the rung it blocks. Record new evidence in `docs/research/spikes/`, including what was not observed.
- **Every feature is in the CLI** (D-030). Verify your work by driving the installed `keyloom` binary, with `--data-dir` pointing at a scratch directory unless BK says otherwise, not only through unit tests.
- **Never flash BK's keyboard unless he asks in this session.** A bad flash takes away the keyboard he types on. Building is fine. Auto-sync is on for his Glove80, so a `keyloom serve` or `sync` on his real data directory can flash it on an Apply. Use a scratch data directory.
- **The agent proposes; the validator decides** (D-014). No code path may apply a change set that hasn't passed `validate` against the current head.
- **`src/layout/` and `src/validation/` stay pure.** `dependency-cruiser` enforces it.
- **Reuse before rewriting.** Read the reference implementations in `docs/research/` (keymap-editor, keymap-drawer, ZSA's Zapp, MoErgo's template) before inventing a parser, renderer or flasher. Check each licence before copying, and keep an `// Adapted from <repo> <path> @ <sha>` comment on anything copied.
- **UI work starts from the design concept** (`docs/blueprint/23-design-concept.md`) and passes the screenshot gate in `18-visual-design.md`. No emoji as icons; use the icon library.
- **Personal data stays out of the repo.** The repo is public. Test fixtures are synthetic or BK's published layouts. Typing recordings never go to a model.
- Commits use `type: description`, with BK as the only author and no co-author lines.

## Releases

release-please owns versions, tags and `CHANGELOG.md`. Never push a tag by hand.

1. Land work on `main` with conventional commits (`feat:`, `fix:`, `docs:`).
2. release-please opens or updates a release PR. The default token starts no `pull_request` run for it, so `release.yml`'s `ci-on-release-pr` job dispatches `ci.yml` on the PR branch. The merge gate is that dispatched run's success on the PR head.
3. Merging the PR tags the release. `build-binaries` builds `darwin-arm64`, `darwin-x64` and `linux-x64`, writes `SHA256SUMS` and attaches them.
   If release-please creates the release but its job then fails, the builds are skipped and the release has no assets. Build it with `gh workflow run release.yml --ref main -f tag=vX.Y.Z`; a release that already has assets is refused.
   Only BK can write to the repo, so the publishing jobs have no approval gate. A branch can carry an edited copy of `release.yml` that drops the main-only check, and any `environment:` key along with it. Before anyone else gets write access, move the signing secrets from repository secrets into a `release` environment whose deployment branches are limited to main, so a branch copy runs without them. Also require approval on that environment.
4. `install.sh` installs the latest release, or `--version vX.Y.Z`, and checks the checksum. Verify a release by installing it and running `keyloom --version`.
5. **On BK's machine, shipping includes updating both installed copies:** `/Applications/keyloom.app` and the CLI on PATH. Use checksum-verified release assets; confirm both installed versions and macOS trust. A scratch install alone does not finish shipping. If the desktop is running, quit normally and reopen it when safe, then verify the running server's version separately; leave an app that was closed closed. Wait for any keyboard write to finish before restarting.

## Issues

Issues are markdown files in `docs/issues/`, one per issue, named by a short slug. GitHub Issues are not used. A fixed issue gets a `Status:` line naming the fixing commit, and its evidence stays in the file.

## Local build resources

On BK's computer, run heavy local commands (Docker firmware builds, evals) through `agent-work run -- <command> [args...]`, so agents and worktrees share the two-job queue.
