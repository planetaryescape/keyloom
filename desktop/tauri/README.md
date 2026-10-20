# keyloom desktop shell

A Tauri v2 shell around the unchanged `keyloom serve` ([chapter 26](../../docs/blueprint/26-desktop-app.md)). It runs the release `keyloom` binary as a sidecar, shows its page in a window, and mirrors `/api/events` into a menu-bar extra and native notifications. The server words every string the shell shows; the Rust has no product logic.

## Build

```sh
bun run scripts/build-binaries.ts --target bun-darwin-arm64     # at the repo root: writes dist/keyloom-darwin-arm64
cd desktop/tauri
sh scripts/fetch-sidecar.sh ../../dist/keyloom-darwin-arm64     # no argument: downloads the latest release's binary
bun install --frozen-lockfile
APPLE_SIGNING_IDENTITY="Developer ID Application: NAME (TEAMID)" agent-work run -- scripts/build.sh
```

The app lands in `src-tauri/target/release/bundle/macos/keyloom.app`. Without `APPLE_SIGNING_IDENTITY` it is unsigned. `bundle.macOS.entitlements` (`Entitlements.plist`) is applied by Tauri to the shell and to the sidecar; the bun binary dies with SIGTRAP under hardened runtime without them. The app's version is the root `package.json` version, passed to Tauri at build time so release-please never edits this folder.

The sidecar now contains the diagnostics-only Rust helper. The shell still starts only `serve`; no helper starts until doctor is requested. Sign a prebuilt Rust helper with `scripts/sign-device-helper.sh` **before** passing it to the root builder's `--helper` option. The release workflow does this using existing signing/notarisation secrets; Tauri cannot sign executable bytes hidden inside the Bun asset blob. Rust receives no Bun JIT entitlements. Installed signed/notarised helper extraction through the app remains a release check, not a result established by the local CLI test. See [helper build reference](../../native/device-helper/README.md).

The inherited bundle config says macOS 12.0; pinned Bun 1.3.14 documents a 13+ runtime requirement. This is not proof of 12.0 compatibility, and neither minimum OS was tested for this helper slice.

A signed build runs on the Mac that made it without notarisation, because nothing quarantines it. A downloaded copy is refused by Gatekeeper until it is notarised.

## What the shell does

- Starts `keyloom serve --port <last port or 0> --no-open --exit-on-stdin-close --reuse`. The server exits when the shell's pipe closes, so a crashed shell leaves nothing behind. `--reuse` makes the CLI print the address of a server already serving the same data directory and exit; the shell then attaches to that server and never stops it (D-323).
- Closing the window hides it; the menu-bar extra and Dock icon stay. Quit (menu bar or Cmd-Q) sends SIGTERM to a server it started and waits up to 30 seconds, so a keyboard write in progress finishes.
- Launch at login is a menu-bar checkbox and is off until it is ticked.

## Notarisation (needs BK)

The release workflow's `build-desktop` job signs when `APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD` and `APPLE_SIGNING_IDENTITY` exist, and notarises and staples when either set below exists. Without them it still uploads the app and adds a note to the release.

| Secret | Value |
| --- | --- |
| `APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD` | the Developer ID Application certificate exported as .p12, base64, and its password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: BHEKANI KHUMALO (WAVMJLFY95)` |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8` | an App Store Connect API key: its id, the issuer id, and the .p8 file's contents |
| or `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID` | an Apple ID, an app-specific password and `WAVMJLFY95` |

## Auto-update (disabled until a key exists)

The updater is compiled in only with the `updater` Cargo feature, so a build without a key cannot try to update. To turn it on:

1. `bunx tauri signer generate -w ~/.tauri/keyloom.key` (keep the private key; losing it strands installed apps).
2. Add the private key as `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) and the public key as `TAURI_UPDATER_PUBKEY` in the repo's Actions secrets.

With all of those present the release job builds with `--features updater`, merges `tauri.updater.example.json` with the public key, and uploads `keyloom.app.tar.gz`, its `.sig` and `latest.json`. The app checks at launch and every six hours, installs what it finds and notifies; the new version runs from the next launch.
