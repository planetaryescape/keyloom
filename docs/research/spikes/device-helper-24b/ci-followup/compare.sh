#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive CARGO_HOME=/probe/cargo RUSTUP_HOME=/probe/rustup PATH=/probe/cargo/bin:$PATH
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates gcc libc6-dev musl-tools file binutils strace
rustc -vV
rustc --print cfg --target x86_64-unknown-linux-musl
printf 'fn main() { println!("minimal startup reached"); }\n' > /probe/minimal.rs
for variant in default explicit-static bundled-linker; do
  case "$variant" in
    default) flags=(-C linker=musl-gcc) ;;
    explicit-static) flags=(-C linker=musl-gcc -C target-feature=+crt-static) ;;
    bundled-linker) flags=(-C linker=rust-lld -C target-feature=+crt-static) ;;
  esac
  rustc /probe/minimal.rs --target x86_64-unknown-linux-musl "${flags[@]}" -C link-arg=-v -o "/probe/minimal-$variant" 2> "/probe/link-$variant.txt"
  file "/probe/minimal-$variant"
  readelf -lW "/probe/minimal-$variant"
  set +e
  "/probe/minimal-$variant"
  status=$?
  strace -f -o "/probe/strace-$variant.txt" "/probe/minimal-$variant"
  printf '%s_status=%s\n' "$variant" "$status"
  set -e
done
cd /source/native/device-helper
export CARGO_TARGET_DIR=/probe/target CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_RUSTFLAGS='-C target-feature=+crt-static'
cargo test --locked --target x86_64-unknown-linux-musl
cargo build --locked --release --target x86_64-unknown-linux-musl
file /probe/target/x86_64-unknown-linux-musl/release/keyloom-device
readelf -lW /probe/target/x86_64-unknown-linux-musl/release/keyloom-device
/probe/target/x86_64-unknown-linux-musl/release/keyloom-device --version > /probe/helper-version.out
