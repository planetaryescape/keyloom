# Dev sample draws the real Moonlander

Captured in headless Chrome (own profile, port 4495) on branch `fix/dev-sample-real-moonlander`.

- `before-dark-1440x900.png`: `scripts/dev-editor.ts` at `origin/main` (cbfc591). Plain rounded panels, no case outline or thumb clusters, keys out of order (top row 5 6 1 Esc 2 3 4), made-up keymap.
- `before-light-390x844.png`: the same HEAD dev editor at phone width, light theme.
- `after-dark-1440x900.png`: `scripts/dev-editor.ts` after the fix. Moonlander outline, thumb clusters, BK's published layers and layer colours, from the live board definition.
- `after-light-390x844.png`: the fixed dev editor at phone width, light theme. It shows the left half first, as the app does.
- `real-app-dark-1440x900.png`: the real `keyloom serve` on a scratch data dir with `test/fixtures/oryx/synchronized` imported as `zsa/moonlander`. The layout matches the fixed dev editor; the only difference is the "Moonlander not connected" status, which the fake backend does not show.
