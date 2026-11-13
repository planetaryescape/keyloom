#!/bin/sh
# Tauri's externalBin wants binaries/keyloom-<target-triple>. Pass a keyloom binary (the one `bun run scripts/build-binaries.ts` wrote
# to dist/, with SHA256SUMS beside it), or download a release with its checksum manifest.
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
tmp="$(mktemp -d binaries/.keyloom-sidecar.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT INT TERM
die() { echo "$*; the existing sidecar was not replaced" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  die "sha256sum or shasum is required to verify the sidecar"
fi

if [ -n "$src" ]; then
  cp "$src" "$tmp/$asset" || die "could not read the local sidecar"
  cp "$(dirname "$src")/SHA256SUMS" "$tmp/SHA256SUMS" || die "SHA256SUMS must be beside the local sidecar"
else
  tag="${KEYLOOM_TAG:-latest/download}"
  case "$tag" in latest/download) path="latest/download" ;; *) path="download/$tag" ;; esac
  curl -fsSL "https://github.com/planetaryescape/keyloom/releases/$path/$asset" -o "$tmp/$asset" || die "sidecar download failed"
  curl -fsSL "https://github.com/planetaryescape/keyloom/releases/$path/SHA256SUMS" -o "$tmp/SHA256SUMS" || die "checksum download failed"
fi

# Match one exact asset, as install.sh does. Hash staged bytes so replacement cannot race a changing source file.
expected_lines="$(awk -v name="$asset" '$2 == name { print $1 }' "$tmp/SHA256SUMS")"
expected_count="$(printf '%s' "$expected_lines" | grep -c . || true)"
[ "$expected_count" -eq 1 ] || die "SHA256SUMS has $expected_count entries for $asset, expected 1"
actual="$(sha256_of "$tmp/$asset")"
[ "$actual" = "$expected_lines" ] || die "checksum mismatch for $asset"
chmod +x "$tmp/$asset"
mv "$tmp/$asset" "binaries/keyloom-$triple"
