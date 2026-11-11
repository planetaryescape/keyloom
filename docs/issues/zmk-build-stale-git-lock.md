# A cancelled ZMK build left a git lock that failed every later build

Status: fixed in `7d548f12`, with the orphaned-container check in `3f990e33`, which stops the build when that check or the removal fails or times out (`bbadce95`, `83f3b5a8`). The cleanup line was run in the board's build image against the Corne's checkout with a planted `modules/hal/stm32/.git/index.lock`; it removed the lock, logged it and exited 0.

Seen 2026-11-11 on the Keebart Corne's checkout (`~/.cache/keyloom/build/keebart-corne-choc-pro-bt`). A build stopped during `west update` (the build queue ended it as idle) left `modules/hal/stm32/.git/index.lock`. The next build failed:

```
=== updating hal_stm32 (modules/hal/stm32):
fatal: Unable to create '/work/modules/hal/stm32/.git/index.lock': File exists.
ERROR: update failed for project hal_stm32
```

Every later build of that board would fail the same way, including a sync after an Apply in the app.

## Fix

`westScript` removes any `*.lock` under each west project's `.git` before `west update`, and prints `keyloom: removed a stale git lock <path>` for each. keyloom holds the checkout's lock (`withLock` in `src/firmware/zmk/build-west.ts`) for the whole build. A keyloom killed mid-build can leave its container running, because a container doesn't depend on its client. Killing a `docker run --rm` client with `SIGKILL` left the container running, and the daemon removed it only once it exited (Docker 29.6.2 client, 28.4.0 engine, 2026-11-11). So each build container carries the label `dev.keyloom.checkout=<checkout>` and a build first removes any container with its checkout's label. After that no git runs there and any lock found is stale. Checked against the real engine: `docker ps -aq --filter label=dev.keyloom.checkout=<path>` found a labelled container by a path with spaces, matched no other path, and `docker rm -f` removed it.
