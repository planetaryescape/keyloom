# keyloom: project context for AI agents

> An open-source, local-first keyboard configurator for QMK and ZMK boards. You describe a frustration with your layout, an agent proposes validated changes you can see on the keyboard, and keyloom builds and flashes the firmware. It's a bun web app on localhost plus a CLI.

## Status

**There's no code yet.** This repo holds a complete blueprint, written in the planning session on 2026-10-15 from BK's design conversation of 2026-09-28 and 2026-10-11.

## Start here

1. Read `docs/blueprint/README.md`, then every document it lists, in order.
2. Read `docs/blueprint/14-decision-log.md` before proposing any change of direction. Most alternatives were already considered and rejected there, with reasons.
3. Read `docs/research/`: the QMK/Moonlander, ZMK/Glove80, prior-art and keymap-editor research the decisions cite.
4. Follow `docs/blueprint/KICKOFF.md` for the first build session.

## Rules

- **The blueprint is the spec, and the decision log is its history.** If you change a decision, add a new entry to `14-decision-log.md` that replaces the old one. Don't drift silently.
- **Run the spikes before building on what they test.** `15-open-questions.md` lists them with the rung each blocks. Record evidence in `docs/research/spikes/`.
- **Every feature is in the CLI** (D-030). Verify your work by driving the installed `keyloom` binary against BK's real layouts (with `--data-dir` pointing at a scratch directory unless BK says otherwise), not only through unit tests.
- **Never flash BK's keyboard unless he asks in this session.** A bad flash takes away the keyboard he types on. Building is fine; flashing is his call.
- **The agent proposes; the validator decides** (D-014). No code path may apply a change set that hasn't passed `validate` against the current head.
- **`src/layout/` and `src/validation/` stay pure.** `dependency-cruiser` enforces it.
- **Reuse before rewriting.** Read the reference implementations in `docs/research/` (keymap-editor, keymap-drawer, ZSA's Zapp, MoErgo's template) before inventing a parser, renderer or flasher. Check each licence before copying, and keep an `// Adapted from <repo> <path> @ <sha>` comment on anything copied.
- Issues are tracked as markdown in `docs/issues/`, not GitHub Issues.
- Commits use `type: description`, with BK as the only author and no co-author lines.

## Stack

TypeScript (strict, ESM) on bun. React served through Bun's HTML imports. `bun:sqlite`, zod, `web-tree-sitter` with the C and devicetree grammars, and `@anthropic-ai/sdk` (Tool Runner, `claude-opus-5-5`). Tests use `bun test` and `fast-check`. Firmware builds run in Docker (ZSA's QMK fork; MoErgo's ZMK template). Flashing uses Zapp (Moonlander) and UF2 boot drives (Glove80). Releases go through release-please, then a GitHub release with `bun build --compile` binaries, then `install.sh`.

## Local build resources

On BK's computer, run heavy local commands (Docker firmware builds, evals) through `agent-work run -- <command> [args...]`, so agents and worktrees share the two-job queue.
