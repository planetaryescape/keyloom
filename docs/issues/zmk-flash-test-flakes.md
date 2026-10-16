# The ZMK UF2 flash test flakes on its own

`test/firmware/zmk/flash.test.ts` fails about one run in three when run alone (reported 2026-10-16 by the UI builder while making the board-fit hotfix `427a8d5`, which doesn't touch firmware code). Not yet investigated. Likely the same pattern as the sync and zapp tests fixed in `4b82bb1` and `3f8e684`: a fixed sleep or short deadline racing the fake boot drive's mount and unmount. Find the failing assertion over 20 runs under load, then wait on the fake's own events instead of time.
