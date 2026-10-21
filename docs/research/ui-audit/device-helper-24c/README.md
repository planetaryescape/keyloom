# Incomplete recording fixture receipt

Captured 2026-10-20, reviewed again 2026-10-21. These are source-fixture screenshots, not released-app or physical-keyboard acceptance.

| Theme | 1440×900 | 390×844 |
|---|---|---|
| Dark | [Desktop](lab-incomplete-dark-1440.png) | [Phone](lab-incomplete-dark-390.png) |
| Light | [Desktop](lab-incomplete-light-1440.png) | [Phone](lab-incomplete-light-390.png) |

The fake backend used the public Oryx fixture, two synthetic key events and a synthetic disconnect, over scratch SQLite data. No real keyboard or typing was captured. Stop saved the partial trace; analysis refused it; the existing alert said to start a new recording and confirmed that the partial recording remained saved. The earlier-session row appeared after the refused analysis. Reopening it produced the same refusal.

The first screenshot batch found that the existing error was inside the desktop-only recording controls. Moving that same alert outside the branch made the final four screenshots readable at both widths without a new helper surface. Type, colours, spacing and the board stage remain those of [the design concept](../../../blueprint/23-design-concept.md). No new tokens or motion were added. Existing contrast tests, desktop/phone alert SSR tests, reduced-motion setting and keyboard activation of Close passed. Escape alone was not counted as a passing close test.

Source blob identities, unchanged from candidate `00e54a7` through the candidate-wiring revision:

- `src/web/lab/LabScreens.tsx`: `344ac7bc377575d5c6138f8fc0672a79ff0578aa`
- `src/web/lab/useLab.ts`: `99179f058138c621d24e6f1e863c43be98520b06`

The fake server and isolated browser session were stopped. Actual released UI/desktop and physical capture acceptance remain open; these images do not certify permission/busy copy introduced through other error cases.
