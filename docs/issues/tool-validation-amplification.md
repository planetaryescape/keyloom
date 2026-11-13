# Tool validation amplifies oversized invalid arrays and errors

Status: Fixed by merge commit `700cf2345b24bbdeaaae2e477512859868f560c0`, pending release.

Security finding: SEC-C4. Reproduced on `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`. Relevant source remains unchanged on main `054d416922af8c65f70a6e993a0a1ae6da45667d`.

Candidate pins and overrides Zod to 4.6.7 for GHSA-mrhx-c7xc-m3w5, including the SDK copy. It caps returned issues and message sizes. No OOM probe ran.

Run the regression from the repository:

```sh
bun test test/agent/tool-input-limits.test.ts
```

No keyboard access, real firmware build or installed-file change formed part of this reproduction.
