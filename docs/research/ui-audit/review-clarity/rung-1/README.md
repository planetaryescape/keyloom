# Rung 1 review clarity evidence

These screenshots use the synthetic full-App/Viewer fixture on port 4531. The config proposals API returns three validated Glove80/ZMK proposals: a tap/hold profile and key change, a Save shortcut combo, and a native hold-layer retarget. Navigation and Numbers deliberately share the `MAG` legend, so the retarget changes the displayed effect without changing the keycap. The browser run inspects all six viewport/theme states, compares the combo's chord, scope, output and timeout, and checks that the native tap/hold effects are readable without serialized data. It also pins the profile proposal, confirms preview leaves the source revision unchanged, then activates Apply with Enter and checks the stored profile and bindings against the proposal ops.

| Viewport | Light | Dark |
|---|---|---|
| 1440×900 | [screenshot](1440-900-light.png) | [screenshot](1440-900-dark.png) |
| 1100×577 | [screenshot](1100-577-light.png) | [screenshot](1100-577-dark.png) |
| 390×844 | [screenshot](390-844-light.png) | [screenshot](390-844-dark.png) |

[Pinned keyboard preview before Apply](preview-before-apply.png)

| Additional comparison evidence | Screenshot |
|---|---|
| Combo values | [desktop combo comparison](combo-comparison.png) |
| Same-legend native retarget | [native effect comparison](native-retarget-comparison.png) |
| Phone comparison after scrolling to its controls | [390×844 scrolled comparison](390-844-scrolled-comparison-controls.png) |

The browser run checked panel bounds and overflow at 1440×900, 1100×577 and 390×844 in light and dark themes. The phone panel scrolls internally while the keyboard stays behind it; the scrolled screenshot shows the combo's chord-window value and Apply together. The desktop comparison shows all combo fields. UI tests also verify that a valid sensor edit and a moved unknown native binding are marked incomplete, omit “source checked”, and disable preview and Apply.

No released binary, installed app/CLI, native helper, firmware runtime, physical keyboard or typing outcome was tested. The fixture uses an in-memory FakeEditor; no model, firmware build, device or real config was involved.
