#!/bin/sh
# Builds keyloom.app into src-tauri/target/release/bundle/macos/. The sidecar must already be in src-tauri/binaries (fetch-sidecar.sh).
#   APPLE_SIGNING_IDENTITY="Developer ID Application: ..." scripts/build.sh   # signed, hardened runtime, with Entitlements.plist
#   scripts/build.sh                                                         # unsigned
# Extra arguments go to `tauri build`, for example `--config tauri.updater.json --features updater`.
set -eu
cd "$(dirname "$0")/.."
version="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' ../../package.json | head -1)"
# The app's version is keyloom's: Tauri reads it from the config, so it is passed here rather than kept in two files.
exec bunx tauri build --bundles app --config "{\"version\":\"$version\"}" "$@"
