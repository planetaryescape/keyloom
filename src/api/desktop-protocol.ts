// What the desktop app's shell depends on from `keyloom serve` (D-454), as one integer. The shell compiles in the same number
// (desktop/tauri/src-tauri/src/sidecar.rs, DESKTOP_PROTOCOL) and passes it as `serve --client-protocol`; a test fails if the two differ.
//
// Bump it, here and in sidecar.rs, when you change any of:
//   - the serve flags the shell passes: --port, --no-open, --exit-on-stdin-close, --reuse, --replace, --client-protocol
//   - the stderr marker lines it reads: "keyloom is running at ", "keyloom is already running at ", "keyloom cannot attach: ", "keyloom can replace it: "
//   - the `menuBar` object in /api/events frames (MenuBarSchema in ./http.ts; test/api/desktop-protocol.test.ts pins its shape)
//   - POST /api/sync { layoutId } or the x-keyloom-token header
// Adding something the shell ignores does not need a bump.
export const DESKTOP_PROTOCOL = 1;
