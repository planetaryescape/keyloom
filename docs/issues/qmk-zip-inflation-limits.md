# QMK ZIP imports need aggregate inflation limits

Status: Fixed by merge commit `700cf2345b24bbdeaaae2e477512859868f560c0`, pending release.

Security finding: SEC-B3. Reproduced on `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`. Relevant source remains unchanged on main `054d416922af8c65f70a6e993a0a1ae6da45667d`.

Candidate checks compressed bytes, entry counts, per-file size and total declared source before inflation. It inflates only the selected keymap folder. The review demonstrated bounded excess allocation, not OOM.

Run the regression from the repository:

```sh
bun test test/firmware/qmk/source-limits.test.ts
```

No keyboard access, real firmware build or installed-file change formed part of this reproduction.
