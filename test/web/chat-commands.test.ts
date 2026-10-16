// ⌘K commands (D-315): the typing lab and the config commands offered above "Ask keyloom" when the text names them.
import { describe, expect, test } from "bun:test";
import { matchCommands, type CommandContext } from "../../src/web/chat/commands.ts";

const ctx: CommandContext = {
  boardName: "Moonlander",
  currentId: "lay_sync",
  configs: [
    { id: "lay_sync", name: "synchronized", onKeyboard: true },
    { id: "lay_cmk", name: "Colemak", onKeyboard: false },
    { id: "lay_cmkdh", name: "Colemak DH", onKeyboard: false },
  ],
};
const kinds = (text: string, c: CommandContext = ctx) => matchCommands(text, c).map((m) => ("id" in m ? `${m.kind}:${m.id}` : m.kind));

describe("the typing lab", () => {
  test("opens from the words chapter 24 uses", () => {
    expect(kinds("typing lab")).toEqual(["lab"]);
    expect(kinds("test my home row mods")).toEqual(["lab"]);
    expect(kinds("how fast is each finger")).toEqual(["lab"]);
    expect(kinds("finger speed")).toEqual(["lab"]);
  });

  test("isn't offered for text about something else", () => {
    expect(kinds("make S hold for option")).toEqual([]);
    expect(kinds("x")).toEqual([]);
  });
});

describe("config commands", () => {
  test("New config", () => {
    expect(kinds("new config")).toEqual(["new-config"]);
    expect(kinds("make a new layout for steno")).toEqual(["new-config"]);
  });

  test("Switch to <config>, the longest name that's typed winning first", () => {
    expect(kinds("switch to colemak")).toEqual(["switch:lay_cmk"]);
    expect(kinds("colemak dh")).toEqual(["switch:lay_cmkdh", "switch:lay_cmk"]);
    // The config on screen isn't offered to switch to.
    expect(kinds("open synchronized")).toEqual([]);
    // A partial name still finds it when the text asks to switch.
    expect(kinds("switch to cole")).toEqual(["switch:lay_cmk", "switch:lay_cmkdh"]);
  });

  test("Put <config> on the keyboard, and not the one already on it", () => {
    const put = matchCommands("put colemak on the keyboard", ctx);
    expect(put.map((m) => m.kind)).toEqual(["put-on"]);
    expect(put[0]?.label).toBe("Put Colemak on your Moonlander");
    expect(kinds("put synchronized on the keyboard")).toEqual([]);
    // "this" is the config on screen, when it isn't the keyboard's.
    expect(kinds("put this on the keyboard", { ...ctx, currentId: "lay_cmk" })).toEqual(["put-on:lay_cmk"]);
  });
});
