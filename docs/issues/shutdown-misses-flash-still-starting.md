# Server shutdown can miss a manual flash that is still starting

Server shutdown waits for manual editor flashes before closing the device helper (`drainManualFlashTasks` in `src/app/firmware.ts`, called from the `serve.ts` stop hook). It only sees flashes already registered in `flashTasks`, though. `startFlash()` awaits the artifact check before it creates the flash row and registers the task. A shutdown that snapshots the map in that window misses the flash, and the helper can close while that flash goes on to reboot the keyboard.

The window is a few milliseconds, and `serve.ts` stops accepting HTTP requests before draining, so only a request already inside `startFlash` is exposed. Before PR 141, shutdown waited for no manual flash at all.

## What would fix it

Register the start before `startFlash`'s first await, for example as a pending entry that the drain also waits for, and refuse new manual flashes once shutdown has begun. The test should call `startFlash` without awaiting it, start the drain, and then let the artifact check resolve. The existing test in `test/app/firmware.test.ts` awaits `startFlash` first, so it can't see this window.

Status: fixed in ef2e8f0 (PR 177), released in v0.54.0. Starts register before the artifact check, and shutdown closes admission before waiting for pending starts and running flash tasks. `test/app/firmware-shutdown.test.ts` covers the pending-start window, final callback completion, refused late requests and failed artifact checks.

Raised by the third independent Codex review of PR 141 on 2026-10-21. Triaged as should-fix: the window is narrow, the gap predates the PR, and the review rounds were finding progressively narrower cases.
