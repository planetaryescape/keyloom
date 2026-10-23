# 26: keyloom as a desktop app

Status: built, 2026-10-17 (rung 24, PR from `rung24/desktop-app`); signed and installed on BK's Mac, not yet notarised (needs BK's credentials). Source baseline: origin/main at v0.36.1. Research: [../research/desktop-shell.md](../research/desktop-shell.md); the shell is `desktop/tauri/`.

BK: "since the config UI is just a web app, but the cli does all the work, Don't you think it's a good idea for us to just make this an electron app? Or Tauri? instead of relying on the browser where our keyboard shortcuts can clash with other things and extensions could do some unexpected behaviour."

## What it is to the person

keyloom becomes an app in the Dock, with its own window and keyboard, and a quiet presence in the menu bar that says whether each keyboard has the latest change. Nothing about how keyloom works changes; it just stops living in a browser tab.

## Shape

- **Tauri v2 shell around the unchanged server** (D-320). The release `keyloom` binary runs as a sidecar. The shell starts `keyloom serve` on a free port, reusing the last port so the page's local settings persist, and loads it in a native WKWebView window.
- **The server exits when its stdin closes,** so it can't be orphaned by a crash of the shell (D-321).
- **Menu-bar extra.** It shows the sync line from `/api/events` ("2 changes not on your Moonlander"), with Sync now and Open keyloom.
- **Native notifications** when a sync finishes or needs a hand.
- **Launch at login,** off by default.
- **Shortcuts belong to keyloom:** ⌘K, ⌘Z and the single-key view controls never clash with a browser or its extensions.
- **Browser mode stays.** `keyloom serve` still works from any browser, for a phone or another machine (D-322).
- **Bundled fonts,** so the window works offline.

## Measured in the spike

- **Size:** a 70 MB `.app`, of which the shell is 5 MB and the sidecar 68 MB; 27 MB zipped.
- **Cold start:** about 1.1 s (warm cache).
- **Rendering:** WebKit renders the concept the same as Chromium, in both themes.

## Shipping

- A `macos-15` release job builds, signs and notarises the `.app`. The bun sidecar needs the `allow-jit`, `allow-unsigned-executable-memory` and `disable-library-validation` entitlements, or it crashes under hardened runtime.
- One Homebrew cask in `planetaryescape/homebrew-tap` installs the app and links the bundled binary as the CLI, so there's one install and one version. `install.sh` keeps working for the CLI alone.
- **Auto-update** through Tauri's updater, with its own signing key.
- **Needs from BK:** notarisation credentials (an app-specific password or an App Store Connect API key). His Developer ID certificate is already in his keychain.

## Device-helper diagnostics packaging

Rung 24b embeds a diagnostics-only Rust executable inside the same Bun sidecar (D-426). Doctor starts and reaps it; `serve` and the desktop shell start no helper in this rung. The shell still supervises only its owned server. Native device transports remain TypeScript.

The desktop shell starts `keyloom serve` with the login shell's PATH and the allowlisted model-provider settings it finds (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `CODEX_API_KEY`, `CODEX_HOME`, `KEYLOOM_CODEX_BIN`, `KEYLOOM_CODEX_TRACE` and `KEYLOOM_PROVIDER`; D-441, D-443). The lookup is one bounded shell exchange. Existing app environment values take precedence, and the shell's provider values are not logged or stored. Add a key to the shell profile and reopen the app to use it.

The release matrix signs the visible Rust executable before embedding, without Bun's JIT entitlements, and separately submits it for notarisation when existing credentials are configured. Tauri later signs the outer Bun sidecar/app; that outer signature cannot sign hidden Rust bytes. D-424/Q41 still require installed signed/notarised-chain evidence, not just a local unsigned CLI smoke. No Linux/Windows Tauri support is claimed. The inherited macOS 12.0 bundle setting is not certified: pinned Bun documents a macOS 13+ runtime requirement. See [platform gates](33-device-helper-platforms.md) and [local evidence](../research/spikes/device-helper-24b.md).

## Decisions

D-320 to D-322 and D-323 to D-329 are in [14](14-decision-log.md).

## As built

- **One server per data directory (D-323).** `keyloom serve` writes `serve.json` (mode 0600) in the data directory and refuses to start beside a live one; `--reuse` prints the live one's URL and exits 0, which is how the app attaches to the browser server instead of starting a second sync engine. A server that predates this change writes no record, so the app starts its own until that server is restarted on a new binary.
- **The server words the menu bar (D-325).** Each `/api/events` frame carries `menuBar`: a summary, one line per board in the header's words, the config Sync now targets, the title beside the icon and the notices since the last frame on that stream.
- **Fonts are bundled (D-326)** into the web bundle, for the app and for a browser tab alike.
- **Signing.** Tauri signs the shell and the sidecar with hardened runtime and `Entitlements.plist` (the three bun entitlements, applied to both binaries). The CI job is in `release.yml`, steps and secrets in `desktop/tauri/README.md`.
- **Install.** A Homebrew cask is prepared at `packaging/homebrew/keyloom.rb` for `planetaryescape/homebrew-tap`. The updater is compiled in only with a key (D-328).
- **Measured on BK's Mac (Apple Silicon):** 70 MB `.app` (72,088 KB on disk), server listening 0.6 s after launch.
