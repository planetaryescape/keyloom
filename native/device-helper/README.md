# Build the device helper

```sh
cd native/device-helper
cargo fmt --check
cargo check --locked
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo test --locked --release --test lifetime -- --nocapture
cargo build --locked --release
./target/release/keyloom-device --version
```

Rust 1.99.1 is pinned here. The displayed release comes from the root `package.json`; Cargo's internal `0.0.0` is not a separate release stream.

The lifetime integration test uses the real helper with a genuinely unread OS pipe, holds stdin open until observed exit, and checks open/closed stderr without increasing the 6500-ms exit budget. Fatal termination performs no diagnostic I/O, so closed stderr cannot disable the watchdog. Native CI repeats the release-profile oracle on Intel; Bun retains separate real-child/client checks.

The helper implements only private `hello`, `ping` and `shutdown` JSON-lines requests. It advertises `capabilities: []`, contains no device backend, and refuses device methods with `unsupported`. Existing TypeScript transports remain production defaults. See [the implemented contract and remaining proposal](../../docs/blueprint/32-device-helper-protocol.md).

## Test the unadopted HID candidate

```sh
cd native/device-helper
cargo clippy --locked --all-targets --features native-hid -- -D warnings
cargo test --locked --features native-hid
cargo test --locked --features synthetic-hid
cargo build --locked --features synthetic-hid
cp target/debug/keyloom-device target/debug/keyloom-device-synthetic
cd ../..
KEYLOOM_TEST_SYNTHETIC_HID="$PWD/native/device-helper/target/debug/keyloom-device-synthetic" \
  bun test test/firmware/toolchain/device-helper-hid.test.ts test/firmware/toolchain/device-helper-client-order.test.ts
```

Use `.exe` paths on Windows. `native-hid` compiles a direct macOS IORegistry/IOKit adapter; other native platforms advertise no HID capability. `synthetic-hid` compiles only the fake backend. Enabling both is a compile error. The native tests above are compilation/unit checks, not permission to run native discovery or capture. Real `--stdio` device requests require separate authorization. The release builder enables neither feature, and `hid-default.ts` is unchanged.

The [24c evidence and adoption gates](../../docs/research/spikes/device-helper-24c.md) describe leases, report admission, queues, failure semantics and the explicit `packagedHidTransport()` adapter. Regenerate the supplementary schema with `bun scripts/gen-device-helper-schema.ts`. For the opt-in ten-minute synthetic stream, add `KEYLOOM_TEST_HID_SOAK=1` and select the `ten-minute sustained` test; this is never a physical typing soak.

## Compile an installed CLI pair

From the repository root on the native target:

```sh
agent-work run -- bun scripts/build-binaries.ts --target bun-darwin-arm64
bun scripts/smoke-device-helper.ts dist/keyloom-darwin-arm64
```

Use `bun-darwin-x64` on Intel macOS. On Linux add `x86_64-unknown-linux-musl` to this pinned Rust toolchain and use `bun-linux-x64`. The crate pins `rust-lld` and uses Rust's self-contained musl CRT; do not override it with Ubuntu 22.04's `musl-gcc`, whose specs rewrite `-static-pie` into a dynamically loaded executable. Linux embeds a static musl helper inside the existing GNU Bun executable; it adds no runtime glibc/libudev dependency. Native CI checks the ELF has no interpreter.

For a signed/prebuilt helper, pass `--helper <absolute-file>` with exactly one `--target`. Sign before invoking the builder: it hashes and embeds the final bytes unchanged. Cross-compiling all Bun targets requires `--helper-dir <directory>` containing `<rust-triple>/keyloom-device` for each target. `--entry <file>` changes the Bun entry; `--out-dir <directory>` isolates build output. Each invocation writes checksums for its outputs only; release CI combines all three native jobs before publishing `SHA256SUMS`.

## Verify without devices

```sh
keyloom --data-dir /tmp/keyloom-doctor-scratch doctor --device-helper-only
```

A compiled pair reports its release, protocol, target, helper SHA-256 and empty capabilities. Source invocation reports `not_bundled` as a warning and never looks up a helper. The installed smoke uses the real installer against a local release mirror, tests eight concurrent cold starts, corruption refusal, and import after failure. It removes only the scratch directory it creates.

The Unix extractor rejects symlinks in managed paths, unexpected owners, unsafe modes and wrong hashes. It publishes without replacing an existing executable. Old releases coexist until explicitly removed; no automatic cleanup or downloads occur. A same-user malicious process is outside this integrity boundary. Windows currently runs native Cargo/Bun child-contract checks only: production extraction refuses Windows until private ACL/reparse checks are implemented.

## Dependency and licence inventory

```sh
cd native/device-helper
cargo tree --locked --edges normal,build
cargo metadata --locked --format-version 1
```

Direct normal/build dependency: `serde_json =1.0.154`, default `std` feature. The compiled tree contains `itoa 1.0.18` (MIT OR Apache-2.0), `memchr 2.8.3` (Unlicense OR MIT), `serde_core 1.0.229` (MIT OR Apache-2.0), `serde_json 1.0.154` (MIT OR Apache-2.0), and `zmij 1.0.23` (MIT). MIT notices are [included](THIRD-PARTY-NOTICES.txt) and embedded in the helper's `--version` output.

The lock also contains optional, uncompiled `serde/serde_derive 1.0.229`, `proc-macro2 1.0.107`, `quote 1.0.47`, `syn 3.0.9` (all MIT OR Apache-2.0) and `unicode-ident 1.0.27` ((MIT OR Apache-2.0) AND Unicode-3.0). Feature-only dependencies are `base64 =0.22.1` for both HID feature builds and, on macOS only, `core-foundation =0.10.1` with `core-foundation-sys 0.8.7` and `libc 0.2.191`. Each declares MIT OR Apache-2.0; the MIT texts/copyrights are included in the notices. The default diagnostics build compiles none of these optional dependencies. HIDAPI was inspected but not adopted; no serial crate is selected. The direct macOS candidate is not a production default.

See [S58/S62 evidence](../../docs/research/spikes/device-helper-24b.md) for observed results and unverified release/signing/platform gates.
