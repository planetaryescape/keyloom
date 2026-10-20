#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive CARGO_HOME=/probe/cargo RUSTUP_HOME=/probe/rustup
export PATH="$CARGO_HOME/bin:$PATH"
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl gcc musl-tools gdb file binutils strace
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /probe/rustup-init.sh
sh /probe/rustup-init.sh -y --profile minimal --default-toolchain 1.99.1
rustup target add x86_64-unknown-linux-musl
uname -a
musl-gcc -v
rustc -vV
printf 'fn main() { println!("minimal startup reached"); }\n' > /probe/minimal.rs
rustc /probe/minimal.rs --target x86_64-unknown-linux-musl -C linker=musl-gcc -o /probe/minimal-musl
file /probe/minimal-musl
readelf -lW /probe/minimal-musl
set +e
/probe/minimal-musl
minimal_status=$?
gdb -batch -ex run -ex 'bt' -ex 'info files' --args /probe/minimal-musl
set -e
printf 'minimal_status=%s\n' "$minimal_status"
cd /source/native/device-helper
export CARGO_TARGET_DIR=/probe/target CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc
cargo test --locked --target x86_64-unknown-linux-musl --no-run
set +e
cargo test --locked --target x86_64-unknown-linux-musl
printf 'helper_test_status=%s\n' "$?"
for bin in /probe/target/x86_64-unknown-linux-musl/debug/deps/keyloom_device-*; do
  if test -x "$bin" && ! test -d "$bin"; then
    file "$bin"
    readelf -lW "$bin"
    gdb -batch -ex run -ex 'thread apply all bt' --args "$bin"
  fi
done
set -e
cargo build --locked --release --target x86_64-unknown-linux-musl
set +e
/probe/target/x86_64-unknown-linux-musl/release/keyloom-device --version > /probe/helper-version.out
printf 'helper_version_status=%s\n' "$?"
