# A cancelled ZMK build left a git lock that failed every later build

Status: fixed in `10397025`. The cleanup line was run in the board's build image against the Corne's checkout with a planted `modules/hal/stm32/.git/index.lock`; it removed the lock, logged it and exited 0.

Seen 2026-11-11 on the Keebart Corne's checkout (`~/.cache/keyloom/build/keebart-corne-choc-pro-bt`). A build stopped during `west update` (the build queue ended it as idle) left `modules/hal/stm32/.git/index.lock`. The next build failed:

```
=== updating hal_stm32 (modules/hal/stm32):
fatal: Unable to create '/work/modules/hal/stm32/.git/index.lock': File exists.
ERROR: update failed for project hal_stm32
```

Every later build of that board would fail the same way, including a sync after an Apply in the app.

## Fix

`westScript` removes any `*.lock` under each west project's `.git` before `west update`, and prints `keyloom: removed a stale git lock <path>` for each. keyloom holds the checkout's lock (`withLock` in `src/firmware/zmk/build-west.ts`) for the whole build, so no git process of keyloom's runs there and any lock found is stale.
