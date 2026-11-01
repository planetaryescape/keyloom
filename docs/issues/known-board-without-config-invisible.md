# A board keyloom knows but has no config for was invisible

Status: fixed in `b95012e` (PR 206, v0.61.0), 2026-10-30.

Removing the Moonlander's configs to test setting it up from scratch left the keyboard plugged in, recognised, and impossible to set up from the app. The new-keyboard card only fires for boards keyloom has no definition for, and the board switch is built from configs (`boardEntries` in `src/web/shell/Header.tsx`), so a known board with no config appeared nowhere. Plugging it in produced no card, no switch entry and no prompt. The CLI's `keyloom keyboard add` at least answered "already a board … Put a config on it with `keyloom keyboard put <layout> --on <board>`"; the app said nothing.

The only web path in was the import screen, reached through another board's config menu, and its Moonlander card accepts only the Oryx `.zip`. There was no "put one of my configs on it" and no "start blank" outside the unknown-keyboard flow.

The sync engine now publishes known boards on USB that have no `board_config` row beside the unknown keyboards (`setupBoards` on the sync event). The page shows a setup card for each, with three choices: put one of the person's configs on it (the existing put step), import the board's own export, or start blank. A chip in the board switch keeps the card one click away after "Not now". The card closes if the board gets a config elsewhere or is unplugged.

Evidence from the test: with the Moonlander connected and its configs removed, loading the app produced no card and no switch entry; after the fix it produced "Your Moonlander has no config yet", the put created a config and opened its proposals, "Start blank" created a config and made it the board's, and "Import a layout" opened the import screen with the Moonlander card first. `test/app/sync-new-keyboards.test.ts` covers the published list: a known board with a config is not offered, one without is. The full suite passes, type checking passes, and depcruise reports no violations.
