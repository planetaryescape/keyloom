#!/bin/sh
# Tauri's externalBin wants binaries/keyloom-<target-triple>. Pass a keyloom binary (the one `bun run scripts/build-binaries.ts` wrote
# to dist/), or let this download the release that matches the app's version.
set -eu
src="${1:+$(cd "$(dirname "$1")" && pwd)/$(basename "$1")}"
cd "$(dirname "$0")/../src-tauri"
triple="$(rustc -vV | sed -n 's/^host: //p')"
case "$triple" in
  aarch64-apple-darwin) asset=keyloom-darwin-arm64 ;;
  x86_64-apple-darwin) asset=keyloom-darwin-x64 ;;
  *) echo "no keyloom release binary for $triple" >&2; exit 1 ;;
esac
mkdir -p binaries
if [ -n "$src" ]; then cp "$src" "binaries/keyloom-$triple"; else
  tag="${KEYLOOM_TAG:-latest/download}"
  case "$tag" in latest/download) path="latest/download" ;; *) path="download/$tag" ;; esac
  curl -fsSL "https://github.com/planetaryescape/keyloom/releases/$path/$asset" -o "binaries/keyloom-$triple"
fi
chmod +x "binaries/keyloom-$triple"
