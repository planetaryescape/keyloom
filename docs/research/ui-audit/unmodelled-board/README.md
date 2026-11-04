# Unmodelled keyboards keep the physical rendering

Run the isolated fixtures, then the browser check:

```sh
bun test/web/unmodelled-board-server.ts 0 split
bun test/web/unmodelled-board-server.ts 0 compact
# Pass the two localhost URLs printed above:
bun test/web/unmodelled-board.browser.ts '<split-url>' '<compact-url>' docs/research/ui-audit/unmodelled-board
```

The split fixture uses the Corne's firmware geometry with all crafted display data removed. The compact fixture uses a synthetic 42-key ortholinear layout with adjacent left/right hand assignments and no display data. Both run the real editor over an in-memory fake backend. No USB reads, credentials, builds, sync or flashing.

## Observed

Rerun on 2026-11-04 against origin/main 6afdc4b9 with this change applied. The app now opens on the pegboard home wall (D-478), so the browser check opens the board from the wall before checking the editor; it waits until the wall's entry animation has finished and the board can be clicked.

- Eight browser cases passed: both boards at 1440×900 and 390×844, light and dark. Screenshots are named `<split|compact>-<width>-<height>-<theme>.png` in this directory.
- All visible keys have the shared skirt and dished face. Generated cases have shaded tops and front walls; split halves remain separately rendered and the compact board has one continuous body.
- Split boards show one half on a phone. A wide one-piece board scrolls within its stage at the existing minimum cap size; scrolling reaches its last key without horizontal page overflow.
- Arrow navigation, Enter to open a key card and Escape to close it passed in all eight cases.
- `bun test test/web/case-shape.test.ts test/web/unmodelled-board.test.tsx test/web/stage-fit.test.ts test/web/contrast.test.ts test/web/led-contrast.test.ts`: 76 passed. These include unchanged crafted case paths, rotated key coverage, empty-case fallback, split-boundary cases and the setup preview's caps and body.
- `bunx tsc --noEmit` passed and `bun run depcruise` reported no violations.

The screenshots exercise the working source over the fake backend, not a published release. No real keyboard was read or written.
