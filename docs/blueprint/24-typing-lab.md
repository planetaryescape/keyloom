# 24: Typing lab: keyloom watches you type and tunes the board to your hands

Status: capture and analysis built (rung 22 part 1, D-284 to D-289), 2026-10-16; the lab screens and `/api/lab` routes built on a scripted fake keyboard (D-314), 2026-10-16. Source baseline: origin/main at `9357af8` (v0.24.0). Nothing has run on a keyboard yet: S50 and S51 are the runbooks.

BK: "timings are quite tricky for home row mods and stuff. I'd love a feature where I can set up a key config, then tell the software to listen/watch me type for a bit (you can make a quick typing test or something) and then notice things that go wrong like rolls, typos and timings and stuff and then use that knowledge to make suggestions about what to improve … Maybe we could even create a test that checks how fast each of my fingers is so instead of saying this is your typing speed it can say your typing slows down on keys that you need to press with your index finger or something or most typos come from your pinky."

The native HID candidate continuation (D-427/D-428, 2026-10-21) adds persisted incomplete-recording warnings and refuses analysis before replay when those warnings mark loss. `POST /api/lab/:layoutId/recording` returns 409 with `busy` or `permission_denied` and an actionable message for those typed access refusals; it makes no automatic retry. Unclassified errors remain 500/internal. CLI refusals use exit 2 with the same stable kind, not an unexpected-bug log. Installed synthetic CLI/PTY journeys cover stop/reopen and helper death; they do not grant native hardware acceptance. See [the candidate evidence](../research/spikes/device-helper-24c.md).

This reverses D-035 ("no keystroke logging in v1") for an explicit, opt-in session that BK starts himself (D-280). Q5 is answered.

## What this is to the person

Home-row mods and layer-taps are a bargain with your own timing. Today the only way to tune them is to guess a number, flash, type for a day and feel whether it got better. The typing lab replaces that with evidence: a few minutes of typing, then a calm read-out of what your hands actually do, and fixes that are proven against your own keystrokes before you apply them.

## The concept: a fitting room

A tailor watches you move, then adjusts the cut. The lab measures in the open, says what it saw in plain words about your fingers, and offers adjustments it has already tried on your recording. It never diagnoses from a single number such as "85 wpm". It doesn't nag. It shows one or two findings that matter, with the evidence one click away.

## How it fits the whole

- **Mental model.** It adds two nouns to board, layer, key and change: a **session** (one recorded stretch of typing) and a **finding** (something that went wrong, with its cause). A suggestion is an ordinary keyloom change, a proposal on the keys, applied and synced the way every change is.
- **Map.** The lab opens from the menu and from ⌘K ("test my home row mods", offered as a command row above "Ask keyloom", D-315). It replaces the stage with the test, then returns to the board with findings drawn on the caps: rose where things went wrong (amber stays "not on the keyboard yet", D-314), with a per-finger heat on the board that shows speed or errors. Proposals reuse the ⌘K proposal card.
- **Journey.**
  1. BK sets a layout and starts a session.
  2. He types a prompted passage, or his own text, for two to five minutes.
  3. keyloom shows findings on the board.
  4. BK clicks a finding to see the rolls that misfired, replayed slowly on the caps.
  5. He picks "Try the fix", and the same recording is replayed with the new setting: "7 of 9 misfires gone, 0 new".
  6. Apply, sync, type again.
- **Across surfaces.** `keyloom lab start|analyse|sessions|delete` on the CLI. The agent gets a `get_typing_findings` tool, aggregated and never raw text, so "my home row mods misfire" in chat uses real evidence.

## Key moments

| Moment | Feel | Interaction |
|---|---|---|
| Starting | Like stepping onto a scale: calm, private | A short line: "keyloom will listen to this keyboard while this screen is open. Nothing leaves your Mac." A visible recording light on the board |
| Typing | Unhurried; the text matters, not a timer | The passage sits above the board; keys light as pressed; no score while typing |
| The read-out | "Oh, that's why" | Two or three findings in words ("Your S→D rolls overlap by 40 ms; that's when Option fires"). The board shows per-finger speed as a quiet heat |
| Proof | Confidence before changing anything | "Try the fix" replays the session through the new settings, then shows before and after counts and the misfires that went away |
| Done | Closure, and a reason to come back | Apply, then "Type again in a few days to see if it stuck." It fits D-058's outcome check |

## Capturing what the hands do

A browser typing test only sees what the firmware sends after it decided tap or hold, so the lab can't diagnose timing from the browser alone. It needs physical events: position, press or release, and a millisecond timestamp (D-281).

- **QMK (Moonlander).** keyloom's firmware wrapper already owns a raw-HID command (D-070). A second command turns a key-event stream on for the session: each matrix event with `timer_read32()`, batched into 32-byte reports. It is off by default, and turns itself off after a timeout or when the host disconnects. S50 decides whether it fits beside Oryx's modules and keeps up at typing speed.
- **ZMK (Glove80, Corne).** The `keyloom-zmk` module's USB serial port (D-095) streams `zmk_position_state_changed` events from the central, which sees both halves, with `k_uptime_get()` timestamps. It is off unless the host asks. S51 decides the split latency and ordering.
- **MacBook (kanata).** Out of scope for the first rung. kanata exposes no raw event stream. The lab says so for that board (S52 checks `kanata --debug` parsing as a later route).
- **Text.** Alongside the events, the browser records what came out. Comparing the two is what separates a typo (the wrong key pressed) from a misfire (the right keys pressed, the firmware's decision wrong).

## Analysis

- **Replay.** The physical trace is fed through keyloom's QMK and ZMK emulators with the layout's current settings, and the emulator output is compared with the intended text. Every difference is classified:
  - **Misfire, hold-instead-of-tap:** a roll triggered a modifier.
  - **Misfire, tap-instead-of-hold:** a hold came out as a letter.
  - **Typo:** a different key was physically pressed.
  - **Missed or double key.**
- **Counterfactuals.** The same trace is replayed through candidate settings: tapping term per profile, permissive hold, hold on other key press, chordal hold, flavors, quick-tap and require-prior-idle. Each candidate is scored by misfires removed minus misfires introduced. Only candidates with a clear net gain become suggestions, and each carries its evidence.
- **Per-finger stats** from the board's `fingers` and `hands` data:
  - inter-key time by finger;
  - error rate by finger;
  - same-finger bigrams;
  - roll overlap by finger pair;
  - hold durations on mod-tap keys;
  - where the slowest transitions are.

  All of it is reported in sentences, with a heat view on the board.
- **Passages.** A built-in set chosen to exercise each home-row pair's rolls and holds, plus a finger drill, plus BK's own pasted text.

## Privacy

Sessions start only by BK's action, show a recording indicator, stay in keyloom's local database, and can be deleted. The raw trace never goes to a model provider; the agent sees aggregated findings and short anonymised examples (key names, not text). Passwords never get typed into the lab: the lab tells the person not to, and it stops recording if the focus leaves its own text box.

## Decisions and spikes

D-280 to D-289 and the screens' D-314, and spikes S50 to S53, are in [14](14-decision-log.md) and [15](15-open-questions.md). The engine is `src/lab/`; the screens are `src/web/lab/` over the `/api/lab` routes (`src/api/lab.ts`); the CLI is `keyloom lab` ([10](10-cli.md)); the agent tool is `get_typing_findings` ([03](03-agent.md)).
