# A Print Screen key carries onto the MacBook, then stops its kanata config from generating

Status: fixed in ae08799 (PR 194), released in v0.56.1 (the copy and the validator refuse Print Screen on a MacBook layout, with the reason; kanata has no macOS name for it, so the table is unchanged). Found during stage T's verification, 2026-10-23. Checked on origin/main `f1ba5e6`.

`PRINT_SCREEN` has no kanata name in the key table: `kanataName("PRINT_SCREEN")` is `undefined`, and `keyName("PRINT_SCREEN")` (`src/layout/kanata/names.ts:10`) throws "PRINT_SCREEN has no kanata key name on macOS, so kanata can't send it".

A copy doesn't catch it. `keyboard put` of the MoErgo Glove80 template (`test/fixtures/zmk/glove80-template/glove80.keymap`, which has one Print Screen key) onto `apple/macbook-ansi` succeeds, and its JSON report doesn't name Print Screen among the keys not carried. The stage T worker reported that generating the MacBook config for such a layout then fails on this key. I didn't rerun generation, because a kanata generate on this machine could touch BK's running kanata.

Two questions settle the fix:
- Does kanata on macOS have a name for this key? Check kanata's key list at the pinned SHA that `scripts/gen-keycodes.ts` reads.
- If it doesn't, should the copy's kanata check (`kanataRefusal` in `src/layout/transfer.ts`) skip the key with this reason, as it does for other keys kanata can't write?

## Evidence (fix/five-kanata, base origin/main `45c67e9`)

Settled: kanata has no name for Print Screen that a macOS build can send.

- kanata v1.12.0 source at the pinned SHA `02242ef761ef43b860eac30067ce86904be7d466` (`scripts/gen-keycodes.ts` KANATA_SHA). `parser/src/keys/mod.rs` names it `PrintScreen`, `prtsc` and `prnt` only behind `#[cfg(target_os = "linux" | "windows")]`, so a macOS build has no name for `KEY_PRINT`. `parser/src/keys/macos.rs` maps `KEY_PRINT` to HID 0x07/0x46, so the key itself is sendable; it just has no name on macOS.
- The one name that does parse on macOS, `ssrq`/`sys`, is `KEY_SYSRQ`. `macos.rs` has no `PageCode` arm for `KEY_SYSRQ`, and `src/oskbd/macos.rs` `write_key` fails with "OsCode not recognized!", so that name is accepted by `kanata --check` and sends nothing.
- `kanata --check --cfg` on the installed 1.12.0 (`/opt/homebrew/bin/kanata`), one-key configs: `PrintScreen` exit 1, `prtsc` exit 1, `prnt` exit 1, `ssrq` exit 0, `sys` exit 0. Only `--check` was run.
- The generator's empty kanata column is what it produces at the pinned SHA: `bun scripts/gen-keycodes.ts --check` on fix/five-kanata printed `keycodes.ts is up to date`.
- Not built: `deflocalkeys` in a kanata config can map a name to an OsCode, so `KEY_PRINT` could be given a name in the generated file. That would be a new config feature, so it's left for a decision.

Before the fix, a scratch copy (`keyboard put` of the Glove80 template onto `apple/macbook-ansi`) carried the key, `change apply` accepted it, and generating the config failed with `validation_failed: this layout can't be written as kanata source: PRINT_SCREEN has no kanata key name on macOS, so kanata can't send it`.

After the fix, the same copy reports `lower_layer` position 21, `PrtSc`, as not carried with `it is Print Screen, which kanata can't send on macOS`. It has 111 keys, not 112. The applied copy generates `keyloom.kbd` and `safe.kbd`, and both pass `kanata --check` (exit 0). A direct `setBinding` of `PRINT_SCREEN` on the MacBook layout is refused by `change check` with `firmware_unsupported` (exit 4).

The fix is in `src/layout/transfer.ts` (`unsendable`, used for a key, a hold-tap's tap and a tap dance key slot), `src/validation/kanata-rules.ts` (`kanataSupport` now checks plain keys, hold-tap taps, combo outputs and tap-dance key slots through `keyName`), and `src/layout/kanata/names.ts` (the error names the key by its label).

Follow-up, not built: a `deflocalkeys` entry in the generated config could name `KEY_PRINT` on macOS, which would let the copy carry the key. It's a new config feature, so it's left for a later decision.
