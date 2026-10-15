# 01: Architecture

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
2. **A web UI, not a desktop shell** (D-028). The editor is a canvas plus chat, which the browser does well. Tauri would add native packaging to every rung for one benefit, USB access, and Zapp and the UF2 boot drives already provide that.
3. **No daemon.** `keyloom serve` runs only while BK is editing. CLI commands call the same `app/` use cases in their own process against the same SQLite file. Nothing needs to run in the background: builds and flashes are started by BK, and there's no sync. WAL mode plus transactional apply with a head check ([02](02-layout-model.md#applying-undoing-and-stale-bases)) makes the server and the CLI writing at once safe.
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
- **Streaming:** Server-Sent Events. `/api/conversations/:id/stream` relays agent text and tool progress. `/api/events` pushes `layout.updated`, `build.progress` and `flash.progress`.
- **Seeing CLI writes:** the server polls `PRAGMA data_version` once a second. When it changes, the server emits `layout.updated` for affected layouts, so a CLI `change apply` shows up in an open editor.
- **Static assets:** the React app is an HTML import bundled by Bun. In the release binary it's embedded by `bun build --compile` (oven-sh/bun `a9c57bd` `docs/bundler/executables.mdx:557-640`).

## Firmware toolchains

Builds need Docker. That's a deliberate requirement (Q12). Both firmwares document Docker builds, and it keeps ARM toolchains, Python and Nix off BK's machine.

- **Pinned checkouts** live in `$XDG_CACHE_HOME/keyloom/build/<board-slug>/`. The repo and SHA come from the board definition. keyloom clones on first build, verifies `git rev-parse HEAD` matches the pin, and refuses to build from a checkout that doesn't. `keyloom doctor` reports drift.
- **Runner:** `src/firmware/toolchain/run.ts` spawns subprocesses with `Bun.spawn`. It streams stdout and stderr to the log file and to progress events, and applies a timeout of 20 minutes for builds and 3 minutes per flash step.
- **Flash tools:** `zapp` (Homebrew) for the Moonlander. For the Glove80, file copy to the boot volume. `keyloom doctor` checks both.

## Paths

| Path | Holds |
|---|---|
| `$XDG_CONFIG_HOME/keyloom/config.json` | `agent.model`, `agent.effort`, `server.port`. Validated by zod; missing keys take defaults |
| `$XDG_DATA_HOME/keyloom/keyloom.db` | The database ([02](02-layout-model.md#database)) |
| `$XDG_DATA_HOME/keyloom/artifacts/` | Built `.bin` and `.uf2` files by build ID |
| `$XDG_DATA_HOME/keyloom/logs/` | Build, flash and server logs |
| `$XDG_CACHE_HOME/keyloom/build/` | Pinned firmware checkouts |

On macOS the XDG defaults apply (`~/.config`, `~/.local/share`, `~/.cache`). That's the convention BK's CLIs use, and it keeps paths the same on Linux.

## Release

release-please owns versions, tags and the changelog. Each release builds `bun build --compile` binaries for `darwin-arm64`, `darwin-x64` and `linux-x64`, and attaches them to the GitHub release. `install.sh` downloads the right one (D-034). There's no npm package in v1, because the `keyloom` name on npm belongs to an unrelated password generator (Q2).
