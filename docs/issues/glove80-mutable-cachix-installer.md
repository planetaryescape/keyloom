# Glove80 image executes a mutable installer expression

Status: Fixed by merge commit `700cf2345b24bbdeaaae2e477512859868f560c0`, released in v0.80.0. A new image and scratch firmware build passed at `a2d0bd9b`.

Security review: SEC-A4, 13 November 2026. Reproduced at `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`. Relevant source is unchanged at `054d416922af8c65f70a6e993a0a1ae6da45667d`.

The Dockerfile installed and executed Cachix from https://cachix.org/api/v1/install without immutable content verification.

The original review used synthetic files and injected runners. It performed no real firmware build or keyboard write. The candidate regression lives in `test/firmware/zmk/build.test.ts`. Run the focused check from the repository:

```sh
bun test test/firmware/zmk/build.test.ts
```

Candidate removes the installer and writes the cache URL and signing key directly to Nix configuration.

A real image build at `146d29a9` failed because the pinned base image lacks `/etc/nix`. The candidate now creates that directory before writing `nix.conf`.

The fixed image `keyloom-glove80:ce69e85f585c-b09e3de281` built successfully. A read-only probe with no network checks the cache URL, public key and `require-sigs = true`. The rebuilt CLI imported the public Glove80 fixture and produced an 834,048-byte UF2 containing both half families. Its SHA256 is `a470bc22724ccaab333d611d150a3fa7d73f6e01d95294211aff22080f841fc1`. No keyboard was flashed. Source isolation remains a separate gate under SEC-A2.
