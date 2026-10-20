#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive CARGO_HOME=/probe/cargo RUSTUP_HOME=/probe/rustup PATH=/probe/cargo/bin:/probe/bun:$PATH
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl gcc libc6-dev file binutils unzip
cd /source/native/device-helper
export CARGO_TARGET_DIR=/probe/target
# No CARGO_TARGET_*_LINKER override: exercise the checked-in target configuration.
cargo fmt --check
cargo check --locked --target x86_64-unknown-linux-musl
cargo clippy --locked --all-targets --target x86_64-unknown-linux-musl -- -D warnings
cargo test --locked --target x86_64-unknown-linux-musl
cargo build --locked --release --target x86_64-unknown-linux-musl
helper=/probe/target/x86_64-unknown-linux-musl/release/keyloom-device
file "$helper"
readelf -lW "$helper"
if readelf -lW "$helper" | grep -q INTERP; then exit 91; fi
"$helper" --version > /probe/helper-version.out
printf 'helper_version_exit=%s\n' "$?"
mkdir -p /probe/bun
if ! test -x /probe/bun/bun; then
  curl -fsSL https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip -o /probe/bun.zip
  unzip -o /probe/bun.zip -d /probe/bun-extract
  cp /probe/bun-extract/bun-linux-x64/bun /probe/bun/bun
fi
bun --revision
cd /source
KEYLOOM_TEST_HELPER="$helper" bun test test/firmware/toolchain/device-helper.test.ts test/firmware/toolchain/device-helper-native.test.ts
bun scripts/build-binaries.ts --target bun-linux-x64 --helper "$helper" --out-dir /probe/release
bun scripts/smoke-device-helper.ts /probe/release/keyloom-linux-x64
