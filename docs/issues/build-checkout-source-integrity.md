# Pinned checkout HEAD does not prove source contents

Status: Fixed by merge commit `16c4ad8feb86bdf42321dfd6ea9eb922c43f2053`, released in v0.80.0. Trusted pinned source stays outside container-writable build workspaces.

Security review: SEC-A2, 13 November 2026. Reproduced at `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`. Relevant source is unchanged at `054d416922af8c65f70a6e993a0a1ae6da45667d`.

A modified tracked Makefile passed ensureCheckout because HEAD stayed pinned, then reached the fake make runner. Writable builds can contaminate later builds.

The original review used synthetic files and injected runners. It performed no real firmware build or keyboard write. The candidate regression lives in `test/firmware/toolchain/checkout.test.ts`. Run the focused check from the repository:

```sh
bun test test/firmware/toolchain/checkout.test.ts
```

PR 331 keeps trusted pinned source outside container-writable build workspaces. The [v0.80.0 delivery receipt](../research/security-batch-release-v0.80.0.json) records publication and installation checks.
