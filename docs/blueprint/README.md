# keyloom: technical blueprint

> An open-source, local-first configurator for QMK and ZMK keyboards. It's a bun web app on localhost plus a CLI. You describe a frustration with your layout, an agent proposes structured changes that keyloom validates and shows on the keyboard, and keyloom builds and flashes the firmware, remembering why each change was made.

BK designed this in a conversation with a coding agent on 2026-09-28 and 2026-10-11. The blueprint was written on 2026-10-15, before any code existed. It is meant to be built by a coding agent that never saw that conversation, so it has to carry everything: what we're building, how, what we decided against, and why.

## Reading order

| # | Document | What it covers |
|---|---|---|
| 00 | [Overview](00-overview.md) | What keyloom is, the loop, principles, scope, non-goals, glossary |
| 01 | [Architecture](01-architecture.md) | One local process plus a CLI, modules and dependency rules, transport, toolchains, release |
| 02 | [Layout model](02-layout-model.md) | The firmware-neutral layout IR, functions, and the SQLite schema |
| 03 | [Agent](03-agent.md) | Model and SDK, prompt assembly, tools, change-set ops, the two worked problems |
| 04 | [Boards and contributions](04-boards-and-contributions.md) | The board definition format, board skills, and how others add a board |
| 05 | [Firmware: QMK](05-firmware-qmk.md) | Moonlander revisions, Oryx import, C generation, Docker build, Zapp flash |
| 06 | [Firmware: ZMK](06-firmware-zmk.md) | Glove80 import, `.keymap` generation, MoErgo Docker build, UF2 flash, Studio deferred |
| 07 | [Change validation](07-change-validation.md) | Errors, reachability, warnings, tests |
| 08 | [Decision memory](08-decision-memory.md) | What keyloom remembers, how reasons come back, outcomes |
| 09 | [Web editor](09-web-editor.md) | The keyboard canvas, chat panel, proposals, selection, what we take from keymap-editor |
| 10 | [CLI](10-cli.md) | Command tree, output contract, exit codes, agent skill |
| 11 | [Observability and evals](11-observability-and-evals.md) | Logs, recovering from a bad flash, the agent eval set |
| 12 | [Cost model](12-cost-model.md) | Model cost per turn and per session |
| 13 | [Roadmap](13-roadmap.md) | Phase 0, then eight usable rungs from "see my layout" to "someone else adds a keyboard" |
| 14 | [Decision log](14-decision-log.md) | Every decision, the options rejected, and how the design got here |
| 15 | [Open questions](15-open-questions.md) | Spikes to run against BK's real boards, and product questions |
| — | [Kickoff](KICKOFF.md) | The prompt to give the coding agent for the first build session |

Research behind these decisions:

- [../research/qmk-and-moonlander.md](../research/qmk-and-moonlander.md): the Moonlander's two revisions, Oryx's export and API, `keymap.json` limits, tap-hold options, Zapp, and VIA and Vial.
- [../research/zmk-and-glove80.md](../research/zmk-and-glove80.md): where Glove80 firmware lives, MoErgo's build routes, the Layout Editor's export, UF2 flashing, ZMK Studio and physical layouts.
- [../research/prior-art.md](../research/prior-art.md): keymap-drawer, CustomKeymap, keymap-ai and other editors.
- [../research/keymap-editor.md](../research/keymap-editor.md): a code reading of `nickcoutsos/keymap-editor`, the editor BK pointed to, with adopt, adapt and skip verdicts.
- `docs/research/spikes/`: spike evidence, one file per spike. None run yet.

## Summary

- **Stack:** TypeScript (strict, ESM) on bun, React through Bun's HTML imports, `bun:sqlite`, zod, `web-tree-sitter` and `@anthropic-ai/sdk` (D-029).
- **Runtime:** `keyloom serve` runs a localhost web app while BK edits. The CLI calls the same use cases in-process. There's no daemon and no hosted backend (D-028, D-030).
- **Boards:** the ZSA Moonlander on QMK and the MoErgo Glove80 on ZMK (D-027). Others are added as data plus an optional skill (D-008, D-009).
- **The core rule:** the agent proposes structured change sets; a pure validator decides whether they're valid, and nothing is lost silently (D-014, D-020).
- **Model:** `claude-opus-5-5` through the Tool Runner, on the user's own key (D-031).
- **Memory:** every applied change records its goal and reason, which come back as reminders when that key is about to change (D-022, D-023).
- **QMK:** import Oryx's C export, generate C, build ZSA's fork in Docker, flash with Zapp (D-040 to D-043).
- **ZMK:** import the Layout Editor's `.keymap`, build MoErgo's fork in Docker, copy the UF2 to each half (D-036 to D-038).
- **Dropped or deferred:**
  - a business and hosting (D-007)
  - "all keyboards" (D-008)
  - a plugin marketplace (D-009)
  - keystroke logging (D-035)
  - runtime updates through ZMK Studio, VIA or Vial (D-039)
  - Oryx GraphQL import (D-041)

## Rules for coding agents

1. **The CLI is the canonical surface.** Anything the web app does, a `keyloom` subcommand does. Check your work by driving the installed binary (D-030).
2. **The validator decides.** No path applies a change set that hasn't passed `validate` against the current head (D-014).
3. **Run the spikes first.** Each spike in [15](15-open-questions.md) names the rung it blocks. Record evidence in `docs/research/spikes/` and update the affected document.
4. **Never flash BK's keyboard unless he asks in that session.**
5. **Update the decision log.** If you change a decision, add an entry to [14-decision-log.md](14-decision-log.md) with the reason. Don't silently change the design.
