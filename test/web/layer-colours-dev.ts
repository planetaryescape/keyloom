// Real editor with current board metadata and in-memory synthetic data only.
// bun test/web/layer-colours-dev.ts [zsa/moonlander|moergo/glove80|apple/macbook-ansi] [4508]
// No chat provider, sync engine, database, device or real build/flash adapter is attached.
import { showBoard } from "../../src/app/boards.ts";
import { blankDocument } from "../../src/app/configs.ts";
import { boardCapabilities } from "../../src/boards/capabilities.ts";
import type { ApplyRequest, CheckRequest } from "../../src/api/http.ts";
import { EditorError } from "../../src/server/editor-backend.ts";
import { startServer } from "../../src/server/start-server.ts";
import { evaluate } from "../../src/validation/validate.ts";
import { FakeEditor } from "../helpers/fake-editor-backend.ts";
import { loadFixture } from "../server/fixture.ts";

const board = showBoard(process.argv[2] ?? "zsa/moonlander");
const document = blankDocument(board.definition.id);
const base = document.layers[0];
if (base === undefined) throw new Error("blank config has no layer");
base.shortLabel = "KEEP";
base.color = 4;
if (boardCapabilities(board.definition).lighting.supported) base.lighting = { layer: [85, 255, 255], keys: { "0": [10, 255, 255] } };
const fixture = { ...await loadFixture(), board: board.definition, geometry: board.geometry, document };
// The older generic fake applies only bindings. This fixture uses the real validator and
// the fake's shared-op proposal path for display/lighting changes, still entirely in memory.
class ColourEditor extends FakeEditor {
  override async check(_ref: string, request: CheckRequest) {
    const current = this.detail();
    return evaluate(current.board, current.document, request.ops).result;
  }
  override async apply(ref: string, request: ApplyRequest) {
    if (request.baseRevisionId !== this.detail().revision.id) throw new EditorError(409, "stale_base", "Synthetic layout changed.");
    const validation = await this.check(ref, request);
    if (!validation.ok) throw new EditorError(409, "invalid_ops", "Synthetic change failed validation.", validation);
    return this.applyChangeSet(this.storeProposal(request.ops, request.summary, "synthetic-colour-edit").id);
  }
}
const fake = new ColourEditor(fixture);
const server = startServer({ port: Number(process.argv[3] ?? 4508), source: fake.source(), editor: fake, token: "dev-editor-token" });
console.log(`Synthetic ${board.definition.name}: ${server.url}`);
