#!/bin/sh
# Installs the keyloom binary from a GitHub release and verifies it against SHA256SUMS.
#
#   install.sh                  install the latest release
#   install.sh --version v0.1.0 install a specific release
#
# Environment:
#   KEYLOOM_INSTALL_DIR    where to put the binary (default: $HOME/.local/bin)
#   KEYLOOM_DOWNLOAD_BASE  release base URL, for mirrors and tests
#                          (default: https://github.com/planetaryescape/keyloom/releases)
set -eu

DEFAULT_BASE="https://github.com/planetaryescape/keyloom/releases"
BASE="${KEYLOOM_DOWNLOAD_BASE:-$DEFAULT_BASE}"
INSTALL_DIR="${KEYLOOM_INSTALL_DIR:-$HOME/.local/bin}"
VERSION=""

die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<USAGE
usage: install.sh [--version vX.Y.Z]

Installs keyloom to \$KEYLOOM_INSTALL_DIR (default \$HOME/.local/bin).
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || die "--version needs a value, for example --version v0.1.0"
      VERSION="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#--version=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1 (try --help)"
      ;;
  esac
done

if [ -n "$VERSION" ]; then
  printf '%s\n' "$VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' ||
    die "--version must look like v0.1.0, got: $VERSION"
fi

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

asset="keyloom-${os}-${arch}"
case "$asset" in
  keyloom-darwin-arm64 | keyloom-darwin-x64 | keyloom-linux-x64) ;;
  *) die "no keyloom release binary for ${os}-${arch} (available: darwin-arm64, darwin-x64, linux-x64)" ;;
esac

command -v curl >/dev/null 2>&1 || die "curl is required"

# Resolve "latest" to a tag first, so the binary and SHA256SUMS come from the same release
# even if a new one is published mid-install, and so the output names the version.
if [ -z "$VERSION" ]; then
  latest_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "${BASE}/latest")" ||
    die "could not find the latest release at ${BASE}/latest"
  VERSION="${latest_url##*/}"
  printf '%s\n' "$VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' ||
    die "the latest release resolved to an unexpected tag: $VERSION"
fi
release_url="${BASE}/download/${VERSION}"

if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  die "sha256sum or shasum is required to verify the download"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

fetch() {
  curl -fsSL -o "$2" "$1" || die "download failed: $1"
}

fetch "${release_url}/${asset}" "$tmp/$asset"
fetch "${release_url}/SHA256SUMS" "$tmp/SHA256SUMS"

expected_lines="$(awk -v name="$asset" '$2 == name { print $1 }' "$tmp/SHA256SUMS")"
expected_count="$(printf '%s' "$expected_lines" | grep -c . || true)"
[ "$expected_count" -eq 1 ] || die "SHA256SUMS has ${expected_count} entries for ${asset}, expected 1"
expected="$expected_lines"
actual="$(sha256_of "$tmp/$asset")"
if [ "$actual" != "$expected" ]; then
  die "checksum mismatch for ${asset}: expected ${expected}, got ${actual}. Nothing was installed."
fi

installed_version="$VERSION"

mkdir -p "$INSTALL_DIR"
dest="${INSTALL_DIR}/keyloom"
cp "$tmp/$asset" "$dest.new"
chmod +x "$dest.new"
mv "$dest.new" "$dest"

printf 'installed keyloom %s to %s\n' "$installed_version" "$dest"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf 'add %s to your PATH to run keyloom\n' "$INSTALL_DIR" ;;
esac
