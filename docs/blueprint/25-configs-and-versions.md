# 25: Configs and versions

Status: model, sync, CLI, API and agent built (rung 23 part 1); screens built on fake keyboards (D-315), 2026-10-16. Source baseline: origin/main after v0.25.0.

BK: "I would like this app to keep multiple versions of my layout and version history just like oryx does so if i change something an use it for a week and don't like it I can go bto a past version or maybe I want a steno config and a qwerty config and a colemac config and I don't want to use layers for that, then I can keep layout configs that are different".

## What exists, and the gap

- Every change is already a revision, and History can go back to any revision or flash it (D-102, D-170).
- A board can already hold several layouts.
- **The gap:** nothing says which layout is on the keyboard. The sync engine picks the most recently edited layout for a board (`src/app/sync-engine.ts`, "newest by updatedAt"), so editing a second config would put it on the keyboard. There's also no way to start a config from an existing one.

## Configs

- **A config is a layout** (no new entity). The UI and CLI call it a config, because that's BK's word.
- **Each board has exactly one config on the keyboard** (D-300). Only that config auto-syncs. Editing any other config never touches the keyboard.
- **"Put this config on my Moonlander"** makes a config the one on the keyboard. It's an explicit action: one sync, with the usual flash confirmation the first time.
- **New config:**
  - from the current config, as a copy of its head revision, with the history starting there and a "copied from" link;
  - from any version;
  - from blank (the board's default keymap);
  - from an import.
- **Rename and archive.** An archived config is hidden but kept, and can be restored. Deleting is a second step, with the config's name typed.

## Versions

- **A version is a revision that went onto the keyboard,** recorded automatically when a sync verifies (D-301). It carries:
  - when it went on;
  - how long it stayed on (until the next version replaced it);
  - an optional name BK gives it ("before the HRM tweak").
- **Naming without flashing.** BK can also name any revision as a version.
- **History shows versions as milestones.** The revisions between two versions fold under the later one. From a version:
  - **Go back:** a new revision restoring it (D-170's mechanism).
  - **Compare with now:** the differences drawn on the board, like a proposal preview.
  - **Put on keyboard:** a sync of that revision. With auto-sync on, keyloom asks whether to make it the head first, so auto-sync doesn't undo it.
  - **New config from here.**

## How it fits the whole

- **Nouns.** Board → config → layer → key. A change and a version are moments in a config's history.
- **Map.** The top bar shows the board; the caption under it shows the config ("Config QWERTY ▾", D-315), and its menu lists that board's configs, the one on the keyboard first and marked green, with New, Rename and Archive. History is one click away (C/H/L controls).
- **Journeys.**
  - Try a change for a week: edit, apply (a version is recorded on sync), and later History → that version → Go back.
  - Switch to Colemak for the day: config menu → Colemak → "Put on my Moonlander".
  - Start a steno config: New config → from blank, or import.
- **Across surfaces.**
  - `keyloom config list|new|rename|archive|use <config>`.
  - `keyloom version list|name|restore|compare`.
  - Sync status names the config on each keyboard.
  - The agent's `list_layouts` says which config is on the keyboard.

## Key moments

| Moment | Feel | Interaction |
|---|---|---|
| Switching configs to edit | Safe: nothing changes on the keyboard | The top bar says "Editing Colemak · QWERTY is on your Moonlander" until it's put on |
| Putting a config on the keyboard | Deliberate | One confirm, then the same press-and-sync moment as Apply |
| Going back a week | Relief | The version timeline shows what changed since, drawn on the board, before going back |

## What is built

- **Model.** `board_config` names the config on each keyboard; `versions` holds the revisions that went on a keyboard or were named; `layouts` gains `archived_at` and `copied_from_*` (D-302 for the migration).
- **Sync.** The engine tracks the stored config only. A manual `sync` of another config is refused, `config use` stores the choice after the usual checks and syncs once, and a switch in the middle of a sync stops a build and checks again right before the flash (D-303, D-304). A keyboard running another config of the board reads "behind: other_config" and auto-sync leaves it.
- **Versions.** Written in the transaction that finishes a verified sync (D-307). History is `versions` with the revisions between two folded under the later one, plus the revisions newer than the newest version as `pending`. Restore is the go-back path; compare is a key-by-key diff (D-309).
- **Surfaces.** CLI in [10](10-cli.md#config-and-version-keep-several-layouts-per-board-and-go-back-to-old-ones); routes in [01](01-architecture.md) and `src/api/configs.ts`; the agent's `list_layouts` marks the config on each keyboard and its prompt says a "Colemak config" is a new config, which it tells BK how to make.

## Not built yet

- Deleting a config from the screens (the CLI and `/api/configs/:ref/delete` have it).
- New config from an import is `keyloom import --name`, which already makes a layout; on a board that has a config it is not put on the keyboard.
- A real default keymap for a blank config (D-306).

## Decisions

D-300 and D-301 are in [14](14-decision-log.md), with D-302 to D-309 for the build and D-315 for the screens: the caption's "Config ▾" switcher, the editing line, History as versions, compare on the board, and putting a version on the keyboard as a restore followed by a sync. The screens are `src/web/configs/` and `src/web/history/`.
