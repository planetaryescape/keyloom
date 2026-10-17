#!/bin/sh
# Fills keyloom.rb's version and sha256 from a published release: packaging/homebrew/update-cask.sh v0.37.0
set -eu
tag="${1:?usage: update-cask.sh vX.Y.Z}"
version="${tag#v}"
cd "$(dirname "$0")"
sum="$(gh release download "$tag" --repo planetaryescape/keyloom --pattern "keyloom-$version-darwin-arm64.app.zip.sha256" --output - | cut -d' ' -f1)"
[ -n "$sum" ] || { echo "no checksum for $tag" >&2; exit 1; }
sed -i.bak -e "s/^  version \".*\"/  version \"$version\"/" -e "s/^  sha256 \".*\"/  sha256 \"$sum\"/" keyloom.rb
rm keyloom.rb.bak
