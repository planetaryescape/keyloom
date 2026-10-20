#!/bin/bash
set -euxo pipefail
export PATH=/probe/bun:$PATH DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends file binutils curl ca-certificates
helper=/probe/target/x86_64-unknown-linux-musl/release/keyloom-device
file "$helper"
if readelf -lW "$helper" | grep -q INTERP; then exit 91; fi
"$helper" --version > /probe/helper-version.out
bun --revision
cd /source
KEYLOOM_TEST_HELPER="$helper" bun test test/firmware/toolchain/device-helper-native.test.ts
bun scripts/build-binaries.ts --target bun-linux-x64 --helper "$helper" --out-dir /probe/release
bun scripts/smoke-device-helper.ts /probe/release/keyloom-linux-x64
