# 25: Configs and versions

Status: proposal, 2026-10-16. Source baseline: origin/main after v0.25.0.

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
- **Map.** The top bar shows the board, then the config ("Moonlander · QWERTY ▾"), with a small mark on the config that's on the keyboard. The config menu lists that board's configs, newest first, with New, Rename and Archive. History is one click away (C/H/L controls).
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

## Decisions

D-300 and D-301 are in [14](14-decision-log.md).
