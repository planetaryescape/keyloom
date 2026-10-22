# A UF2 copy that ends with ENXIO is taken as done, even when it was cut short

When keyloom copies a UF2 image to a Glove80 half's boot drive, a copy that ends with `ENXIO` while the drive unmounts counts as complete. That's because the bootloader unmounts the drive once it has every block (`src/firmware/toolchain/uf2.ts`).

On 2026-10-22 the left half's copy ended that way during a hands-free reflash (`fl_01M5H5PV3KVFCCR64T69PA472S`, published v0.49.0). The half then never came back on USB. It returned only after BK started it in its bootloader by hand (Magic + E at power-on), when a rewrite verified (`fl_01M5HD0018N66TVKPFR5DSJW1E`). So that copy was most likely truncated: the drive went away before the last blocks were written.

The post-flash check caught it, so nothing was reported as verified. But the message ("didn't come back within 45 seconds … check its USB cable") points at the cable, when the half actually needs its bootloader key and a rewrite.

Fix:
- Treat an `ENXIO`-ended copy as unconfirmed, not done.
- When the half then doesn't come back, say that it may have incomplete firmware, and give that half's bootloader instruction so the user can rewrite it. The rewrite needs no other recovery.
- Add a test with a fake volume that unmounts mid-copy.

Status: the remedy is fixed on `fix/uf2-copy-unconfirmed`; split-flash rollback is implemented in Stage 9 (D-437), awaiting the orchestrator's commit. A half that doesn't come back is now told its firmware may be incomplete and given its own bootloader instruction to rewrite it, before the cable advice. The copy itself still counts an ENXIO-plus-unmount ending as done, because on 2026-10-16 exactly that ending was a complete write; the post-flash check is what tells the two apart.


Split-flash recovery is implemented in the uncommitted Stage 9 change on `feat/split-flash-rollback`, based on `583e39b3474ca3eb3b702f10583bb2e437eedce5` (D-437). The orchestrator will record the fixing commit. Last-good promotion waits for both halves to verify. If a later half fails, the verified halves are restored to their saved build; an absent or unknown failed half then gets its own bootloader instruction, saved image and verification. Recovery stays a failed flash and sync, with both final states in the error and log. Without a usable saved image, or after a restore failure, the error gives the manual recovery step. An already mounted drive shared by both halves is ambiguous and stops recovery.

`test/firmware/zmk/split-rollback.test.ts` injects an ENXIO-ended copy followed by a half that never returns, then supplies its fake bootloader and verifies both halves on the old key. App tests check failed flash persistence, sync status behind the head, unchanged last-good images and the existing Flash again path. All device checks use `test/helpers/fake-zmk-halves.ts`; no hardware rollback is claimed.
