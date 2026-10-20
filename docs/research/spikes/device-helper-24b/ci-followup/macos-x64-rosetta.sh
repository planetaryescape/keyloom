#!/bin/bash
set -euxo pipefail
root="$PWD"
cd native/device-helper
rustup target add x86_64-apple-darwin
cargo build --locked --release --target x86_64-apple-darwin
cd "$root"
codesign --force --sign - native/device-helper/target/x86_64-apple-darwin/release/keyloom-device
curl -fsSL https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-x64.zip -o dist/macos-x64-probe/bun.zip
unzip -o dist/macos-x64-probe/bun.zip -d dist/macos-x64-probe
bun_x64="$root/dist/macos-x64-probe/bun-darwin-x64/bun"
"$bun_x64" --revision
file "$bun_x64" native/device-helper/target/x86_64-apple-darwin/release/keyloom-device
KEYLOOM_TEST_HELPER="$root/native/device-helper/target/x86_64-apple-darwin/release/keyloom-device" "$bun_x64" test test/firmware/toolchain/device-helper-native.test.ts --test-name-pattern 'no heartbeat and blocked stdout'
