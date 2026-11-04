# Build and flash dialog readability

Screenshots of the initial Build and flash dialog after the spacing and title update in `src/web/release/release.css`:

| Viewport | Light | Dark |
|---|---|---|
| 1440 × 900 | [1440-light.png](1440-light.png) | [1440-dark.png](1440-dark.png) |
| 390 × 844 | [390-light.png](390-light.png) | [390-dark.png](390-dark.png) |

Captured with `bun scripts/dev-editor.ts` and its fake backend, using the repository's synchronized Oryx sample. The desktop dialog has clear separation between its title, source summary, and two steps. At phone width, the title and explanatory copy wrap without clipping; both steps remain visible. The dialog is legible in both themes.

This is a local browser preview, not a screenshot from the released desktop binary. The flash action was not started.
