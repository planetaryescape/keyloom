// A keyboard with no crafted display data, on the real editor stage over an in-memory backend.
// bun test/web/unmodelled-board-server.ts [port=4518] [split|compact]
// No database, credentials, Docker, USB reads or keyboard writes.
import { getBoard } from "../../src/boards/registry.ts";
import { startServer } from "../../src/server/start-server.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { devSample } from "../helpers/dev-sample.ts";

const sample = await devSample();
const corne = getBoard("foostan/corne");
const compact = process.argv[3] === "compact";
const { display: _display, ...definition } = corne.definition;
const keys = compact
  ? corne.geometry.keys.map((_, i) => ({ x: i % 14, y: Math.floor(i / 14), w: 1, h: 1, r: 0, rx: 0, ry: 0 }))
  : corne.geometry.keys;
const hands = compact
  ? { left: keys.flatMap((_, i) => i % 14 < 7 ? [i] : []), right: keys.flatMap((_, i) => i % 14 >= 7 ? [i] : []) }
  : definition.hands;
const board = { ...definition, name: compact ? "New compact" : "New split", hands, fingers: {} };
const letters = ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "A", "S", "D", "F"] as const;
const document = { ...sample.document, boardId: board.id, layers: [{ id: "base", name: "Base", bindings: keys.map((_, i) => ({ kind: "key" as const, code: letters[i % letters.length]! })) }], macros: [], tapDances: [], combos: [], conditionalLayers: [], holdTapProfiles: [], settings: [], passthrough: [] };
const fake = new FakeEditor({ ...sample, board, geometry: { ...corne.geometry, keys }, document }, { needsBoardRevision: false });
const server = startServer({ port: Number(process.argv[2] ?? 4518), source: fake.source(), editor: fake, token: "dev-editor-token" });
console.log(server.url);
