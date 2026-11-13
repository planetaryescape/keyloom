# Glove80 image executes a mutable installer expression

Status: Fixed in local commit `9a921f3a`. Pending independent review, merge and release. Candidate removes the installer and writes the cache URL and signing key directly to Nix configuration.

Security review: SEC-A4, 13 November 2026. Reproduced at `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`. Relevant source is unchanged at `054d416922af8c65f70a6e993a0a1ae6da45667d`.

The Dockerfile installed and executed Cachix from https://cachix.org/api/v1/install without immutable content verification.

The original review used synthetic files and injected runners. It performed no real firmware build or keyboard write. The candidate regression lives in `test/firmware/zmk/build.test.ts`. Run the focused check from the repository:

```sh
bun test test/firmware/zmk/build.test.ts
```

Candidate removes the installer and writes the cache URL and signing key directly to Nix configuration.
