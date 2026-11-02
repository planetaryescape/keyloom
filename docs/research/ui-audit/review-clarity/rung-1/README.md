# Rung 1 review clarity evidence

These screenshots use the synthetic full-App fixture on port 4531. They show the keyboard alongside the review panel, including the explicit unavailable-proposal state. The fixture has no linked proposal, so this evidence verifies that an old stored body is withheld when its proposal cannot be resolved; it does **not** verify a live proposal's changed-field rows, key scope, preview, or Apply journey.

| Viewport | Light | Dark |
|---|---|---|
| 1440×900 | [screenshot](1440-900-light.png) | [screenshot](1440-900-dark.png) |
| 1100×577 | [screenshot](1100-577-light.png) | [screenshot](1100-577-dark.png) |
| 390×844 | [screenshot](390-844-light.png) | [screenshot](390-844-dark.png) |

The browser run checked panel/text/control bounds, page and panel horizontal overflow, vertical scrolling without moving the keyboard, at 1440×900, 1100×577 and 390×844 in light and dark themes. It passed. Screenshots were inspected at desktop and phone sizes. The footer remains visible; the phone panel scrolls internally while the keyboard stays behind it.

No released binary, installed app/CLI, native helper, firmware runtime, physical keyboard or typing outcome was tested. The remaining linked-proposal acceptance requires a fixture with a real validated proposal and persisted synthetic apply, plus keyboard-only preview and Apply.
