// The upstream trees the keyboard index was generated from (docs/research/new-keyboard.md, "Pinned sources"). Changing a SHA here
// means regenerating src/boards/derive/keyboard-index.json with scripts/gen-keyboard-index.ts and reading the diff.
export const PINNED_SOURCES = {
  qmk: { repo: "https://github.com/qmk/qmk_firmware", sha: "7a1bbf37c5c07da4ea0a162bb139083a46ef40a1" },
  zmk: { repo: "https://github.com/zmkfirmware/zmk", sha: "4dd95d7840eb3d5a3f59bb29fbf1ab054715ef85" },
} as const;

// Build images, pinned by digest like every board's (docs/blueprint/04). The QMK CLI image is the one boards/zsa/moonlander uses; the
// ZMK one is the zmk-build-arm:4.1 image boards/foostan/corne uses. Both built a derived board in the smoke build (S43, docs/research/spikes/S43.md).
export const QMK_IMAGE = "ghcr.io/qmk/qmk_cli@sha256:b7d7fa8fb4432b569931de5ad59098cb788f440ed61a62c5126746b71aee0f4a";
export const ZMK_IMAGE = "zmkfirmware/zmk-build-arm@sha256:edb1c953438c6f720ddb79c3762f3972013b7fbbaf4fff3592fc869983e7afc5";
