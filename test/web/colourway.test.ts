// The colourway pin (D-395): only a part out of its room is redrawn, and the boards list what their makers sell.
import { describe, expect, test } from "bun:test";
import { colourwayAttributes } from "../../src/web/keyboard/colourway.ts";
import { loadBoardDir } from "../../src/boards/load.ts";
import { moonlander } from "../helpers/board.ts";

const glove80 = () => loadBoardDir(`${import.meta.dir}/../../boards/moergo/glove80`);

describe("colourwayAttributes", () => {
  test("following the theme marks nothing; a pin marks only the parts whose tone differs from the room's", () => {
    expect(colourwayAttributes(null, "dark")).toEqual({});
    expect(colourwayAttributes({ case: "dark", caps: "dark" }, "dark")).toEqual({});
    expect(colourwayAttributes({ case: "light", caps: "light" }, "dark")).toEqual({ "data-case-room": "light", "data-caps-room": "light" });
    expect(colourwayAttributes({ case: "dark", caps: "dark" }, "light")).toEqual({ "data-case-room": "dark", "data-caps-room": "dark" });
    // A grey Glove80: a charcoal case, out of both rooms, with white caps.
    expect(colourwayAttributes({ case: "grey", caps: "light" }, "dark")).toEqual({ "data-case-room": "grey", "data-caps-room": "light", "data-room": "dark" });
    expect(colourwayAttributes({ case: "grey", caps: "light" }, "light")).toEqual({ "data-case-room": "grey", "data-room": "light" });
  });
});

describe("the boards' colourways", () => {
  test("the Moonlander comes in ZSA's Dark Matter and Moonlit, the Glove80 in MoErgo's grey (white caps) and white", async () => {
    expect((await moonlander()).definition.display?.colourways?.map((c) => [c.name, c.maker, c.case, c.caps])).toEqual([["Black", "Dark Matter", "dark", "dark"], ["White", "Moonlit", "light", "light"]]);
    expect((await glove80()).definition.display?.colourways?.map((c) => [c.name, c.case, c.caps])).toEqual([["Grey", "grey", "light"], ["White", "light", "light"]]);
  });
});
