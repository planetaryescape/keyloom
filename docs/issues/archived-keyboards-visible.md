# Boards with only archived configs remained visible

Status: fixed in `ce53799` (v0.63.0, from `b8a00e0` on `fix/hide-archived-keyboards`), 2026-10-30.

The sync engine grouped every saved layout, including archived layouts. With a board's selection removed and its only config archived, the fallback still selected that archived config and showed the board. A newer archived config could also win the fallback over an active config.

`src/app/sync-engine.ts` now omits boards with no active configs and limits the missing-selection fallback to active configs. It retains archived layouts in the remaining facts so recognizing an older running config still works. This does not add a new keyboard-removal command; an active config remains protected from archive through the existing CLI.

Two regression tests reproduce both failures before the fix and pass afterward. Config and sync suites pass 94 tests; type checking passes. The installed CLI confirms the archived generic Corne is absent while the owner's Keebart Corne remains in sync. Private backups and recovery records remain outside the repository.
