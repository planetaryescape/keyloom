# Standalone macOS CLI has an invalid ad-hoc signature

Status: open. Observed on the published arm64 CLI for v0.68.2 and the preserved normal v0.68.1 CLI during the v0.68.2 shipping checks, 2026-11-02. The desktop sidecar passes strict Developer ID signature verification. No other platform's CLI signature was assessed here.

## Reproduce without changing a normal installation

```sh
case "$(uname -s):$(uname -m)" in
  Darwin:arm64)
    scratch="$(mktemp -d)"
    KEYLOOM_INSTALL_DIR="$scratch/bin" sh install.sh --version v0.68.2
    "$scratch/bin/keyloom" --version
    codesign --verify --strict --verbose=2 "$scratch/bin/keyloom"
    ;;
  *) printf '%s\n' 'This reproduction requires Apple Silicon macOS.' >&2 ;;
esac
```

Observed: the installer checksum passes and the CLI reports `0.68.2`, but `codesign` exits 1 with `invalid signature (code or signature have been modified)`. The published arm64 SHA-256 is `a464352d013434de5c815d5fd5d6aa111b94685f0398949e523719b59e2cb1dd`. The preserved v0.68.1 CLI also fails strict verification, so this was not introduced by the review UI repair.

`codesign -dv --verbose=4` describes the standalone binary as ad-hoc/linker-signed with no signing team. The release workflow signs/notarizes the Rust helper before embedding, but has no corresponding final-CLI signing step. Tauri signs the desktop sidecar later; that executable passes strict verification with team `WAVMJLFY95`. This establishes the packaging difference, not the precise cause of Bun's invalid ad-hoc seal.

## Local delivery used the already-signed release copy

For v0.68.2, BK's CLI on PATH is the unchanged signed sidecar extracted from the checksum-verified desktop ZIP. Its SHA-256 is `18e5c18acbe2b30205d6979ea78729ef2adc70d51606cd867835f4b150d3fe1e`, matching the installed bundle. Both installed surfaces report 0.68.2 and pass their applicable signature checks; the desktop also passes Gatekeeper's notarized-app assessment. Nothing was locally re-signed and no OS protection was bypassed.

The published standalone asset was not overwritten. Re-running the current official installer replaces the signed local CLI with that standalone asset again. See the [release receipt](../research/automatic-review-release-v0.68.2.json).

## Next gate

Reproduce on a newly built macOS release CLI, determine the final signing/entitlement requirements and sign the final executable before publishing its checksum. Verify installed `codesign --verify --strict`, version and paired-helper behavior on both Mac targets. Keep the published hashes immutable; any correction needs a new release. Do not substitute local ad-hoc signing or removal of quarantine/security checks for a valid released signature.
