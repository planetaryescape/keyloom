# kanata leaks a file descriptor per TCP client, then crashes

keyloom reloads kanata, and reads its layer names and virtual keys, over kanata's loopback TCP port (`src/firmware/kanata/client.ts`). Every request opens a new connection and closes it. kanata 1.12.0 keeps a file descriptor for each of those connections after the client has gone. Once the daemon reaches its open-file limit, the next connection panics in kanata's TCP thread. kanata's release profile sets `panic = "abort"`, so the panic kills the whole process and launchd restarts it. The MacBook keyboard drops kanata's remapping while that happens, and the request that caused the crash fails.

## Evidence

On BK's Mac, `/var/log/keyloom-kanata.log` held 488 panics by 2026-10-22, all with the same message:

```
thread '<unnamed>' (4407964) panicked at src/tcp_server.rs:179:48:
stream is clonable: Os { code: 24, kind: TooManyOpenFiles, message: "Too many open files" }
```

427 were at line 176 and 61 at line 179. The log shows 497 kanata start-ups, so nearly every restart followed one of these panics. The log has no timestamps, so the rate isn't known. `launchctl print system/dev.keyloom.kanata` showed `runs = 6` and `last terminating signal = Abort trap: 6` at 2026-10-22 00:15 BST. `launchctl limit maxfiles` is `256 unlimited`, and keyloom's plist set no limit, so the daemon had 256.

## What isn't confirmed

The leak below is real and reproduced in a test. But nothing showed which process opened enough connections to reach 256 that many times. A 10-second sample of connections to port 5829 on 2026-10-22 saw none, and keyloom opens one to three per apply or doctor run. Another descriptor leak inside kanata would surface at the same `try_clone`, and kanata runs as root, so its descriptors can only be counted with sudo. If the panics come back with the higher limit, sample the count first: `sudo lsof -p $(pgrep -x kanata) | wc -l`.

## Cause

In kanata `src/tcp_server.rs` at v1.12.0 (`02242ef`), and unchanged on main at `3878b6a`, the accept loop puts a clone of each client stream into the `connections` map. It clones again for the reader thread, and calls `try_clone().expect("stream is clonable")` both times. When the client disconnects, the reader iterator ends and its thread returns without removing the map entry. The entry, and its descriptor, stays until a broadcast write to it fails in `start_notification_loop` (`src/kanata/mod.rs`). Broadcasts only happen on layer changes and similar events, so a quiet laptop keyboard rarely prunes them. Under `EMFILE` the `expect` panics, which aborts kanata.

## Fix

Upstream: [jtroo/kanata#2227](https://github.com/jtroo/kanata/pull/2227) (head `197b4ca`). It removes the entry when the reader loop ends, and drops a client whose stream can't be cloned instead of panicking. Its test fails on main with "20 closed clients still registered".

keyloom: `launchDaemonPlist` (`src/firmware/kanata/plist.ts`) raises the daemon's soft open-file limit to 4096, so the leak takes far longer to exhaust it. The daemon only picks up the limit when it is reinstalled. Run `keyloom remap setup`, then boot out the old daemon and bootstrap the new plist. The doctor's install command assumes no daemon is loaded, so it can't do the reinstall on its own. Remove the limit once a kanata release with the upstream fix is the minimum keyloom supports.

Status: mitigated in keyloom by the plist limit; the root cause stays open until the upstream fix ships in a kanata release.
