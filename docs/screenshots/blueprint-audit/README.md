# Audit closeout browser evidence

Captured 2026-10-20 against an installed scratch copy of the compiled darwin-arm64 CLI from `5e12572`. The UI source is unchanged by the subsequent documentation, eval, doctor and validator corrections. Binary SHA-256: `e20bc4646d638424badfa422a9759e92c89e2811a97107ede591377b1cc42c3a`.

All data is a published layout fixture plus a synthetic conversation. Its model is an injected deterministic fake: 3,200 input tokens, 500 output tokens, 1,000 cache-read tokens, and a reported USD charge of 0.0123. No provider generation or keyboard writes occurred. Serving used a scratch data directory, API keys removed, and a nonexistent Codex executable.

Checks:

- A separate compiled CLI process proposed and applied F17 at position 33. The already-open browser changed Key 34's accessible name to “Sends F17” without navigation or reload, and kept the accounting footer.
- Conversations reopen shows the saved accounting. Desktop and phone screenshots show the same reported amount, not an estimate or an invented free turn.
- At 1440×900 and 390×844, both themes keep the usage text readable inside the chat column/sheet. Screenshots were inspected; the phone page has no horizontal overflow.
- Board switching/resizing can require selecting the saved conversation again; no automatic selected-conversation persistence is claimed.

Files: [desktop dark](desktop-dark.png), [desktop light](desktop-light.png), [phone dark](phone-dark.png), [phone light](phone-light.png).

This is compiled-candidate evidence, not hardware, minimum-macOS WebKit, or a live-provider quality evaluation.
