# Standalone macOS CLI has an invalid ad-hoc signature

Status: implementation prepared, pending release verification on both Mac targets. Published arm64 failures remain historical evidence until a new signed release passes the checks below.

Observed on the published arm64 CLI for v0.68.2 and the preserved normal v0.68.1 CLI during the v0.68.2 shipping checks, 2026-11-02. The desktop sidecar passes strict Developer ID signature verification. No other platform's CLI signature was assessed here.

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

`codesign -dv --verbose=4` describes the standalone binary as ad-hoc/linker-signed with no signing team. At v0.68.2, the release workflow signs/notarizes the Rust helper before embedding, but has no corresponding final-CLI signing step. Tauri signs the desktop sidecar later. That executable passes strict verification with team `WAVMJLFY95`. This establishes the packaging difference, not the precise cause of Bun's invalid ad-hoc seal.

## Local delivery used the already-signed release copy

For v0.68.2, BK's CLI on PATH is the unchanged signed sidecar extracted from the checksum-verified desktop ZIP. Its SHA-256 is `18e5c18acbe2b30205d6979ea78729ef2adc70d51606cd867835f4b150d3fe1e`, matching the installed bundle. Both installed surfaces report 0.68.2 and pass their applicable signature checks; the desktop also passes Gatekeeper's notarized-app assessment. Nothing was locally re-signed and no OS protection was bypassed.

The published standalone asset was not overwritten. Re-running the current official installer replaces the signed local CLI with that standalone asset again. See the [release receipt](../research/automatic-review-release-v0.68.2.json).

## v0.80.0 repeats the standalone failure

The published arm64 CLI matches SHA256SUMS (`0ee902aa8caee391a8efe8ee795bd2ce9f88ba6b2a60d64f766bcc2b99903fb5`) and reports `0.80.0`. Strict codesign verification still returns `invalid signature (code or signature have been modified)`.

The installed CLI uses the unchanged signed sidecar from the checksum-verified v0.80.0 desktop ZIP. Its SHA-256 is `7f3dff2fe2372dd8bfa37f59898a4b2880a877e067e498b90b6214ce038903c1`. Strict Developer ID verification passes with team `WAVMJLFY95`. The installed app passes Gatekeeper as Notarized Developer ID. Gatekeeper's app assessment of this copied CLI returns exit 3: `the code is valid but does not seem to be an app`.

Version, helper-only diagnostics and synthetic import/list checks pass through both installed executables. The app restarted normally, and its authenticated live server reports `0.80.0`. No local signing, OS-protection change or published-asset replacement occurred. The [delivery receipt](../research/security-batch-release-v0.80.0.json) keeps these checks separate. The official installer still supplies the standalone asset.

## Sign the final executable before hashing

The macOS release jobs now call `scripts/sign-device-helper.sh --bun-cli` after Bun compilation and before artifact upload.
This mode requires Developer ID and notarization credentials before changing the keychain search list.
It applies the existing desktop `Entitlements.plist`, verifies the Developer ID Application certificate requirement, and requires Apple's notarization status to be `Accepted`.
The default Rust helper mode keeps its existing behavior and receives no Bun entitlements.

A separate step without signing credentials verifies the final CLI and scratch-installs it with the real installer.
The existing smoke checks version, paired-helper extraction, corruption refusal, and public layout import/list behavior.
The job refreshes its checksum after signing. The fan-in job hashes the final uploaded bytes for published `SHA256SUMS`.
The desktop build can still re-sign its sidecar, so its final hash can differ from the standalone asset.

[Bun 1.3.14 documents explicit post-compilation signing and JIT entitlements](https://github.com/oven-sh/bun/blob/bun-v1.3.14/docs/bundler/executables.mdx).
Local ad hoc signing can prove seal validity and runtime behavior. It cannot prove publisher identity or Apple's notarization acceptance.

## Release verification remains required

Verify both Mac jobs' Developer ID checks and accepted CLI notarization receipts in the new release run.
Scratch-install each architecture's checksum-verified final asset on its matching Mac runner, then verify strict codesign, version and paired-helper behavior.
Keep the published hashes immutable. Any correction needs a new release.
Do not substitute local ad hoc signing or removal of quarantine/security checks for a valid released signature.
