# Tool validation amplifies oversized invalid arrays and errors

Status: Fixed in local commit `9047908d8591f9325730f17b8956cf8342da4292`. Pending review, merge and release.

Security finding: SEC-C4. Reproduced on `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`. Relevant source remains unchanged on main `054d416922af8c65f70a6e993a0a1ae6da45667d`.

Candidate pins and overrides Zod to 4.6.7 for GHSA-mrhx-c7xc-m3w5, including the SDK copy. It caps returned issues and message sizes. No OOM probe ran.

Run the regression from the repository:

```sh
bun test test/agent/tool-input-limits.test.ts
```

No keyboard access, real firmware build or installed-file change formed part of this reproduction.
