# keyloom: technical blueprint

> An open-source, local-first configurator for QMK and ZMK keyboards. It's a bun web app on localhost plus a CLI. You describe a frustration with your layout, an agent proposes structured changes that keyloom validates and shows on the keyboard, and keyloom builds and flashes the firmware, remembering why each change was made.

keyloom is built; the [latest release](https://github.com/planetaryescape/keyloom/releases/latest) is its installable version. This blueprint is the design it was built from and the record of why. It was written on 2026-10-15 from BK's design conversations of 2026-09-28 and 2026-10-11, before any code existed, and has been extended since. Where a chapter says "proposal" or "not built", check its status line and [13-roadmap.md](13-roadmap.md), which says what each rung shipped in and what was observed on hardware. Where text and code disagree, the code is current and the text is stale. Tell BK, then fix the text.

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
| 13 | [Roadmap](13-roadmap.md) | Phase 0 and rungs 1 to 30, including the 26a/26b split, implementation evidence and remaining delivery gates |
| 14 | [Decision log](14-decision-log.md) | Every decision, the options rejected, and how the design got here |
| 15 | [Open questions](15-open-questions.md) | Spikes to run against BK's real boards, and product questions |
| 16 | [Key editor](16-key-editor.md) | The Oryx-style key panel, tap dance, macros, combos and layers made on the board, and the parity matrix against keymap-editor, Oryx and Vial |
| 17 | [Keyboard sync](17-keyboard-sync.md) | Apply ends on the keyboard: hands-free flashing on every board, the ZMK module, auto-sync, and live writes if they're needed |
| 18 | [Visual design](18-visual-design.md) | The UI audit's findings, layout, keycaps, the visual system, words, states, phones and the screenshot gate |
| 19 | [Model providers](19-model-providers.md) | Running the agent on a Codex subscription, an OpenRouter key or an Anthropic key |
| 20 | [Copying from my other keyboard](20-cross-board.md) | The agent sees every layout, deterministic key and layer correspondence across boards, board capabilities, copying colours, behaviours and combos, and why the Glove80 has no lighting |
| 21 | [MacBook keyboard](21-macbook-keyboard.md) | The built-in keyboard as a board through kanata: apply by reload, safety, importing BK's Karabiner rules |
| 22 | [New keyboard](22-new-keyboard.md) | Recognising a QMK or ZMK board on USB, building its definition, and putting BK's config on it |
| 23 | [Design concept](23-design-concept.md) | The keyboard under the light: what keyloom is to BK, how the whole fits together, the moments, the visual language and the design gate |
| 24 | [Typing lab](24-typing-lab.md) | Recording a typing session, replaying it through the emulators, per-finger findings and proven timing suggestions |
| 25 | [Configs and versions](25-configs-and-versions.md) | Several configs per board with one on the keyboard, and versions as milestones you can go back to |
| 26 | [Desktop app](26-desktop-app.md) | Tauri shell around the server, menu-bar sync status, shipping and signing |
| 27 | [Board review](27-board-review.md) | What keyloom finds in a revision without being asked: checks at once, the agent after, triggers, hiding and the fixed tick |
| 28 | [The agent works beside the keyboard](28-agent-experience.md) | Implemented 26a message/activity/folding experience; proposed domain questions, rich artifacts and later interaction gates |
| 29 | [The agent operates the app](29-agent-app-control.md) | Released observation and durable-run contracts; proposed app-wide capabilities, confirmation and coverage gates |
| 30 | [Talk to any keyboard](30-agent-keyboard-context.md) | Proposed collection awareness, request focus, cross-keyboard writes, transfers, batch outcomes and physical-device identity limits |
| 31 | [Rust device helper](31-device-helper.md) | Built diagnostics subset; proposed native ownership, unchanged TypeScript policy and backend adoption gate |
| 32 | [Device-helper protocol](32-device-helper-protocol.md) | Built diagnostics stdio subset; proposed device/session identity, bounded I/O, loss and no-replay semantics |
| 33 | [Device-helper platforms](33-device-helper-platforms.md) | Native macOS/Linux/Windows plan, matched binary packaging and installed/hardware proof |
| — | [Kickoff](KICKOFF.md) | Historical first build and follow-on implementation prompts |

Research behind these decisions:

- [../research/rust-device-helper.md](../research/rust-device-helper.md): transport source baseline, conversation/reversal, pinned local reuse map, native API contracts and unverified platform assumptions.

- [../research/qmk-and-moonlander.md](../research/qmk-and-moonlander.md): the Moonlander's two revisions, Oryx's export and API, `keymap.json` limits, tap-hold options, Zapp, and VIA and Vial.
- [../research/zmk-and-glove80.md](../research/zmk-and-glove80.md): where Glove80 firmware lives, MoErgo's build routes, the Layout Editor's export, UF2 flashing, ZMK Studio and physical layouts.
- [../research/prior-art.md](../research/prior-art.md): keymap-drawer, CustomKeymap, keymap-ai and other editors.
- [../research/keymap-editor.md](../research/keymap-editor.md): a code reading of `nickcoutsos/keymap-editor`, the editor BK pointed to, with adopt, adapt and skip verdicts.
- [../research/configurators/oryx-features.md](../research/configurators/oryx-features.md), [vial-features.md](../research/configurators/vial-features.md) and [keymap-editor-features.md](../research/configurators/keymap-editor-features.md): every feature of the three configurators, with click counts for the same tasks.
- [../research/keyloom-ui-audit.md](../research/keyloom-ui-audit.md): a visual and UX audit of v0.10.1 on BK's layouts, with 26 screenshots.
- [../research/handsfree-flash-all-boards.md](../research/handsfree-flash-all-boards.md): how each of BK's boards can be flashed and edited without touching it.
- [../research/model-providers.md](../research/model-providers.md): the Codex SDK, OpenRouter and Anthropic as providers for keyloom's agent.
- [../research/spikes/S21.md](../research/spikes/S21.md): what MoErgo's firmware can and can't do for per-key colours on the Glove80.
- [../research/software-remappers.md](../research/software-remappers.md): Karabiner-Elements and kanata as targets for the MacBook keyboard, with BK's existing config and the spikes.
- [../research/new-keyboard.md](../research/new-keyboard.md): identifying QMK and ZMK boards from USB, deriving board definitions, and flashing unknown boards.
- [../research/agent-native-baseline.md](../research/agent-native-baseline.md): the current agent's tools, presentation, scope and app-use-case seams, read at `71934e13f8c0c8b702b6dc1beb57ca25993f7cf3` for the 2026-10-18 extension.
- [../research/agent-capability-inventory.md](../research/agent-capability-inventory.md): S56's source-level UI/API/app/CLI/agent workflow inventory at `c5efcb5`, including missing agent controls, existing parity differences and human-only steps. Runtime conformance remains open.
- `docs/research/spikes/`: spike evidence, one file per spike. The index says which have results.

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
  - always-on keystroke logging (D-035; opt-in typing sessions came later with D-280)
  - runtime updates through ZMK Studio, VIA or Vial (D-039)
  - Oryx GraphQL import (D-041)

- **Configurator parity (2026-10-15):** a key is built on the key, as in Oryx: tap, hold, double-tap and tap-then-hold slots, macros in the picker, combos from a selection, and nothing created elsewhere first (D-085 to D-093, [16](16-key-editor.md)).
- **Apply ends on the keyboard:** hands-free flashing on all three boards, through a `keyloom-zmk` module for ZMK, and auto-sync. Live writes come only if the wait hurts (D-094 to D-097, [17](17-keyboard-sync.md)).
- **The UI:** the board is the page, one click does one job, kind is shown by shape, plain words first, and every visual rung passes a screenshot gate (D-098 to D-102, [18](18-visual-design.md)).
- **Providers:** the agent runs on an Anthropic key, an OpenRouter key or BK's Codex subscription. A Claude subscription isn't allowed for third-party apps (D-106 to D-111, [19](19-model-providers.md)).

## Rust device-helper proposal (2026-10-20)

BK asked for a focused Rust device helper, including Linux and Windows, after reconsidering the TypeScript choice with implementation hindsight. The application remains TypeScript (D-418); each transport replacement must earn adoption through reliability and packaging evidence (D-419). Rung 24b implements installed diagnostics only: hello/ping/shutdown with empty capabilities (D-426). Chapters 31–33 retain the **unbuilt native transport** design. [S58/S62 evidence](../research/spikes/device-helper-24b.md) separates local installed macOS checks from unrun native CI, signed-chain and released-installation gates. The broader choices remain D-420 to D-425 and Q37–Q42.

Read these chapters together and follow rungs 24b–24f in [13](13-roadmap.md). This track is independent of unfinished agent rungs. Windows means native helper support plus an installed CLI device journey under the Q38 assumption, not an already-supported full Windows app. No real capture, reset or flash is authorized by the planning request. Use the device-helper prompt in [KICKOFF](KICKOFF.md).

## Rules for coding agents

The 2026-10-18 app-wide agent extension remains a proposal beyond 26a's implemented observation/presentation slice. BK asked for a keyboard specialist that operates the whole app and all his registered keyboards, with a purpose-built UI for its work (D-396 to D-407). Read chapters 28 to 30 together, the new rungs 26 to 30 (including 28b and 28c), and Q30 to Q36 before building further. The existing "keyboard under the light" concept is preserved; future run schemas, conversation continuity and confirmation policy remain explicit blueprint assumptions. Use the follow-on prompt in [KICKOFF](KICKOFF.md), not its historical first-build instructions.

Execution update: S54 reproduced the message/cancellation gaps, so D-408 splits rung 26 into 26a (honest progress/message presentation) and 26b (durable execution/reconnect). BK approved Q30's 26a visuals (D-409). Rung 26a shipped in v0.42.0 and passed the [published-release CLI/web journeys](../screenshots/agent-experience/published-0.42.0/README.md), including D-410's one-sidebar rule. None of this establishes 26b, new app capabilities or cross-board mutation support.

1. **The CLI is the canonical surface.** Anything the web app does, a `keyloom` subcommand does. Check your work by driving the installed binary (D-030).
2. **The validator decides.** No path applies a change set that hasn't passed `validate` against the current head (D-014).
3. **Run the spikes first.** Each spike in [15](15-open-questions.md) names the rung it blocks. Record evidence in `docs/research/spikes/` and update the affected document.
4. **Never flash BK's keyboard unless he asks in that session.**
5. **Update the decision log.** If you change a decision, add an entry to [14-decision-log.md](14-decision-log.md) with the reason. Don't silently change the design.
