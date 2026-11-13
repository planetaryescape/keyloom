# 26: keyloom as a desktop app

Status: built through 2026-11-11 (rung 24, D-481, D-507's problem window, restarts and log, D-514's update failures, last lines and Sync now notice, D-515's links and downloads, D-516's too-new database, Stop download and busy Sync now, D-521's Restart keyloom and drag and drop, and D-541's log file named to the server in `KEYLOOM_LOG_FILE`, so the page's **Show keyloom's log** opens it); signed and notarised in the current releases and installed on BK's Mac (v0.65.0, 2026-10-31). Source baseline: origin/main at v0.36.1. Research: [../research/desktop-shell.md](../research/desktop-shell.md); the shell is `desktop/tauri/`.

Status update, 2026-11-13: D-569 is implemented in candidate commit `fc3766a728053cedc1928d7d2ffe2398952cd416`, pending merge and release. The fetch script verifies `SHA256SUMS` before replacing the executable. [Evidence and limits](../issues/unchecked-desktop-sidecar.md) remain separate from installed signature verification.

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

- A release job on BK's Mac (the `keyloom-builder` runner, D-483) builds the `.app`, and signs and notarises it when those credentials exist (D-329). The bun sidecar needs the `allow-jit`, `allow-unsigned-executable-memory` and `disable-library-validation` entitlements, or it crashes under hardened runtime.
- Before packaging, `fetch-sidecar.sh` verifies the selected asset against `SHA256SUMS` (D-569). Local builds require the manifest beside the binary. A failure preserves the previous sidecar. See the [build instructions](../../desktop/tauri/README.md).
- One Homebrew cask in `planetaryescape/homebrew-tap` installs the app and links the bundled binary as the CLI, so there's one install and one version. `install.sh` keeps working for the CLI alone.
- **Auto-update** through Tauri's updater, with its own signing key. Detection is automatic; installation and restart are user-initiated (D-481).
- **Needs from BK:** notarisation credentials (an app-specific password or an App Store Connect API key). His Developer ID certificate is already in his keychain.

## Device-helper diagnostics packaging

Rung 24b embeds a diagnostics-only Rust executable inside the same Bun sidecar (D-426). Doctor starts and reaps it; `serve` and the desktop shell start no helper in this rung. The shell still supervises only its owned server. Native device transports remain TypeScript.

The desktop shell starts `keyloom serve` with the login shell's PATH and the allowlisted model-provider settings it finds (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `CODEX_API_KEY`, `CODEX_HOME`, `KEYLOOM_CODEX_BIN`, `KEYLOOM_CODEX_TRACE` and `KEYLOOM_PROVIDER`; D-441, D-443). The lookup is one bounded shell exchange. Existing app environment values take precedence, and the shell's provider values are not logged or stored. Add a key to the shell profile and reopen the app to use it.

The release matrix signs the visible Rust executable before embedding, without Bun's JIT entitlements, and separately submits it for notarisation when existing credentials are configured. Tauri later signs the outer Bun sidecar/app; that outer signature cannot sign hidden Rust bytes. D-424/Q41 still require installed signed/notarised-chain evidence, not just a local unsigned CLI smoke. No Linux/Windows Tauri support is claimed. The inherited macOS 12.0 bundle setting is not certified: pinned Bun documents a macOS 13+ runtime requirement. See [platform gates](33-device-helper-platforms.md) and [local evidence](../research/spikes/device-helper-24b.md).

## Decisions

D-320 to D-322 and D-323 to D-329 are in [14](14-decision-log.md), with D-481; D-454 (the client protocol and `--replace`) and D-455 (the schema guard) after them; D-507, D-514, D-515 and D-516 for the problem window, links, downloads and updates; D-521 for Restart keyloom and drag and drop.

## As built

- **One server per data directory (D-323).** `keyloom serve` writes `serve.json` (mode 0600) in the data directory and refuses to start beside a live one; `--reuse` prints the live one's URL and exits 0, which is how the app attaches to the browser server instead of starting a second sync engine. A server that predates this change writes no record, so the app starts its own until that server is restarted on a new binary.
- **The server words the menu bar (D-325).** Each `/api/events` frame carries `menuBar`: a summary, one line per board in the header's words, the config Sync now targets, the title beside the icon and the notices since the last frame on that stream.
- **The shell checks its keyloom (D-454).** It passes `--client-protocol 1` (`DESKTOP_PROTOCOL` in `sidecar.rs`, equal to `src/api/desktop-protocol.ts`; a test compares them). A live server on another protocol is not attached to: the CLI prints `keyloom cannot attach: …` and exits 10, the tray summary shows those words, and when the CLI also prints `keyloom can replace it: …` (the server is older or unknown) the menu gets an item with that label. Picking it re-runs the sidecar with `--replace`, which stops the old server after it finishes any keyboard write. A newer server is never offered for replacing. Not exercised live: the tray and the menu item were checked by `cargo test` on the parsing and by driving the compiled CLI, not in a running app.
- **Fonts are bundled (D-326)** into the web bundle, for the app and for a browser tab alike.
- **Signing.** Tauri signs the shell and the sidecar with hardened runtime and `Entitlements.plist` (the three bun entitlements, applied to both binaries). The CI job is in `release.yml`, steps and secrets in `desktop/tauri/README.md`.
- **Install.** A Homebrew cask is prepared at `packaging/homebrew/keyloom.rb` for `planetaryescape/homebrew-tap`. The updater is compiled in only with a key (D-328).
- **No dead end when the server is missing (D-507).** A server that can't start, or stops more than three times in ten minutes, opens a problem window with **Try again** and **Show log** (and the CLI's replace offer, or the app update when a newer keyloom is in the way); the menu bar adds **Try starting keyloom again**. A server the shell started is started again after it exits, after 1 s, 5 s and 15 s. The shell's log is `~/Library/Logs/dev.planetaryescape.keyloom/keyloom.log`. When the server keeps stopping, the window shows the last 12 lines it wrote, without its token (D-514). A menu-bar Sync now that the server refuses, or that gets no answer, shows a notification and brings keyloom forward (D-514). Not exercised in a running app yet: checked by `cargo test`, `cargo clippy` and rendering the page.
- **Updates (D-481).** When a signed update is available, the app notifies the user and offers a version-specific install-and-restart action in the menu bar. It downloads only after the user chooses; a successful install requests restart through the normal exit path, and a failed install checks again at once, which offers the action again. After an empty or failed check the item reads **Check for updates** and stays enabled (D-507). The download shows its progress. A failed install keeps the same version offered as **Couldn't install VERSION. Try again**, gives the reason in a notification and the problem window, and adds **Download the latest keyloom** to the menu (D-514).
- **Links and downloads (D-515).** A link to another site opens in the default browser, and the window keeps keyloom; other schemes, and keyloom's own page in a new window, are refused. Only keyloom's own page can save a download. A download is saved to Downloads under its own name, never over an existing file, and Finder shows it; a failed one sends a notification. Checked in a debug build on a scratch home and data directory (`external.rs`).
- **A database a newer keyloom upgraded (D-516).** `serve` exits 10 with `schema_too_new`; the problem window says the app is older than the data and offers the update and the download page, with no Try again. Checked by `cargo test`, not in a running app.
- **Stop download (D-516).** An update download shows **Stop download** in the problem window and the menu bar, and stops by itself after 60 s with nothing received. Either way it ends as a failed install with the reason, offered again. Checked by `cargo test` only: no signed update feed exists to download from.
- **Restart keyloom (D-521).** The page (the typing lab's `restart_required`) and the menu bar post `/api/restart`. A server the shell started answers 202, finishes any keyboard write, and exits 11, even when the helper cleanup fails; the shell starts it again at once, without counting a stop, and the window follows it. The server sets no time limit on that write. After 45 s the page looks again: a server still answering never restarted, so the button comes back; otherwise the page says to choose Open keyloom, or to quit and open keyloom again. A menu-bar restart that got no answer says it may already be restarting. A server started in a terminal refuses, and the page shows the line to run there with Copy. Checked in a debug build on scratch data: four restarts in a row, no problem window.
- **Drag and drop (D-521).** The window is built without Tauri's drag-and-drop handler, so a file dropped on the import card and a dragged layer tab reach the page. A web link dropped anywhere else opens in the browser, and a file dropped there is blocked. Checked in a debug build by driving WKWebView's native drag methods with a fake drag (a control build without the fix fired no page event).
- **Menu-bar Sync now while busy (D-516).** It says keyloom syncs when the build or flash finishes, and asks again every 3 s for up to 15 minutes, as the page does. Checked by `cargo test` only.
- **Measured on BK's Mac (Apple Silicon):** 70 MB `.app` (72,088 KB on disk), server listening 0.6 s after launch.
