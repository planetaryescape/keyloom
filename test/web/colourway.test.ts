// The colour pins (D-395, D-319): case and keycaps each pinned or following the theme, only a part out of its room is redrawn, and the
// boards list the cases and caps their makers sell.
import { describe, expect, test } from "bun:test";
import { colourwayAttributes, fromLegacy, tonesOf } from "../../src/web/keyboard/colourway.ts";
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

  test("a part that follows the theme takes the room's tone, so either part can be pinned alone", () => {
    expect(colourwayAttributes({ case: "light", caps: null }, "dark")).toEqual({ "data-case-room": "light" });
    expect(colourwayAttributes({ case: null, caps: "dark" }, "light")).toEqual({ "data-caps-room": "dark" });
    expect(colourwayAttributes({ case: null, caps: null }, "dark")).toEqual({});
  });
});

describe("the boards' colours", () => {
  test("the Moonlander's cases are ZSA's Dark Matter and Moonlit, with black or white caps; the Glove80's cases MoErgo's grey and white, with its white or black caps", async () => {
    const ml = (await moonlander()).definition.display?.colourways;
    expect(ml?.cases.map((c) => [c.id, c.maker, c.tone, c.stockCaps])).toEqual([["black", "Dark Matter", "dark", "black"], ["white", "Moonlit", "light", "white"]]);
    expect(ml?.caps.map((c) => [c.id, c.tone])).toEqual([["black", "dark"], ["white", "light"]]);
    const g = (await glove80()).definition.display?.colourways;
    expect(g?.cases.map((c) => [c.id, c.tone, c.stockCaps])).toEqual([["grey", "grey", "white"], ["white", "light", "white"]]);
    expect(g?.caps.map((c) => [c.id, c.maker, c.tone])).toEqual([["white", "Translucent White", "light"], ["black", "Opaque Black", "dark"]]);
  });

  test("D-395's single choice becomes the two: its case, and the caps of that name or the case's own", async () => {
    const ml = (await moonlander()).definition.display?.colourways;
    const g = (await glove80()).definition.display?.colourways;
    if (ml === undefined || g === undefined) throw new Error("no colourways");
    expect(fromLegacy("black", ml)).toEqual({ case: "black", caps: "black" });
    expect(fromLegacy("white", ml)).toEqual({ case: "white", caps: "white" });
    expect(fromLegacy("grey", g)).toEqual({ case: "grey", caps: "white" });
    expect(fromLegacy("", g)).toEqual({ case: null, caps: null });
    expect(fromLegacy(null, g)).toEqual({ case: null, caps: null });
    expect(tonesOf({ case: "white", caps: "black" }, g)).toEqual({ case: "light", caps: "dark" });
    expect(tonesOf({ case: "gone", caps: null }, g)).toEqual({ case: null, caps: null });
  });
});
