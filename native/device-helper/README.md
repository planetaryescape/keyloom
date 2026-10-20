# Build the diagnostics helper

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

The lock also contains optional, uncompiled `serde/serde_derive 1.0.229`, `proc-macro2 1.0.107`, `quote 1.0.47`, `syn 3.0.9` (all MIT OR Apache-2.0) and `unicode-ident 1.0.27` ((MIT OR Apache-2.0) AND Unicode-3.0). No HID/serial crate or backend has been adopted.

See [S58/S62 evidence](../../docs/research/spikes/device-helper-24b.md) for observed results and unverified release/signing/platform gates.
