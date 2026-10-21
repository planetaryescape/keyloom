# The generated transport schema is looser than the runtime checks

`native/device-helper/protocol/transport-v1.schema.json` permits event `seq: 0` and duplicate entries in `capabilities`, while the Zod definitions in `src/firmware/toolchain/device-helper/transport-protocol.ts` reject both through refinements. Regenerating the schema with `bun scripts/gen-device-helper-schema.ts` and comparing it byte for byte proves only that the generator is deterministic. It does not prove the canonical schema states what both sides enforce.

Nothing accepts the bad values today: the TypeScript client rejects them at runtime, and the Rust side emits sequences starting at 1. The risk is the schema being trusted as the wire contract for a new backend (serial, Linux, Windows) when it is weaker than the real one.

## What would fix it

Express the refinements in the schema (`minimum: 1` for `seq`, `uniqueItems: true` for `capabilities`), or have the generator fail when a refinement has no schema equivalent. Add a shared fixture that both languages reject.

Not fixed: raised by the independent Codex review of PR 141 on 2026-10-21.
