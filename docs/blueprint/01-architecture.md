# 01: Architecture

Status: local server and CLI built. The audit closeout implements the one-second SQLite head watcher and verifies CLI-to-editor updates against the compiled client. See [verification scope](../research/blueprint-audit-closeout.md); no hardware validation is claimed.

```
 ┌────────────── browser (localhost) ──────────────┐      ┌──────────── terminal ────────────┐
 │  React editor: keyboard canvas + chat panel     │      │  keyloom <command>  (CLI, D-030) │
 └───────────────┬─────────────────────────────────┘      └───────────────┬──────────────────┘
                 │ HTTP JSON + SSE (127.0.0.1, token)                     │ in-process calls
 ┌───────────────▼──────────────────────────────────────┐                 │
 │  keyloom serve  (one bun process)                    │                 │
 │   server/  → app/ (use cases) ◄──────────────────────┼─────────────────┘
 └───────────────┬──────────────────────────────────────┘
                 │
   ┌─────────────┼───────────────┬───────────────────┬────────────────────┐
   ▼             ▼               ▼                   ▼                    ▼
 layout/     validation/      agent/             firmware/            persistence/
 (IR, ops)   (07)             (03) ──HTTPS──►    qmk/ zmk/            bun:sqlite
                              Anthropic API      │ docker build        keyloom.db
                                                 │ zapp / UF2 copy
                                                 ▼
                                   Docker (QMK fork / MoErgo Nix image)
                                   USB: Moonlander (Zapp), Glove80 (boot drives)
```

## Why one local process with a CLI beside it

1. **Local, not hosted** (D-028). Firmware builds and USB flashing have to happen on BK's machine. A hosted app would need accounts, storage of other people's layouts and chats, and a processor contract for them. BK rejected that for an open-source tool he isn't running as a business (D-007).
2. **A web UI, with an optional desktop shell.** D-028 originally rejected native packaging; D-320 later added a Tauri shell around the same local server ([26](26-desktop-app.md)). Browser mode remains available.
3. **No separate daemon.** CLI commands call the same `app/` use cases in their own process against the same SQLite file. While `serve` runs, its sync engine can automatically build and flash the active config after Apply when auto-sync is enabled ([17](17-keyboard-sync.md)); it stops/drains with the server. WAL mode plus transactional apply with a head check ([02](02-layout-model.md#applying-undoing-and-stale-bases)) protects concurrent server and CLI writes. Use scratch data for agent verification.
4. **The CLI is canonical** (D-030). Every use case in `app/` is reachable from the CLI. The server is a thin HTTP adapter over the same functions.

## Modules

TypeScript, strict, ESM, on bun (D-029). One package. Folders are grouped by job:

| Folder | Job | May import |
|---|---|---|
| `src/layout/` | IR schemas, keycodes, functions, `apply-ops` (pure) | nothing else in `src/` |
| `src/validation/` | The validator (pure, [07](07-change-validation.md)) | `layout`, `boards` |
| `src/boards/` | Load and check board definitions ([04](04-boards-and-contributions.md)) | `layout` |
| `src/firmware/qmk/`, `src/firmware/zmk/` | Import, generate, build and flash per firmware ([05](05-firmware-qmk.md), [06](06-firmware-zmk.md)) | `layout`, `boards`, `firmware/toolchain` |
| `src/firmware/toolchain/` | Docker checks, pinned checkouts, subprocess runner with log capture | none of the above |
| `src/agent/` | Prompt assembly, tools, one agent turn ([03](03-agent.md)) | `layout`, `validation`, `boards`, `memory` (through interfaces) |
| `src/memory/` | Decisions and priorities ([08](08-decision-memory.md)) | `layout`, `persistence` |
| `src/persistence/` | Database, migrations, repositories | `layout` |
| `src/app/` | Use cases: import, propose, apply, undo, agent turn, generate, build, flash | everything above |
| `src/api/` | The HTTP wire contract (zod schemas) shared by the server and the browser | `layout`, `boards`, `validation` (schema types) |
| `src/server/` | HTTP routes, SSE, static web assets | `app`, `api`, `layout`, `boards` and `validation` (schema types), `web` (the bundled HTML entry it serves) |
| `src/cli/` | Commands ([10](10-cli.md)); `keyloom serve` composes the server | `app`, `server` |
| `src/web/` | The React editor ([09](09-web-editor.md)) | `layout` and `validation` (pure; the validator also runs in the browser), `boards` and `api` (schema types); talks to `server` over HTTP |
| `boards/` (repo root) | Board definitions and skills (data) | n/a |

**Enforcement:** `dependency-cruiser` runs in CI with these rules. `layout` and `validation` must stay pure, with no I/O, so the validator can be property-tested and run in the browser for instant preview.

## Server and transport

- `Bun.serve` on `127.0.0.1:4477` by default (`--port`). It never binds `0.0.0.0`.
- **Requests carry a per-launch token.** `keyloom serve` generates a random token, opens `http://127.0.0.1:4477/?t=<token>`, and the page sends it as a header on every request. The server also rejects any `Host` header other than `127.0.0.1:<port>` or `localhost:<port>`. Why: this local server can spend BK's Anthropic credits and flash his keyboard, and without a token any web page could reach it through DNS rebinding.
- **API:** JSON over `/api/…`, one route per use case, with bodies validated by the same zod schemas.
- **Configs and versions (rung 23):** the routes are listed at the top of `src/api/configs.ts`: `GET|POST /api/configs` (`POST` takes `from: "config" | "blank" | "import"` and answers with the config and a `note` saying where a blank one started), `POST /api/configs/:ref/{rename,archive,restore,delete,use}`, `GET /api/configs/:ref/versions`, `POST /api/configs/:ref/versions/{name,restore}` and `GET /api/configs/:ref/compare?to=`. `:ref` is a config's ID or name. `use` answers like `POST /api/sync` (202 with the boards), and a refusal is 400 with the choice unchanged.
- **Streaming:** Server-Sent Events. Legacy `POST /api/layouts/:ref/chat` streams one turn; `/api/agent/v1/runs/:id/events` follows saved run snapshots. `/api/events` carries sync snapshots, review notifications and `layout.updated`; build/flash detail is polled from the corresponding job routes, not separate `build.progress`/`flash.progress` frames.
- **Seeing CLI writes:** `src/cli/data-version-watcher.ts` polls `PRAGMA data_version` once a second, alongside `total_changes()` for writes made through this server's own connection. It compares layout heads and emits `layout.updated` for new or changed heads. Subscribers receive current heads on reconnect so an offline edit is not lost. The watcher stops with the server. A CLI `change apply` therefore refreshes an open editor. This is a head-change notification, not a general event for every metadata write or deletion.
- **Static assets:** the React app is an HTML import bundled by Bun. In the release binary it's embedded by `bun build --compile` (oven-sh/bun `a9c57bd` `docs/bundler/executables.mdx:557-640`).

## Firmware toolchains

Builds need Docker. That's a deliberate requirement (Q12). Both firmwares document Docker builds, and it keeps ARM toolchains, Python and Nix off BK's machine.

- **Pinned checkouts** live in `$XDG_CACHE_HOME/keyloom/build/<board-slug>/`. The repo and SHA come from the board definition. keyloom clones on first build, verifies `git rev-parse HEAD` matches the pin, and refuses to build from a checkout that doesn't. `keyloom doctor` reports drift.
- **Runner:** `src/firmware/toolchain/run.ts` spawns subprocesses with `Bun.spawn`. It streams stdout and stderr to the log file and to progress events, and applies a timeout of 20 minutes for builds and 3 minutes per flash step.
- **Flash tools:** `zapp` (Homebrew) for the Moonlander. For the Glove80, file copy to the boot volume. `keyloom doctor` checks both.

## Paths

| Path | Holds |
|---|---|
| `<data dir>/config.json` | Saved `agent.provider`, `agent.model` and `agent.effort`, read with zod; missing values take defaults. API keys stay in the environment |
| `$XDG_DATA_HOME/keyloom/keyloom.db` | The database ([02](02-layout-model.md#database)) |
| `$XDG_DATA_HOME/keyloom/artifacts/` | Built `.bin` and `.uf2` files by build ID |
| `$XDG_DATA_HOME/keyloom/logs/` | Build, flash and server logs |
| `$XDG_CACHE_HOME/keyloom/build/` | Pinned firmware checkouts |

On macOS the XDG defaults apply (`~/.config`, `~/.local/share`, `~/.cache`). That's the convention BK's CLIs use, and it keeps paths the same on Linux.

## Release

release-please owns versions, tags and the changelog. Each release builds `bun build --compile` binaries for `darwin-arm64`, `darwin-x64` and `linux-x64`, and attaches them to the GitHub release. `install.sh` downloads the right one (D-034). There's no npm package in v1, because the `keyloom` name on npm belongs to an unrelated password generator (Q2).
