# Published keyboard collection checks

These screenshots come from the checksum-verified v0.71.0 arm64 CLI serving its compiled web app, not from the development fixture. Chrome ran at 1440×900 and 390×844 with reduced motion. The only config was a new blank MacBook config in scratch SQLite data.

The server ran under a macOS sandbox that denied personal app data, credentials, device-helper execution, HID/USB opens and serial-device access. No model credential was supplied, no key change was applied, and no firmware build or flash was requested.

- [First config opens its editor](first-config-editor.png).
- [Restore retains one config and keeps sync paused](restore-confirmed.png).
- [The restored config reopens at a narrow viewport](restored-editor-mobile.png).

The same journey downloaded a ZIP containing exactly `boards/apple/macbook-ansi/board.json`, `boards/apple/macbook-ansi/geometry.json` and `CONTRIBUTION.md`.

Controller/home-row arrow navigation was verified separately through the source fixture's synthetic USB flow, in both themes. These released-binary screenshots do not establish native WKWebView interactions, physical USB/controller behavior, firmware compilation or flashing.
