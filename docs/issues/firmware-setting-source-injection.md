# Setting edits admit arbitrary firmware source

Status: Fixed by merge commit `700cf2345b24bbdeaaae2e477512859868f560c0`, pending release. New expression strings and source in setting names are rejected. Imported expressions remain unchanged or can become typed values.

Security review: SEC-A1, 13 November 2026. Reproduced at `8d09a1f58dab8ddfdb6e58457d0f988a440a62f9`. Relevant source is unchanged at `054d416922af8c65f70a6e993a0a1ae6da45667d`.

A setting string passed validation and introduced a C declaration in generated config.h.

The original review used synthetic files and injected runners. It performed no real firmware build or keyboard write. The candidate regression lives in `test/validation/firmware-setting-source.test.ts`. Run the focused check from the repository:

```sh
bun test test/validation/firmware-setting-source.test.ts
```

Candidate blocks new expression strings and source in setting names. Imported expressions remain unchanged or can become typed values.
