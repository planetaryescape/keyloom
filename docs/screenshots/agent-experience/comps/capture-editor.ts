// Design-only capture host: real shipped board geometry, synthetic in-memory layout.
// No device, credentials, model provider, persistence or sync adapter is attached.
import { loadFixture } from '../../../../test/server/fixture.ts';
import { loadBoardDir } from '../../../../src/boards/load.ts';
import { FakeEditor } from '../../../../test/helpers/fake-editor-backend.ts';
import { startServer } from '../../../../src/server/start-server.ts';
const fixture = await loadFixture();
const board = await loadBoardDir('boards/zsa/moonlander');
fixture.board = board.definition;
fixture.geometry = board.geometry;
const fake = new FakeEditor(fixture);
console.log(startServer({port:4499,source:fake.source(),editor:fake,token:'synthetic-comp-only'}).url);
