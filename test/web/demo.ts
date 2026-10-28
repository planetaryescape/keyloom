// Starts the viewer with a fake layout source on the dev sample (live Moonlander board), for a manual check:
//   bun test/web/demo.ts
// Then open the printed URL. Ctrl-C stops it.
import { startServer } from "../../src/server/start-server.ts";
import type { LayoutSource } from "../../src/server/layout-source.ts";
import { devSample } from "../helpers/dev-sample.ts";

const fixture = await devSample();
const source: LayoutSource = {
  list: async () => [
    { id: "moonlander-daily", name: "Daily driver", boardId: fixture.board.id, createdAt: Date.now(), updatedAt: Date.now(), revisionId: "rev_demo" },
  ],
  get: async (ref) => (ref === "moonlander-daily" ? fixture : null),
};

const server = startServer({ port: 4478, source });
console.log(server.url);
