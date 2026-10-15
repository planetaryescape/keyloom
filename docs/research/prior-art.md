# Prior art for an AI ZMK configurator

All facts checked 2026-10-15. SHAs come from `git ls-remote --symref https://github.com/<owner>/<repo> HEAD`. READMEs and code were read from shallow clones at those SHAs.

| Repo | Default branch | HEAD SHA | Last commit | Licence |
| --- | --- | --- | --- | --- |
| `caksoylar/keymap-drawer` | `main` | `e855a57cf6f5851b8235b56a69d46fa0646b26e8` | 2026-08-11 | MIT |
| `Kit-314/customkeymap` | `main` | `d4f07e4c38ee45bce6ee1392e1467082a8f584d3` | 2026-07-09 | MIT |
| `johncattrall/keymap-ai` | `main` | `c8e54351cf031fbd3059f76c184e4fb50644569e` | 2026-09-26 | MIT |
| `nickcoutsos/keymap-editor` | `main` | `e7946792cf674db20ab72ab67fea759fff4c3ccc` | pushed 2026-08-27 | MIT |

## keymap-drawer parses ZMK keymaps in Python, but its output is display legends, not an editable model

Repo: https://github.com/caksoylar/keymap-drawer, checked 2026-10-15.

From the README: it parses QMK and ZMK keymaps and draws them as SVG, including hold-taps and combos. It runs as a CLI (`pipx install keymap-drawer`, command `keymap`) or as a Streamlit web app at https://caksoylar.github.io/keymap-drawer. `keymap parse -z <file>.keymap` outputs a human-editable YAML. `keymap draw` turns that YAML into SVG. Physical layouts are kept separate from the keymap. They can come from QMK `info.json`, a `zmk_keyboard` name, or a ZMK `dts_layout` file with `zmk,physical-layout` nodes, and rotated keys are supported.

It is written in Python. Dependencies include `pcpp` for the C preprocessor, `tree-sitter` with `tree-sitter-devicetree` for parsing, `pyparsing` and `pydantic` (`pyproject.toml`).

The parser has two layers:

- `keymap_drawer/dts.py` (241 lines) is a general devicetree reader. It runs pcpp, parses with tree-sitter, and has helpers such as `get_compatible_nodes` and `get_phandle_array`.
- `keymap_drawer/parse/zmk.py` (335 lines) turns bindings into `LayoutKey` legends (tap, hold, shifted) through `_str_to_key`. The behaviour parameters are lost.

So the YAML is lossy for round-trip editing. It cannot be written back to `.keymap`.

Reuse options for a bun app:

- Shell out to the CLI for rendering only.
- Port `dts.py`'s approach to TypeScript. The same grammar is on npm as `tree-sitter-devicetree`, latest `0.15.0`, published 2025-11-02 (https://www.npmjs.com/package/tree-sitter-devicetree, checked 2026-10-15).
- Embedding the Python parser in a bun process is not practical.

It ships a Glove80 layout. `resources/zmk_keyboard_layouts.yaml` has a `glove80` entry, and `resources/extra_layouts/glove80.json` is sourced from `moergo-sc/glove80-zmk-config`.

## customkeymap is a browser ZMK keymap editor with a bring-your-own-key AI mode

Repo: https://github.com/Kit-314/customkeymap. It is hosted at https://customkeymap.com. Checked 2026-10-15.

From the README: it is a web tool for viewing and editing ZMK keymaps. You point it at a GitHub repo. It renders every layer with labelled keys and plain-English tooltips. It resolves `#include`s and expands C-preprocessor templates. It parses the `behaviors {}` block, so custom hold-taps, mod-morphs and tap-dances render by meaning.

Edits splice into the original text and keep comments and formatting. Editing combos and behaviours is marked "in progress". The result can be downloaded or committed back to GitHub.

It has an optional AI mode. The user pastes their own Anthropic or OpenAI key and describes changes in plain English. The key goes from the browser straight to the provider.

It positions itself against ZMK Studio. Studio edits live but only reaches per-layer bindings. customkeymap edits the source but needs a build and flash. It says live tuning "for the subset that can safely change at runtime is planned".

It is vanilla JS with no dependencies and no build step. The pure, DOM-free `editor-engine.js` has tests (`node test/editor-engine.test.js`). The repo also has `ai-editor.js`, `doctor.js` and `layout-json.js`. It does not build or flash firmware.

This is the closest match to keyloom's idea. The differences are that keyloom is local-first, uses a structured proposal and preview, and builds and flashes for you.

## keymap-ai is an agent skill, not an app

Repo: https://github.com/johncattrall/keymap-ai, checked 2026-10-15.

From the README: it is an Agent Skill (https://agentskills.io) that makes a coding agent a ZMK and QMK firmware expert. You install it with `npx skills add johncattrall/keymap-ai`. It works with Claude Code, Codex CLI, Cursor, Gemini CLI, opencode and other harnesses.

It covers these jobs:

- auditing a config and ranking findings by payoff, with a failure scenario, a fix and which half to reflash for each
- tuning home row mods
- making trackballs and trackpads layer-aware
- localisation and window-manager wiring
- per-layer keymap diagrams with CI
- syncing keymaps across ZMK and QMK boards with a drift-check script
- debugging

Changes are applied "one reversible commit at a time". The repo holds `skills/keymap-ai/` with `SKILL.md`, `references/` and `scripts/`. It has no UI and no build or flash tooling of its own.

## nickcoutsos/keymap-editor is the long-standing non-AI graphical ZMK editor

Repo: https://github.com/nickcoutsos/keymap-editor. Its description is "A web based graphical editor of ZMK keymaps." It is MIT-licensed, not archived, and was last pushed 2026-08-27. The README calls it a browser app to edit ZMK keymaps, demoed against a Corne repo. Checked 2026-10-15 via `gh api`. The README was not read past the intro, and the code was not read.

## One search for other AI or natural-language configurators from 2025–2026 found nothing new

The search was `AI natural language keyboard keymap configurator ZMK QMK LLM 2026`, in extended mode, run 2026-10-15. It returned `keymap-ai` again. The rest were non-AI tools:

- https://github.com/nickcoutsos/keymap-editor, covered above
- https://keymapdb.com/, a database of keymaps
- https://aaronsantiago.github.io/qmk-to-zmk/, a QMK JSON to ZMK converter
- https://docs.qmk.fm/configurator_step_by_step, the QMK Configurator
- https://pypi.org/project/keymap-drawer/

No dedicated LLM-driven configurator product turned up beyond `customkeymap`'s AI mode and `keymap-ai`. Only one query was run, so this is not proof that none exist.

## Unsettled; needs a spike

- How good is customkeymap's AI mode? Read `ai-editor.js` at `d4f07e4c` to see whether the LLM emits structured edits or raw text. Then try it on a Glove80 config such as `moergo-sc/glove80-zmk-config`.
- Does customkeymap's `editor-engine.js` round-trip a MoErgo Layout Editor `.keymap` export without loss? Load one, make a no-op edit, and diff the output.
- Can a TypeScript parser built on the npm `tree-sitter-devicetree` plus a C preprocessor handle real Glove80 keymaps? Candidates for the preprocessor are a JS port of pcpp, or shelling out to `cpp`. Test against the template keymap and a Layout Editor export.
- Are there other AI configurators that one search missed? Search GitHub topics such as `zmk` and `keymap` for LLM-related repos, and check r/ErgoMechKeyboards and the ZMK and MoErgo Discords.
