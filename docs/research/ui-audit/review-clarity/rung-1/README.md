# Rung 1 review clarity evidence

These screenshots use the synthetic full-App/Viewer fixture on port 4531. A validated Glove80/ZMK proposal is returned by the config proposals API and changes a tap/hold term, a 23-to-40-position trigger set, and swaps two base-layer keys. Screenshots show the keyboard alongside Current/Proposed rows and changed-key details. The browser runner inspects all 40 proposed positions, pins the proposal, confirms the source revision does not change during preview, then activates Apply with Enter and verifies the persisted profile and both bindings match the exact proposal ops.

| Viewport | Light | Dark |
|---|---|---|
| 1440×900 | [screenshot](1440-900-light.png) | [screenshot](1440-900-dark.png) |
| 1100×577 | [screenshot](1100-577-light.png) | [screenshot](1100-577-dark.png) |
| 390×844 | [screenshot](390-844-light.png) | [screenshot](390-844-dark.png) |

[Pinned keyboard preview before Apply](preview-before-apply.png)

The browser run checked panel bounds and overflow at 1440×900, 1100×577 and 390×844 in light and dark themes. Screenshots were inspected at desktop, short/narrow and phone sizes. The phone review panel scrolls internally while the keyboard stays behind it. Unit coverage separately checks invalid linked proposals: their stored body is withheld, “source checked” is absent, and preview/Apply are unavailable.

No released binary, installed app/CLI, native helper, firmware runtime, physical keyboard or typing outcome was tested. The fixture uses an in-memory FakeEditor; no model, firmware build, device or real config was involved.
