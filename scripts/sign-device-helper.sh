#!/bin/sh
# CI-only signing of the visible Rust executable BEFORE hashing/embedding. Never give Rust Bun's JIT entitlements.
set -eu
umask 077
helper="$1"
[ "$(uname -s)" = Darwin ] || exit 0
if [ -z "${APPLE_CERT_P12_BASE64:-}" ]; then
  codesign --force --sign - "$helper"
  echo '::warning::Helper is ad-hoc signed, not Developer ID signed or notarised.'
  exit 0
fi
: "${RUNNER_TEMP:?CI runner temp is required}"
: "${APPLE_CERT_PASSWORD:?}"
: "${APPLE_SIGNING_IDENTITY_NAME:?}"
keychain="$RUNNER_TEMP/helper-$(uuidgen).keychain-db"
cert="$RUNNER_TEMP/helper-cert-$(uuidgen).p12"
key="$RUNNER_TEMP/helper-notary-$(uuidgen).p8"
archive="$RUNNER_TEMP/helper-$(uuidgen).zip"
cleanup() {
  rm -f "$cert" "$key" "$archive"
  security delete-keychain "$keychain" || true
}
trap cleanup EXIT INT TERM
password="$(uuidgen)"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
printf '%s' "$APPLE_CERT_P12_BASE64" | base64 --decode > "$cert"
security import "$cert" -P "$APPLE_CERT_PASSWORD" -A -t cert -f pkcs12 -k "$keychain"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain"
codesign --force --options runtime --timestamp --keychain "$keychain" --sign "$APPLE_SIGNING_IDENTITY_NAME" "$helper"
codesign --verify --strict "$helper"
# Submit the helper itself: notarising the outer app cannot inspect executable bytes hidden in Bun's asset blob.
ditto -c -k --keepParent "$helper" "$archive"
result="$RUNNER_TEMP/helper-notary-result.json"
if [ -n "${APPLE_API_KEY_ID:-}" ] && [ -n "${APPLE_API_ISSUER_ID:-}" ] && [ -n "${APPLE_API_KEY_P8:-}" ]; then
  printf '%s' "$APPLE_API_KEY_P8" > "$key"
  xcrun notarytool submit "$archive" --key "$key" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID" --wait --timeout 10m --output-format json > "$result"
elif [ -n "${APPLE_ID_NAME:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID_VALUE:-}" ]; then
  xcrun notarytool submit "$archive" --apple-id "$APPLE_ID_NAME" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID_VALUE" --wait --timeout 10m --output-format json > "$result"
else
  echo '::warning::Signed helper is not notarised: no existing notarisation credentials.'
  exit 0
fi
jq -e '.status == "Accepted"' "$result"
# Standalone Mach-O tickets are published online by Apple; stapler does not staple a standalone executable.
