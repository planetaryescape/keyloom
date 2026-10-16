# Desktop shell: Tauri v2 around the unchanged keyloom server

Base: origin/main 3d4d410 (v0.25.0), branch `spike/desktop-shell`. Prototype: `desktop/tauri/`. Evidence (screenshots, logs, scripts): `/Users/bhekanik/code/planetaryescape/.orchestrate/keyloom-2026-10-15/evidence/desktop/`. Machine: Apple Silicon, macOS 27 (Darwin 27.0.0), Rust 1.98.0, Tauri 2.12.4, tauri-cli 2.12.1.

Every claim is marked **observed** (I ran it or read the source at the named place) or **unverified** (with what would settle it).

## Recommendation

Tauri v2 with the release `keyloom` binary as a sidecar, shipped alongside browser mode, which does not change. Reasons:

1. All five prototype requirements worked in a built `.app` on the first real pass (sidecar start and stop, tray, notification path, keyboard shortcuts, launch at login). Observed.
2. The design renders the same in WKWebView as in Chromium. Observed.
3. The shell is 5.0 MB. The 70 MB `.app` is 97% the keyloom binary BK already ships, so Tauri adds almost nothing to what he downloads today. Observed.
4. Electrobun is not ready to depend on (see below), and Electron adds about 130 MB of compressed runtime to a UI that works in WebKit.

Numbers, from the built `Keyloom.app` (release profile, `opt-level = "s"`, LTO, strip):

| Measure | Value |
| --- | --- |
| `.app` on disk | 70 MB (`du`: 71,180 KB) |
| Shell binary | 5.0 MB (4,989,456 to 5,022,656 bytes across builds) |
| keyloom sidecar | 67.8 MB (67,821,794 bytes) |
| `.app` zipped with `ditto` | 27.4 MB |
| Cold start, sidecar listening | 690 to 1,284 ms, median about 1,060 ms (8 launches) |
| Cold start, window on screen | 873 to 1,429 ms, median about 1,150 ms |
| Resident memory, shell plus sidecar | about 110 MB plus about 107 MB, before WebKit's own helper processes |

Start times were measured from `exec` of the app binary to the first sidecar listening socket and to a window titled "Keyloom" existing (`coldstart.sh`). They are warm-cache numbers: the files had been read before. I did not reboot, so a true first launch after boot is unmeasured, and so is Gatekeeper's first-launch scan of a notarised app. The sidecar start is nearly the whole cost, so a browser launch of `keyloom serve` would show the same figure plus opening a browser.

Risks, most serious first:

- **An orphaned sidecar if the shell is killed.** SIGTERM to the shell skipped Tauri's exit hook and left `keyloom serve` running (observed, pid 56800). The prototype now traps SIGTERM and SIGINT and routes them through `app.exit`; after that, four launches each ended with no sidecar left (observed). A SIGKILL or crash still orphans it. The fix belongs in the server: exit when stdin closes. Not built, since the server is out of scope here.
- **A hardened-runtime build of the bun binary crashes without entitlements.** Notarisation requires hardened runtime. I re-signed a copy of the release binary with `codesign --options runtime` (ad-hoc): it printed its URL and then died with exit 133 (SIGTRAP). With `allow-jit`, `allow-unsigned-executable-memory` and `disable-library-validation` it ran normally (observed, `/private/tmp/claude-501/hr/`). The signing step must apply those entitlements to the sidecar. Whether Tauri applies `bundle.macOS.entitlements` to the sidecar as well as the main binary is unverified; sign the sidecar explicitly before bundling if it does not.
- **Version skew between the app's sidecar and a separately installed CLI.** Both open the same SQLite data directory. Cross-process sync runs are already guarded (`src/app/sync-engine.ts:585` refuses when another process has a sync running; observed), but schema migrations are not. A Homebrew cask that exposes the bundled binary as the CLI avoids the second copy (see Distribution).
- **Per-origin web storage resets with a random port.** The page keeps its theme and dismissed tips in `localStorage` (`src/web/shell/storage.ts`), which is keyed by origin including the port. A random port per launch would reset them every time. The prototype remembers the last port in the app data directory and reuses it when free (observed: the same port, 55231, on four launches). The default port 4477 was occupied on this machine by another process, so a fixed port cannot be assumed.
- **The system WebView is the user's WebKit.** Rendering will track macOS updates, not a version keyloom tests against. Browser mode is unaffected.
- **Fonts come from Google Fonts.** `src/web/index.html` loads Instrument Sans from `fonts.googleapis.com`. Offline, the window falls back to the system font, same as a browser today. Bundling the font would make the app self-contained; that is a web change, not a shell change.
- **Tray text could not be seen on screen.** See the tray section.

## What the Tauri prototype does

`desktop/tauri/src-tauri/src/{lib,sidecar,sync}.rs`, about 485 lines of Rust, no frontend build (the window loads the server's URL).

### Sidecar start and stop

Observed: `externalBin: ["binaries/keyloom"]` bundles the binary as `Keyloom.app/Contents/MacOS/keyloom` next to the shell. The shell spawns `keyloom [--data-dir D] serve --port P --no-open` through `tauri-plugin-shell`, reads stderr until `keyloom is running at <url>` (the line printed by `src/cli/main.ts:210`), and opens a window on that URL. The token comes with the URL.

Two findings about the CLI:

- `keyloom serve --port 0` is rejected: `src/cli/main.ts` validates 1 to 65535, although `startServer` documents port 0 (`src/server/start-server.ts`). The shell therefore picks a free port itself, which leaves a small bind race. Letting the CLI accept 0 closes it and is a one-line change. Not made here.
- The URL goes to stderr, not stdout. The shell depends on that line staying as it is; a `--json` or `--print-url` flag would be a firmer contract.

Stop: on exit the shell sends SIGTERM to the sidecar and waits up to 30 seconds, then kills it. The server's own handler drains a flash in progress before exiting (`src/cli/main.ts:211-218`, observed in source), and the plugin's `kill()` would be SIGKILL. Closing the window hides it; the tray keeps the app and the sync watcher alive; Quit (tray or Cmd-Q) ends everything. Single-instance is on, so a second launch focuses the window.

Safety: I ran the app with `PATH` prefixed by the rung 2 `fakebin` and a scratch copy of `rung16/data-bk/keyloom.db`. Nothing was flashed. I did not click Sync now (see below).

### Keyboard shortcuts reach the page

Observed, with an overlay that shows each keydown the page receives and whether its handler claimed it, driven by real keystrokes through System Events:

- Cmd-K opened the chat bar (`tauri-cmdk.png`).
- Cmd-Z reached the page and was claimed by it: the app's own toast "Nothing to undo" appeared (`key-cmd-z.png`). Tauri's default Edit menu did not swallow it.
- Cmd-3 reached the page and was not claimed (`key-cmd-3.png`), which is the point: in a browser tab it would switch tabs. keyloom binds plain 1 to 9, not Cmd-1 to 9 (`src/web/Viewer.tsx:897`), and plain 3 switched to the Symbols layer (`key-digit-3.png`).

The overlay and the `KEYLOOM_DESKTOP_*` environment switches are spike aids, gated on environment variables, and should be deleted before any real build.

### Tray

`GET /api/events` is read as SSE with the `x-keyloom-token` header, reconnecting every 2 seconds. Each frame sets a disabled status line in the tray menu, the tooltip and the menu-bar title. Menu: status, Sync now, Open keyloom, Launch at login (checkbox), Quit.

Observed: the app log shows frames arriving and the status text being set (`Glove80: not a keyloom build`, the highest-ranked state on this machine with both boards plugged in). System Events lists a status item named "status menu" owned by the process.

Not observed: the tray glyph and its title on screen. I could not find it in the menu bar screenshots; the bar on this machine is crowded and the item's reported position fell in a gap. Clicking it through the accessibility API did not open the menu. Treat the visual as unverified; it needs BK to look at his menu bar.

Not run: Sync now against hardware. It posts the same `POST /api/sync {layoutId}` the web button posts, for the first board that is `behind`. It has no fake-device test, so I did not trigger it with both of BK's keyboards attached. The route is also where the tray gets its next frame from, so it is safe by construction, but unproven.

### Notifications

The transition logic is a pure function with two unit tests (`cargo test --lib`, 2 passed, observed): the first frame is silent; a run moving to `succeeded` or `failed` notifies once; a board entering `needs_hand` notifies once with the server's instruction.

Observed on the built app: macOS showed the permission prompt for "Keyloom" on first launch, so the bundle identifier registered with Notification Center. The delivery of the test notification itself was not seen, because the prompt waits for BK to press Allow, and Focus was on. Unverified until that one click.

### Launch at login

Observed: with `tauri-plugin-autostart` (`MacosLauncher::LaunchAgent`), enable returned Ok, `is_enabled` returned true, `~/Library/LaunchAgents/Keyloom.plist` existed, disable returned Ok, `is_enabled` returned false, and the plist was gone. The tray checkbox calls the same functions but I did not click it.

### Rendering in WKWebView

Observed from screenshots at the same CSS width (1592 px) in Tauri and in agent-browser's Chromium (dark: `cmp-symbols.png`, `cmp-header.png`; light: `wk-light-layer0-s.png` beside `chromium-light-s.png`):

- Instrument Sans loads, including the width axis: narrow legends such as "Boot flash", "Home" and "Custom" render condensed in both.
- Radial layer glow, key gradients, shadows and the dark and light themes render the same. WKWebView follows the window's appearance for `prefers-color-scheme`.
- `backdrop-filter` is not used anywhere under `src/web` (grep returned nothing), so there was nothing to test.
- One visible difference: the layer reds (the dot beside "Symbols", the thumb keys) look more orange and duller in the Tauri captures than in Chromium. The CSS values are plain hex (`src/web/tokens.css`), so the cause is most likely the capture path (`screencapture` in the display profile against headless Chromium's untagged output), not the engine. Unverified; a capture of Chromium run headed on the same display would settle it.
- Animations were not compared frame by frame; motion looked normal in use. Unverified.

## Electrobun

Not built. The checks that decided it, all from the repo at blackboardsh/electrobun commit c4bbeca (tarball of HEAD, 2026-10-16) and the GitHub API:

- Version: npm `electrobun` 2.0.2 is the latest stable; the 2.0.3 beta series is at beta.26, published 2026-10-15, with a new beta almost daily (releases API, observed).
- The toolchain moved recently: builds now run through a new CLI, Hutch, paired with an experimental runtime, Cottontail, and Zig 0.17 (docs `guides/changelog/unreleased.mdx`). That page says "Bun is now the default JavaScript/TypeScript main process" as a change in the beta, so 2.0.2 did not default to it. Packaged apps use Bun 1.4.0 in the beta (`package/src/shared/bun-version.ts`). keyloom's release build pins Bun 1.3.14 (`.github/workflows/release.yml`).
- Features present in the docs: tray with menus and template icons, `Utils.showNotification`, an updater with delta patches, and macOS sign, notarise and staple through `ELECTROBUN_DEVELOPER_ID` plus an App Store Connect API key or an app-specific password (`guides/code-signing.mdx`). WKWebView is the default renderer on macOS; CEF can be bundled.
- Gaps: a search of `docs/src` and `package` for login items, launch at login or SMAppService found nothing. The release matrix publishes no macOS x64 core artifact (`guides/bundling-and-distribution.mdx`), while keyloom ships a darwin-x64 binary.
- Size: no figure in the current docs. Unverified.
- Fit: a Bun main process could import keyloom's server in process instead of using a sidecar, which would be the one real advantage. It would tie the shell to server internals that today are a clean HTTP and CLI boundary, and the keyloom binary is already a bun-compiled executable, so a second embedded Bun would ship beside it.

It becomes worth a prototype when Bun-by-default is in a stable release and launch at login exists. Revisit then.

## Electron

Short note, no prototype. The macOS arm64 runtime zip for v44.8.0 is 130,602,344 bytes (GitHub release asset, observed), against a 5.0 MB Tauri shell, and it comes before the 68 MB sidecar. Running the bun binary as a child process works the same way as the sidecar (`child_process.spawn`, read the URL from stderr, SIGTERM on `before-quit`). What Electron buys is Chromium parity with the tests and with what BK's browser mode shows. keyloom already renders identically in WebKit, so that is a cost without a payoff. Unverified: installed size, start time.

## Signing and distribution

What BK has, observed on this machine: a valid `Developer ID Application: BHEKANI KHUMALO (WAVMJLFY95)` identity in the login keychain, expiring 2031-02-09, plus an Apple Development identity. What I could not find: notarisation credentials. There is no `notarytool` keychain profile under the name `notary`, and `planetaryescape/mxr`, whose `release.yml` has a complete import-sign-notarise-staple job, has no `APPLE_*` secrets set (`gh secret list`). So whether BK has an app-specific password or an App Store Connect API key is unknown. Nothing was created.

Needed for a notarised build:

1. The Developer ID Application certificate as a base64 `.p12` plus its password in the keyloom repo's Actions secrets (the mxr workflow shows the shape: `APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_KEYCHAIN_PASSWORD`, `APPLE_DEVELOPER_ID`).
2. Notarisation credentials: an App Store Connect API key (`.p8`, key id, issuer id) or an Apple ID with an app-specific password, and the team id (WAVMJLFY95). Tauri reads `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_CERTIFICATE` style variables (tauri-docs `distribute/Sign/macos.mdx`).
3. Hardened runtime with the bun entitlements above, applied to the sidecar.
4. A macOS runner. The current `build-binaries` job runs on ubuntu and cross-compiles; the `.app` must be built on `macos-15` (or `macos-latest`).

Auto-update: `tauri-plugin-updater` 2.14.0 needs its own minisign keypair (`tauri signer generate`), the public key in `tauri.conf.json`, `bundle.createUpdaterArtifacts: true`, and the private key as `TAURI_SIGNING_PRIVATE_KEY` in CI (tauri-docs `plugin/updater.mdx`, observed). The build emits a `.app.tar.gz` and `.sig`; a `latest.json` pointing at the GitHub release asset URL is the update manifest. This key is separate from the Apple one; losing it strands installed apps.

Shipping through the existing pipeline (design, not built):

- release-please keeps owning the version. Add `extra-files` for `desktop/tauri/src-tauri/tauri.conf.json` (`$.version`) and `Cargo.toml`, so the app version equals the tag. Unverified: that release-please's toml updater handles this Cargo.toml as-is.
- Add a `build-desktop` job to `release.yml`, `needs: release-please`, on `macos-15`. It downloads `keyloom-darwin-arm64` from the just-created release, runs `desktop/tauri/scripts/fetch-sidecar.sh` with it, signs and notarises, and uploads `Keyloom_<version>_aarch64.dmg`, the updater tarball, its `.sig` and `latest.json` with `gh release upload`, as the existing job does for the binaries.
- `install.sh` stays the CLI and Linux route and needs no change for a first version. A Homebrew cask in the existing `planetaryescape/homebrew-tap` (observed to exist) would carry `app "Keyloom.app"` and a `binary` stanza pointing at the bundled `Contents/MacOS/keyloom`, so one install gives both the app and the CLI at one version. Unverified: that stanza against a real cask audit.
- Intel: the Tauri shell builds for x86_64 too, but the sidecar must be the matching `keyloom-darwin-x64`, which means a second runner target. Skip until someone needs it.

## Browser mode stays

Nothing about the server changes. `keyloom serve` still opens the browser, still binds 127.0.0.1 with a token URL, and is still how a phone or a remote machine reaches the UI. The shell is a client that spawns the same binary. The tray's "Open keyloom" could offer "Open in browser" by calling `open` on the same URL; not added. A user can run the app and `keyloom serve` at once on one data directory; syncs are cross-process guarded (above), but two live servers can both show stale state to each other, so the app could print a notice when it finds port 4477 or another keyloom already serving. Not built.

The remote page gets no Tauri IPC: `capabilities/default.json` grants only `core:default` to the window, and the sidecar, tray and notifications are driven from Rust. That keeps the web app's trust model exactly what it is in a browser.

## Notes on the prototype

- Build: `cd desktop/tauri && bun install && ./scripts/fetch-sidecar.sh [path/to/keyloom] && bunx tauri build --bundles app`. The sidecar is gitignored (68 MB).
- `@tauri-apps/cli` is pinned to 2.12.1: bun's minimum release age (7 days) refused 2.12.3. The Rust crates are not covered by that rule; `tauri` 2.12.4 and the plugins were published on 2026-10-14, two days before this spike. Pin or delay them before shipping.
- The `.app` is ad-hoc signed only. It ran fine locally; Gatekeeper behaviour for a downloaded copy is unmeasured.
- Open question for BK: does a menu-bar tray earn its place, or is the sync state already visible enough in the window? The spike shows it is cheap; whether it is wanted is a product call.

## Unresolved questions

1. Does BK have notarisation credentials (app-specific password or App Store Connect API key) for team WAVMJLFY95?
2. Should `keyloom serve` accept `--port 0` and exit on stdin close? Both are small server changes that remove the port race and the orphan.
3. Does the tray glyph appear in BK's menu bar, and does the test notification show once he presses Allow?
4. Is a single app-plus-CLI install through a Homebrew cask the intended distribution, or should the app stay separate from `install.sh`?
5. Bundle Instrument Sans so the desktop window works offline?
