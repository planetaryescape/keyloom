# Conditional-layer IDs admit source directives

Status: Fixed by merge commit `700cf2345b24bbdeaaae2e477512859868f560c0`, pending release.

Security finding: SEC-B2. Reproduced on `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`. Relevant source remains unchanged on main `054d416922af8c65f70a6e993a0a1ae6da45667d`.

Candidate validates conditional IDs before proposal storage and checks the same rule during ZMK generation. Safe imported IDs remain supported.

Run the regression from the repository:

```sh
bun test test/agent/conditional-layers.test.ts
```

No keyboard access, real firmware build or installed-file change formed part of this reproduction.
