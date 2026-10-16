# 26: keyloom as a desktop app

Status: proposal, 2026-10-16. Source baseline: origin/main after v0.25.0. Research: [../research/desktop-shell.md](../research/desktop-shell.md) (branch `spike/desktop-shell`, prototype `desktop/tauri/`).

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

## Decisions

D-320 to D-322 are in [14](14-decision-log.md).
