// Starts the viewer with a fake layout source on the Moonlander sample, for a manual check:
//   bun test/web/demo.ts
// Then open the printed URL. Ctrl-C stops it.
import { startServer } from "../../src/server/start-server.ts";
import type { LayoutSource } from "../../src/server/layout-source.ts";
import { loadFixture } from "../server/fixture.ts";

const fixture = await loadFixture();
const source: LayoutSource = {
  list: async () => [
    { id: "moonlander-daily", name: "Daily driver", boardId: fixture.board.id, updatedAt: Date.now() },
  ],
  get: async (ref) => (ref === "moonlander-daily" ? fixture : null),
};

const server = startServer({ port: 4478, source });
console.log(server.url);
