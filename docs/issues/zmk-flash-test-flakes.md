# The ZMK UF2 flash test flakes on its own

`test/firmware/zmk/flash.test.ts` failed intermittently (reported 2026-10-16 while making `427a8d5`; failed CI on the v0.33.0 release PR with "Expected length: 2, Received length: 3" in "the file written to each drive is the artifact, byte for byte").

Cause found: the test polled the fake drives with `setInterval(async …)`, which starts a new tick every 10 ms without waiting for the last. Two ticks could both read the right half's file before either removed it, so one drive was counted twice. The ticks are now serialised with a busy flag.

After the fix: 0 failures in 60 runs alone and 10 runs under four busy CPU loops. One earlier loop of 25 showed 2 failures that never reproduced and whose output was not captured. If it fails again, capture the assertion before changing anything.
