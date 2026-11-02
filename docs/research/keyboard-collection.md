# Keyboard collection verification

2026-11-02; working branch `fix/keyboard-collection`, based on v0.68.3. Design: D-476 and [chapter 22](../blueprint/22-new-keyboard.md).

## Reproductions

- The previous desktop silhouette strip occupied about 2,070 px with 40 boards in a 1,440 px viewport. Its replacement uses one searchable trigger and a bounded list.
- The reported Corne config was archived, but the switcher still counted it. `boardEntries()` now excludes archived configs; archived-only boards remain recoverable through the collection.
- Setup previously depended on an existing layout page. The empty-collection page now hosts the detection, manual catalogue and firmware-search flows.
- The contribution promise had no export command. The app and CLI now prepare a board-only handoff; a person still reviews the model and opens the PR.

## Repeat the browser checks

Run `bun test/web/keyboard-collection-server.ts 59801 40 manual`, then open `http://127.0.0.1:59801/?t=collection-browser-token`. Use count `0` for first-run setup, or replace `manual` with `usb` for synthetic Corne detection. Each server creates a scratch database. Builds and flashes throw; no real transports or paid models are used.

Checked at 1440×900 and 390×844, in light and dark themes:

- Search for Keyboard 40, select it with ArrowDown/Enter, and switch without header overflow. Measured document widths were 1440 and 390 px respectively.
- Open Manage keyboards from the picker, filter, confirm removal, restore from Removed and reopen the selected config.
- Remove the last keyboard, retain the open collection dialog over the welcome page, and restore it.
- Escape closes the native dialog and returns focus to the picker trigger.
- Download a contribution and receive the no-personal-layouts/no-publication confirmation.
- Complete synthetic USB identification and manual firmware search, choose a controller, add the board and start the first config without a device write.
- Inspect the generated Corne body, sculpted caps and shaded enclosure on desktop and a phone. Crafted cases still take precedence. Empty custom-case arrays fall back to generated geometry; adjacent hands share a one-piece body.

The scoped collection accessibility audit found no violations; its contrast checks were incomplete and require visual review. Screenshots were inspected locally, not committed. The browser fixture uses real collection/config routes with fake editor actions and fake USB; it does not establish physical-device behavior.

## Safety checks

App tests cover preserved history, restart persistence, paused restore, legacy archived-only recovery, idempotence, unknown IDs, sync/resume refusal, removal during a preflight read, active sync refusal and an in-progress manual flash. CLI/API tests cover authentication, malformed requests, output collisions and board-only contribution data. Renderer tests cover empty-case fallback and one-piece detection.

A compiled CLI was driven against scratch data through migration, list, remove, restore and contribution export. No real user data, keyboard firmware, installed app or installed CLI was changed. Collections still group by board model; independent targeting of multiple physical copies is outside this change.

## Pre-release review follow-up

The PR review prompted additional checks: legacy archived-only boards also require restore before config creation; removal reaps a dead sync owner without touching live operations; config creation checks membership in its write transaction; JSONL lists emit one keyboard per line; failed exports clean up only their own new directory.

Browser verification confirmed that restore keeps the paused-sync notice visible until the person chooses Open. With collection refresh requests deliberately aborted, a successful remove/restore still updates local membership, refreshes the parent and distinguishes the refresh failure from the completed action. Manual catalogue mapping renders the known board, and the searchable popup's search field sits outside its nested menus. The scoped picker audit found no violations; off-screen contrast checks remained incomplete.
