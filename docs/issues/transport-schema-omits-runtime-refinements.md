# The generated transport schema is looser than the runtime checks

`native/device-helper/protocol/transport-v1.schema.json` permits event `seq: 0` and duplicate entries in `capabilities`, while the Zod definitions in `src/firmware/toolchain/device-helper/transport-protocol.ts` reject both through refinements. Regenerating the schema with `bun scripts/gen-device-helper-schema.ts` and comparing it byte for byte proves only that the generator is deterministic. It does not prove the canonical schema states what both sides enforce.

Nothing accepts the bad values today: the TypeScript client rejects them at runtime, and the Rust side emits sequences starting at 1. The risk is the schema being trusted as the wire contract for a new backend (serial, Linux, Windows) when it is weaker than the real one.

## What would fix it

Express the refinements in the schema (`minimum: 1` for `seq`, `uniqueItems: true` for `capabilities`), or have the generator fail when a refinement has no schema equivalent. Add a shared fixture that both languages reject.

Status: fixed in 0df6609 (PR 176), released in v0.54.0.

The generated transport schema now states the positive sequence minimum, unique capabilities, and base64/length constraints where JSON Schema can express them; the generator rejects undocumented custom refinements. Shared refinement fixtures are rejected by the Zod schemas, and the schema test checks the corresponding JSON Schema keywords.

Left as documented runtime-only rules (Codex review of the fix, 2026-10-22): at 5,464 characters the schema can't tell 4,096 decoded serial bytes from 4,097 or 4,098, so the 1–4,096-byte limit stays a Zod and Rust check marked `x-runtime-refinement`. The generator's guard accepts one allowance per schema, so a second refinement added to an already-allowed schema would pass unnoticed; tightening it to one allowance per refinement is still open.
