import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BoardNotFoundError } from "../../src/boards/load.ts";
import { coverage, loadBoardDev, positionFacts } from "../../src/boards/dev.ts";
import { BoardDevViewSchema } from "../../src/boards/dev.ts";
import { startServer, type RunningServer } from "../../src/server/start-server.ts";
import { MOONLANDER_DIR } from "../helpers/board.ts";
import { tempDir } from "../helpers/tmp.ts";

/** A folder with the Moonlander's geometry and whatever board.json text is given (none: no file). */
async function folderWith(boardJson: string | undefined): Promise<string> {
  const dir = join(tempDir(), "acme", "new");
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "geometry.json"), await Bun.file(join(MOONLANDER_DIR, "geometry.json")).text());
  if (boardJson !== undefined) await Bun.write(join(dir, "board.json"), boardJson);
  return dir;
}

describe("loadBoardDev", () => {
  test("a finished board reads back whole, and every position's facts are found", async () => {
    const view = await loadBoardDev(MOONLANDER_DIR);
    expect(view.problems).toEqual([]);
    expect(coverage(view)).toMatchObject({ keys: 72, hands: 72, fingers: 72, rows: 72, mirror: 36 });
    expect(positionFacts(view, 0)).toEqual({ hand: "left", finger: "left-pinky", row: "number", mirror: 13 });
    expect(positionFacts(view, 13)).toMatchObject({ hand: "right", mirror: null });
  });

  test("a folder with only geometry shows the keys with nothing assigned", async () => {
    const view = await loadBoardDev(await folderWith(undefined));
    expect(view.problems).toEqual(["there is no board.json yet"]);
    expect(coverage(view)).toMatchObject({ keys: 72, hands: 0, fingers: 0, rows: 0, mirror: 0 });
    expect(positionFacts(view, 5)).toEqual({ hand: null, finger: null, row: null, mirror: null });
  });

  test("a half-written board.json keeps what parses and names what doesn't", async () => {
    const view = await loadBoardDev(await folderWith(JSON.stringify({ name: "Mine", hands: { left: [0, 1], right: "nope" }, fingers: { "0": "left-pinky" } })));
    expect(view.name).toBe("Mine");
    expect(view.fingers).toEqual({ "0": "left-pinky" });
    expect(view.hands).toEqual({ left: [], right: [] });
    expect(view.problems.join(" ")).toContain("hands in board.json is invalid");
  });

  test("board.json that isn't JSON is a problem, not a crash", async () => {
    const view = await loadBoardDev(await folderWith("{ nope"));
    expect(view.problems[0]).toContain("board.json is not valid JSON");
  });

  test("a folder without geometry.json says to generate it", async () => {
    const dir = tempDir();
    await expect(loadBoardDev(dir)).rejects.toThrow(BoardNotFoundError);
    await expect(loadBoardDev(dir)).rejects.toThrow(/keyloom boards geometry/);
  });
});

describe("GET /api/board-dev", () => {
  let running: RunningServer | undefined;
  afterEach(() => running?.stop());
  const none = { list: async () => [], get: async () => null };

  test("answers with the board read afresh each time, behind the token, and the link opens the board mode", async () => {
    const dir = await folderWith(JSON.stringify({ name: "First" }));
    running = startServer({ port: 0, source: none, boardDev: () => loadBoardDev(dir), token: "tok" });
    expect(running.url).toContain("mode=board-dev");
    const port = new URL(running.url).port;
    const get = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/api/board-dev`, { headers });

    expect((await get({})).status).toBe(401);
    expect(BoardDevViewSchema.parse(await (await get({ "x-keyloom-token": "tok" })).json()).name).toBe("First");
    await Bun.write(join(dir, "board.json"), JSON.stringify({ name: "Second" }));
    expect(BoardDevViewSchema.parse(await (await get({ "x-keyloom-token": "tok" })).json()).name).toBe("Second");
  });

  test("a server without --board-dev has no such route", async () => {
    running = startServer({ port: 0, source: none, token: "tok" });
    const res = await fetch(`http://127.0.0.1:${new URL(running.url).port}/api/board-dev`, { headers: { "x-keyloom-token": "tok" } });
    expect(res.status).toBe(404);
    expect(running.url).not.toContain("mode=");
  });
});
