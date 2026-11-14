# Dependency lockfiles retain security advisories

Status: fixed by PR 339 at `7f6466484495547208dfd33d2aa803497be62dd8` and released in v0.80.3 at `7f12cc9b5db5a3c82da6c079f8a2276c579815a2`. All sixteen npm advisory records and six desktop Cargo vulnerability records are removed.

The v0.80.2 lockfiles at `6034e1c22713f40e7ce2f3a91d1a3d30f934cd6d` report sixteen npm advisories and six desktop Cargo vulnerability records. The desktop JavaScript and native-helper Cargo audits report none. These counts describe lockfiles, not demonstrated exploits in each product path.

## Compatible patches remove the production dependency records

Root overrides select patched versions within the existing major versions:

| Package | Selected version |
|---|---|
| `@hono/node-server` | 2.1.6 |
| `body-parser` | 2.4.0 |
| `fast-uri` | 3.1.9 |
| `hono` | 4.13.16 |
| `ip-address` | 10.7.6 |
| `qs` | 6.17.1 |

These releases satisfy the existing SDK ranges. The Hono selections preserve the configured seven-day release-age limit. Newer releases failed that limit during resolution. The patch does not change that policy.

The desktop lock selects `tauri-plugin-updater` 2.14.1 within its existing manifest range. That patch uses ZIP 9. The lock also selects `rustls-webpki` 0.103.17 and `webpki-root-certs` 1.0.12. A fresh Cargo audit reports zero vulnerability records. Maintenance and soundness warnings remain separate.

The original npm records include `GHSA-qv5m-9pm6-hqp3`, `GHSA-jpvv-r467-5p4w` and `GHSA-27r3-jxmh-p828`. The desktop records are `RUSTSEC-2026-0382`, `RUSTSEC-2026-0383`, `RUSTSEC-2026-0429`, `RUSTSEC-2026-0367`, `RUSTSEC-2026-0368` and `RUSTSEC-2026-0369`. The security review ledger retains all audit IDs and raw outputs.

## The approved Happy DOM major upgrade removes the development advisories

The version 20 development dependency reported `GHSA-834v-8h66-3h79` and `GHSA-c8p4-j97h-3vg8`. BK approved the major upgrade to 21.0.4. Both the registrator and Happy DOM now resolve to 21.0.4 within the registrator's declared range.

## Recheck the candidate

```sh
agent-work run -- bun audit --json
cd desktop/tauri/src-tauri
agent-work run -- cargo-audit audit --json
```

The root audit and desktop Cargo audit now report zero vulnerability records. No affected SDK reverse-proxy, WebSocket, Express-parser or URI-authorization exploit was demonstrated in keyloom. No updater signature bypass was demonstrated. Those limits do not remove the dependency maintenance work.

Candidate checks: 66 focused tests and 255 assertions passed. TypeScript and the desktop check with the updater feature passed. Dependency analysis exited zero with the existing TypeScript 7 compatibility warning.

After the approved major upgrade, all 1,304 web tests and 7,263 assertions passed across 152 files. TypeScript passed again. Both installed test packages resolve to 21.0.4, and the root audit reports zero advisories.
