# Build inputs stay separate from build output

Firmware builds execute upstream build scripts and generated source. Their writable files must never supply trusted inputs to a later run.

The source reviewed here is `b38c0d4a4baff6e23958990dac2f47aa0c839599` (v0.80.6). The v0.80.5 security assessment covers build, input-validation and macOS distribution boundaries. It does not certify every application feature or physical keyboard behavior.

## Trusted sources have a separate writer

[`checkout.ts`](../src/firmware/toolchain/checkout.ts) downloads pinned repositories outside container-writable workspaces. Its cache identity includes the repository URL, full commit SHA and sorted requested submodules. It publishes a snapshot only after submodules succeed and the pin checks pass. Host Git never reads configuration from a prior build workspace.

[`workspace.ts`](../src/firmware/toolchain/workspace.ts) gives each run a unique sibling directory. The caller holds the board lock through container exit. The stable path becomes a post-run debug snapshot and never supplies later inputs. Removing and recreating a stable path is insufficient: the Colima SSHFS probe showed an orphaned bind following its replacement.

For West and QMK builds, [`source-volume.ts`](../src/firmware/toolchain/source-volume.ts) stages individual immutable archives into a new Docker volume. A separate copy container performs that step without generated firmware. The volume record appears only after the copy succeeds. User builds mount completed sources read-only. Compiler output stays in private container storage and never enters this cache.

Glove80 uses a fresh copy of its pinned template in the unique run directory and compiles through Nix. It does not use the West/QMK source-volume path. Its image configures the fixed MoErgo cache URL and public key directly, without executing a mutable Cachix installer.

Run the synthetic lifecycle regressions without enabling Docker tests:

```sh
agent-work run -- bun test test/firmware/toolchain/checkout.test.ts \
  test/firmware/toolchain/workspace.test.ts \
  test/firmware/toolchain/source-volume.test.ts \
  test/firmware/zmk/west-workspace.test.ts
```

These injected-runner checks cover contamination, interruption and cache publication. Real Docker and board-build evidence remain separate. [Storage measurements](research/firmware-build-local-storage.md) record their source identities and platform limits.

## Pins and validation protect different boundaries

[`west-inputs.json`](../src/firmware/zmk/west-inputs.json) locks the transitive West projects. [`west-workspace.ts`](../src/firmware/zmk/west-workspace.ts) refuses an unreviewed ZMK source identity. Builds do not run `west update`. A changed upstream manifest requires a reviewed lock update.

Path guards check lexical containment and symlinks before generated-file writes and cleanup. They complement source isolation. They do not alone protect against concurrent hostile directory replacement. Typed setting edits reject new opaque source while retaining unchanged imported expressions. Conditional-layer IDs receive validation before storage and again during generation.

```sh
agent-work run -- bun test test/firmware/qmk/write-source.test.ts \
  test/validation/firmware-setting-source.test.ts \
  test/agent/conditional-layers.test.ts test/agent/tool-input-limits.test.ts
```

The tool-input regression also checks that an oversized array reaches no element refinements or tool effects. Bounded error formatting alone cannot establish that property. The installed Zod dependency must match the patched lock, not merely the declared version.

## Release checks make separate claims

| Check | Claim supported | Remaining boundary |
|---|---|---|
| Exact asset entry in `SHA256SUMS` | Downloaded bytes match that manifest | The manifest alone does not establish publisher identity |
| Strict signature verification | Signed code passes seal validation | An ad hoc signature does not establish Developer ID |
| Developer ID requirement | The certificate satisfies the specified Apple certificate policy | Check the expected publisher identity separately |
| Hash-bound Accepted CLI/helper receipts | Apple accepted the submitted artifacts associated with those final bytes | Runtime and installation still need checks |
| Matching-runner installed-pair smoke | Published CLI starts and extracts its paired helper on that architecture | It performs no keyboard acceptance test |
| Installed app/archive comparison and live identity | The installed files and running server match the recorded release | Other platforms and later versions need their own evidence |

The [release workflow](../.github/workflows/release.yml) signs the visible Rust helper before embedding. It signs the final Bun CLI after compilation, before upload and final checksum generation. Rust receives no Bun JIT entitlements. Separate steps without signing credentials check the final pair. Both Mac architectures then download and check the published assets. Tauri signs the desktop sidecar again, so its hash can differ from the standalone CLI hash.

Follow [Verify the desktop installation](verify-desktop-install.md) for read-only installed-byte and live-version checks. The [signature issue](issues/standalone-macos-cli-signature.md) preserves the old failure and v0.80.4 publisher proof. Do not treat the historical sidecar workaround as the current standalone delivery path.

## Evidence keeps its original scope

A Git tree comparison can justify retaining source-based evidence after a documentation-only merge. It does not prove the installed dependency files or compiled binary are identical. Record those identities separately. Dependency audits also distinguish vulnerability records from maintenance, soundness and yanked-package warnings. The [dependency issue](issues/dependency-security-advisories.md) retains those limits.

No hardware write forms part of these documentation checks. The owner waived cross-provider review during the quality loop. That decision is not independent review evidence.
