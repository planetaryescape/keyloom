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
