# Some tests fail on a loaded machine or a slow CI runner

Seen on 2026-10-15, each passing on rerun:

- `test/firmware/qmk/flash.test.ts` "Ctrl-C stops zapp …" (aborts after a 300 ms timer) failed once locally at load average ~6, then passed 5 of 5.
- `test/cli` "output formats > ids prints one id per line …" and `test/firmware/qmk/handsfree.test.ts` "the firmware wrapper, compiled for the host …" hit bun's 5 s default timeout on CI run 38802040978 (release PR head `1d59b1f`); the rerun passed.

The compile and CLI tests do real work (a C compile, CLI subprocesses), so they need explicit timeouts sized for a slow runner. The zapp test should wait on zapp's own "waiting" output before aborting instead of a fixed 300 ms. The sync-engine burst tests were fixed the same way in `4b82bb1` (a test-held clock).
