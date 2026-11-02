// Real collection/config routes and SQLite, synthetic boards and USB, no models/builds/flashes.
// bun test/web/keyboard-collection-server.ts [port=0] [count=40] [usb|manual]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openApp, newConfig, archiveConfig, detectKeyboards } from "../../src/app/index.ts";
import { listBoards, setUserBoards } from "../../src/boards/registry.ts";
import { SyncEngine } from "../../src/app/sync-engine.ts";
import { appLayoutSource } from "../../src/cli/serve.ts";
import { appKeyboardsBackend } from "../../src/cli/keyboards-backend.ts";
import { appConfigsBackend } from "../../src/cli/configs-backend.ts";
import { appSyncBackend } from "../../src/cli/sync-backend.ts";
import { startServer } from "../../src/server/start-server.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { devSample } from "../helpers/dev-sample.ts";
import { CORNE_LAYOUT_FIXTURE } from "../helpers/derive-sources.ts";

const app = openApp({ dataDir: mkdtempSync(join(tmpdir(), "keyloom-collection-browser-")) });
const sample = await devSample();
const count = Number(process.argv[3] ?? 40);
if (!Number.isInteger(count) || count < 0 || count > 1000) throw new Error("count must be an integer from 0 to 1000");
if (process.argv[4] !== undefined && !["usb", "manual"].includes(process.argv[4])) throw new Error("mode must be usb or manual");
const boards = Array.from({ length: count }, (_, i) => ({ ...sample.board, id: `local/synthetic-${String(i + 1).padStart(2, "0")}`, name: `Keyboard ${String(i + 1).padStart(2, "0")}` }));
setUserBoards(boards.map((definition) => ({ definition, geometry: sample.geometry })));
for (const board of boards) newConfig(app, { name: `${board.name} daily`, from: "blank", board: board.id, start: { layout: { ...sample.document, boardId: board.id }, summary: "Synthetic collection fixture" } });
if (count > 0) {
  const old = newConfig(app, { name: "Archived synthetic Corne", from: "blank", board: "foostan/corne", selectFirst: false });
  archiveConfig(app, old.id);
}
const supported = listBoards().filter((b) => b.definition.id !== "foostan/corne");
const firmware = { cacheDir: join(app.dataDir, "source-cache"), boards: supported, fetchText: async (url: string) => {
  if (url.endsWith("/app/dts/layouts/foostan/corne/6column.dtsi")) return Bun.file(CORNE_LAYOUT_FIXTURE).text();
  throw new Error(`GET ${url} returned 404`);
} };
const engine = new SyncEngine(app, {
  readKeyboards: async () => new Map(),
  build: async () => { throw new Error("No builds in this fixture"); },
  flash: async () => { throw new Error("No flashes in this fixture"); },
  detectedKeyboards: async () => process.argv[4] === "usb" ? detectKeyboards({ boards: supported, usb: async () => [{ vendorId: "0x1d50", productId: "0x615e", name: "Corne", maker: "Synthetic USB" }] }) : [],
});
await engine.snapshot();
const fake = new FakeEditor(sample);
fake.boards = async () => listBoards().map(({ definition: d, geometry }) => ({ id: d.id, name: d.name, vendor: d.vendor, firmware: d.firmware, keyCount: d.keyCount, importers: d.importers, keys: geometry.keys, display: d.display, hands: d.hands, fingers: d.fingers, rows: d.rows }));
const server = startServer({ port: Number(process.argv[2] ?? 0), token: "collection-browser-token", source: appLayoutSource(app), editor: fake,
  configs: appConfigsBackend(app, engine, firmware), keyboards: appKeyboardsBackend(app, engine, firmware), sync: appSyncBackend(engine) });
console.log(server.url);
