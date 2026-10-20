# Kickoff prompts

## Follow-on prompt for the Rust device helper

Rung 24b diagnostics shipped in v0.46.1 (D-426), with published CLI and signed/notarised desktop-sidecar verification passed; read its [published proof and remaining transport gates](../research/spikes/device-helper-24b.md#published-release-proof) before continuing. Start the next native transport rung only after its prerequisite release and explicit hardware authorization. The planning prompt below preserves the broader scope; do not rebuild the diagnostics slice. The older prompts belong to separate work.

---

Build the focused Rust device-helper extension described in chapters 31–33, keeping the product in TypeScript. Include native macOS, Linux and Windows; do not turn helper support into an unearned full-app platform claim.

1. Read `AGENTS.md`, the blueprint README, chapters 01, 17, 23, 24 and 26, then 31–33. Read D-418 to D-425, Q37–Q42, S58–S62 and `docs/research/rust-device-helper.md`. Fetch current origin/main, name its SHA and compare the reuse paths with the research baseline. Preserve unrelated work.
2. Begin with device-helper phase 0 in chapter 13. Characterize the existing transports through independent adversarial fixtures; investigate the Linux report-ID mismatch rather than blindly matching it. Inspect candidate libraries, licences, native cancellation and platform metadata before pinning dependencies. All three targets get compile/contract coverage early.
3. Keep product logic, firmware command parsing, consent and sync authority in TypeScript. Implement the proposed process seam, not an arbitrary file/command interface or a raw agent tool. Migrate synchronous serial callers to awaited I/O. Normal Rust and Bun tests must be unable to open devices.
4. Confirm only the Q entries that gate the chosen rung. Q37/Q41 govern target release/packaging; Q38 gates the Windows product scope. Q39 requires permission in this execution session before capture, reset or flash; stop if a device needs new firmware. Use scratch data and fake keyboards by default. Never start serve/sync on my real auto-sync data directory.
5. Deliver rungs 24b–24f as independent useful releases after I authorize publication. For each adopted backend, run the exact installed CLI journey, native OS and hardware checks and the relevant lab/sync screenshot gate. Record absent hardware/signing access as a blocker, not a passed or waived check. A Windows cross-compile is not native Windows support.
6. Record evidence in `docs/research/spikes/S<n>.md`, update statuses and make an explicit per-backend adoption recommendation. Keep legacy adapters only for comparison/rollback, never silent failover after a possibly effective write. Update the decision log before changing protocol safety or release shape. Do not commit, push, publish or flash unless I ask.

Historical planning status: the proposal created documentation only. D-426's diagnostics implementation supersedes that no-code status, not the remaining platform certification or hardware-authorization gates. The private helper adds no visual identity: keep the keyboard under the light, and make interruptions truthful in the existing lab, sync and doctor surfaces.

---

## Historical prompt for the first build session

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

S54 and the Q30 visual gate are complete (D-408/D-409). Rung 26a shipped in v0.42.0 and passed the full suites plus [published-installation acceptance](../screenshots/agent-experience/published-0.42.0/README.md), including the one-sidebar rule (D-410). Continue with 26b in a fresh context; do not rerun the initial concept exercise or mistake bounded snapshots for durable execution. Q31 and Q32 gate later conversation and mutation changes. Never claim durable reconnect before 26b's journey passes.

Historical planning handover, 2026-10-18, before BK requested implementation: chapters 28 to 30, the delivery slices, D-396 to D-407 and Q30 to Q36 were documentation only. [The baseline research](../research/agent-native-baseline.md) preserves that source reading and reconciliation with `72370d0494497ae4bdd6036106fcec9d3f6c1aab`. The execution update above supersedes that planning-only status; it does not authorize hardware access in a later session.

---
