# Conditional-layer IDs admit source directives

Status: Fixed in local commit `056c005417aa0eb1ea4f639920000c83673ffb37`. Pending review, merge and release.

Security finding: SEC-B2. Reproduced on `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`. Relevant source remains unchanged on main `054d416922af8c65f70a6e993a0a1ae6da45667d`.

Candidate validates conditional IDs before proposal storage and checks the same rule during ZMK generation. Safe imported IDs remain supported.

Run the regression from the repository:

```sh
bun test test/agent/conditional-layers.test.ts
```

No keyboard access, real firmware build or installed-file change formed part of this reproduction.
