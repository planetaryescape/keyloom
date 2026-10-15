# A build can read a stale file keyloom just wrote, under Colima

The first v0.12.0 Glove80 build (`bld_01M50CF3YN7FJM59B2E7EBWXNS`, 2026-10-15) read a truncated `default.nix`; the next build with the same file passed. `a6522c5` now writes every file it puts in a mounted checkout to a temp name and renames it into place (`src/firmware/toolchain/write-fresh.ts`).

That narrows the window but doesn't close it. A probe on BK's Colima sshfs mount showed a rename onto an existing name served at its old size for about a second, and a deleted-and-recreated folder the same; only a never-seen name was read correctly at once. The remaining fix: before the build, compare the files' hashes inside the container with the host's and wait until they match (one extra `docker run`, and the three fake-docker test files need updating).
