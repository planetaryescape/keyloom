# QMK keymap paths can delete files outside the checkout

Status: Fixed by merge commit `700cf2345b24bbdeaaae2e477512859868f560c0`, pending release. Traversal and symlink escapes are rejected before source writes, cleanup and stale artifact removal.

Security review: SEC-A3, 13 November 2026. Reproduced at `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`. Relevant source is unchanged at `054d416922af8c65f70a6e993a0a1ae6da45667d`.

A schema-valid keymapsDir of ../victim made source cleanup delete synthetic data outside the checkout before Docker ran.

The original review used synthetic files and injected runners. It performed no real firmware build or keyboard write. The candidate regression lives in `test/firmware/qmk/write-source.test.ts`. Run the focused check from the repository:

```sh
bun test test/firmware/qmk/write-source.test.ts
```

Candidate rejects traversal and symlink escapes before source writes, cleanup and stale artifact removal.
