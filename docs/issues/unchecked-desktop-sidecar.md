# Desktop packaging accepted a sidecar without checking its checksum

Status: fixed by merge commit `3499376af34d1c9348f9f6477df5d6a48a59efe6`, released in v0.80.0. Observed on main `054d416922af8c65f70a6e993a0a1ae6da45667d`, 2026-11-13. Security finding SEC-C3.

`desktop/tauri/scripts/fetch-sidecar.sh` downloaded or copied a CLI executable directly into the desktop bundle inputs. Neither branch verified `SHA256SUMS`. The release workflow passed a downloaded local file through the same unchecked path.

The security reproduction supplied an unrelated executable through a fake curl command. The sidecar script accepted it and never requested `SHA256SUMS`. In the paired reproduction, `install.sh` rejected the same bytes against the wrong checksum. This establishes an integrity-check gap. It does not establish a compromise of GitHub or a published app.

The fix stages the binary and manifest before verification. It requires one exact entry for the selected Mac architecture. Matching bytes replace the sidecar through an atomic rename. Download and verification failures preserve the previous sidecar and remove staged files. Local builds require `SHA256SUMS` beside the supplied binary. The release workflow now downloads that manifest too.

Run the synthetic regression checks from the repository root:

```sh
agent-work run -- bun test test/scripts/fetch-sidecar.test.ts test/scripts/sign-device-helper.test.ts
```

All 14 tests passed on candidate `fc3766a728053cedc1928d7d2ffe2398952cd416`. They check architecture selection, release paths, local files, checksum rejection, failed downloads, and preservation of the previous sidecar. The helper-signing tests also pass. All payloads and download commands are synthetic. No real asset download, signing, app launch, or installed update occurred for this check.

A checksum from the same release checks consistency. It does not establish publisher identity or notarization. The [standalone macOS CLI signature issue](standalone-macos-cli-signature.md) remains open and separate. [D-569](../blueprint/14-decision-log.md#d-569-verify-the-sidecar-checksum-before-replacing-the-executable) records the packaging contract.
