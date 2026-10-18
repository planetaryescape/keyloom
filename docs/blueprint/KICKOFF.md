# Kickoff prompt for the first build session

Paste this to the coding agent on the build machine, after `git clone git@github.com:planetaryescape/keyloom.git`:

---

You're building keyloom, an open-source, local-first keyboard configurator for QMK and ZMK boards. You describe a frustration with your layout, an agent proposes validated changes you can see on the keyboard, and keyloom builds and flashes the firmware. It was fully planned in an earlier session you didn't see. Everything from that session is in this repo.

1. Read `AGENTS.md`, then `docs/blueprint/README.md` and every document it lists, in order. Then read `docs/research/`. Read `14-decision-log.md` before proposing any change of direction; most alternatives were already considered and rejected there.
2. Clone the reference repos into `/tmp/keyloom-refs/`: `zsa/qmk_firmware` (branch `firmware25`), `zsa/zapp`, `moergo-sc/zmk`, `moergo-sc/glove80-zmk-config`, `nickcoutsos/keymap-editor` and `caksoylar/keymap-drawer`. For each, check whether it changed since the SHA listed in the research files, and note anything that affects the blueprint.
3. Phase 0: ask me which of A1–A5 in `13-roadmap.md` are done. Don't create the GitHub repo, API keys or accounts yourself. Run the spikes that rung 1 depends on (S3, and S10 for the C grammar). Record them in `docs/research/spikes/` and in `15-open-questions.md`. Before rung 2, run S1, S5, S9 and S11, plus S2 if S1 says rev B.
4. Climb `13-roadmap.md` one rung at a time, starting at rung 1. A rung ends only when its completion check is observed on the installed release binary, against my real layout and, from rung 2, my real keyboard, and its demo has been run. Never flash my keyboard without asking me first in that session. Commit using `type: description`, with me as the only author.

Ask me about the product questions in `15-open-questions.md` when they come up. Don't guess.

---

## Follow-on prompt for the agent-native extension

The first-build prompt above is historical. For the 2026-10-18 extension, use:

---

Extend Keyloom into a keyboard-specialist agent that can operate the app and work across my registered keyboards. The blueprint is in `28-agent-experience.md`, `29-agent-app-control.md` and `30-agent-keyboard-context.md`. This is a feature of the existing product, not a new chatbot or a new visual identity.

1. Fetch current `origin/main` and name the SHA. Read `AGENTS.md`, the blueprint README, chapters 03, 20, 23 and 25, then chapters 28 to 30. Read D-396 to D-407, Q30 to Q36, and the source baseline research. Check changes since its pinned SHA before relying on code observations.
2. Start with rung 26 in `13-roadmap.md`. Run S54 first and record evidence. Do not rebuild shipped rungs 1 to 25 or jump straight to batch hardware writes. Resolve only the questions that gate the chosen rung.
3. Show the running, waiting, completed/collapsed and failure comps in the existing concept. Get my approval before building the new UI. User and agent messages, real tool progress and the final result must have different hierarchy.
4. Reuse the provider seam, ports, tools, proposal/question cards, mapping, validator and sync engine. Add correlated lifecycle and typed result data, not arbitrary model-authored UI or a shell tool. Every new app action has UI, CLI and agent coverage over the same use case.
5. Run the rung's exact demo through the served app and installed binary with a scratch data directory and fake devices. Observe the screenshot/accessibility gate. Never start a server against my real auto-sync data or flash a keyboard unless I authorize it in that session.
6. Record what actually shipped, evidence and what remains blocked. Keep proposal/built statuses honest. Do not commit, push or publish unless I ask.

The next action after this blueprint was S54 plus the rung 26 visual proposal. S54 is now characterized; read D-408 and rungs 26a/26b before implementation. BK approved Q30's first visual proposal (D-409); backend and UI implementation are running in isolated worktrees. Next integrate their explicit contracts, verify the complete served-app/CLI journey, and ship 26a before dependent implementation. Q31 and Q32 do not block this first progress slice; they gate later conversation and mutation changes. Do not claim durable reconnect before 26b's journey passes.

Planning handover, 2026-10-18: chapters 28 to 30, the seven delivery slices, D-396 to D-407 and Q30 to Q36 are written, not implemented. The blueprint checker reports no broken links, undefined IDs or index drift; `git diff --check` is clean. [The baseline research](../research/agent-native-baseline.md) records the original source reading and reconciliation with `72370d0494497ae4bdd6036106fcec9d3f6c1aab`. No app code, model credentials or hardware state was changed, and nothing was committed or published for this blueprint.

---
