# The copied setup survives questions, Apply and replay

Checked source: `8c3dfe7733d62a175976af80281e6ca1f3b460e1`, tree `d3fbaf208a53e0625eff1b97a4cc97c0c6a617f7`, on 2026-10-29. The app used real routes, SQLite and Codex `gpt-6.1-sol` through an existing subscription. The Glove80 and Corne layouts and their remembered preferences were synthetic. Hardware discovery, builds and flashing were blocked.

Computer Use drove Dia and Safari through the bundled plugin. The copy request was entered in Dia. The source completed, the new config opened automatically in its own conversation, and the source thread appeared read-only above it. The result card named the Corne without claiming that no proposals were waiting.

The first proposal put Navigation on the middle left thumb and Space on the inner left thumb. The model found that the existing preference settled its placement question and finished without asking. A subsequent request introduced a consequential question: whether Navigation must work while Space is held. Its numbered answer shortcut worked. The reply superseded the original proposal, retained the placements and recorded the answer's reason.

Safari's Option-Shift-Tab reached Apply from the composer. Return applied the replacement. The decision view displayed both remembered preferences and the answer about holding Space. Database checks confirmed that the two original heads and board selections stayed unchanged; the copy remained unselected.

After a full reload, the app returned to its initial board. Opening the original Corne conversation's saved result and choosing Open recovered the recorded target conversation, its answered question and its applied replacement.

## Both themes fit desktop and phone viewports

| Viewport in CSS pixels | Theme | Evidence |
|---|---|---|
| 1440 × 900 | Dark | [First validated proposal](best-dark-1440x900.png), [Applied replacement](applied-dark-1440x900.png) |
| 1440 × 900 | Light | [Applied replacement](applied-light-1440x900.png) |
| 390 × 844 | Dark | [Applied replacement](applied-dark-390x844.png) |
| 390 × 844 | Light | [Applied replacement](applied-light-390x844.png) |

Captures use device pixel ratio 2: desktop PNGs are 2880 × 1800 and phone PNGs are 780 × 1688. Dia's native page screenshot command produced them through Computer Use; no browser chrome or image resizing is included.

The desktop capture keeps the keyboard visible beside the chat. Proposed bindings use the existing amber outline and dot, legends remain legible, and the config name and selection state are visible. The applied replacement and its status remain readable in both themes. On the phone, the existing half-board switch preserves readable keys; scrolling the conversation reveals the replacement card, whose title wraps within its width. Keyboard navigation reached Apply before it was applied. This review used [the design concept](../../../blueprint/23-design-concept.md) and the UI/UX principles referenced by [the screenshot gate](../../../blueprint/18-visual-design.md#how-a-rung-proves-it-looks-good).

Page captures use Dia. Safari supported the functional checks, but its later screenshot captures were blank despite a populated accessibility tree. Those captures are excluded from this directory.

Later recovery fixes do not change the pictured layout or styles. On `418e2cb685d44052c8361aafa4e789d5c6d71225`, the actual React hook passed ten Computer Use checks with synthetic HTTP responses: canceled opens at both asynchronous boundaries after New or a replacement open, normal history, a failed new message's Retry, New conversation, opening history, genuine handoff Retry, and late-observer isolation. Reopening the original source conversation on this candidate did not start work automatically; Open recovered the exact target with its answered question, superseded first proposal and applied replacement. The preceding `6a4cd12` control failed because a canceled open still submitted its continuation. The earlier `8c3dfe7` control failed because Retry followed an old handoff.

This is candidate evidence on a small synthetic setup. The screenshot and keyboard checks passed on candidate source; they do not verify a published binary. Comfort and physical keyboard behavior were not measured.

To repeat the hook checks, build the isolated fixture, then serve it outside the build queue:

```sh
agent-work run -- bun test/web/chat-handoff-recovery-server.ts build /tmp/keyloom-handoff-check
bun test/web/chat-handoff-recovery-server.ts serve /tmp/keyloom-handoff-check 4514
```

Open the printed loopback URL and choose Run recovery checks. The expected result is `PASS 10`. The fixture uses the actual React hook with synthetic HTTP responses; it does not use the app database or a model.
