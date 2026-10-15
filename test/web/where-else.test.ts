import { describe, expect, test } from "bun:test";
import { whereElse, whereElseSentence } from "../../src/web/panel/where-else.ts";
import { loadFixture } from "../server/fixture.ts";

const { document: layout } = await loadFixture();
const base = layout.layers[0]?.id as string;
const other = layout.layers[1]?.id as string;
const at = (layerId: string, position: number) => ({ layerId, position });
const put = (layerId: string, position: number, binding: never) => ({
  ...layout,
  layers: layout.layers.map((layer) => (layer.id === layerId ? { ...layer, bindings: layer.bindings.map((b, i) => (i === position ? binding : b)) } : layer)),
});

describe("where else a key's function lives", () => {
  test("a function on one key only says so", () => {
    const only = put(base, 3, { kind: "key", code: "F23" } as never);
    const [entry] = whereElse(only, at(base, 3), { kind: "key", code: "F23" });
    expect(entry?.others).toEqual([]);
    expect(whereElseSentence(entry as never, only)).toMatch(/only on this key/);
  });

  test("the same key on another layer is named by layer and one-based key number", () => {
    const two = put(other, 5, { kind: "key", code: "F23" } as never);
    const withBoth = put(base, 3, { kind: "key", code: "F23" } as never);
    const merged = { ...withBoth, layers: withBoth.layers.map((l) => (l.id === other ? two.layers.find((x) => x.id === other)! : l)) };
    const [entry] = whereElse(merged, at(base, 3), { kind: "key", code: "F23" });
    expect(entry?.others).toEqual([at(other, 5)]);
    expect(whereElseSentence(entry as never, merged)).toContain("key 6");
  });

  test("a hold-tap reports both of its halves, and a tap alone is found inside another hold-tap", () => {
    const profile = layout.holdTapProfiles[0]?.id as string;
    const entries = whereElse(layout, at(base, 0), { kind: "holdTap", tap: { code: "A" }, hold: { mods: ["LCTL"] }, profileId: profile });
    expect(entries.map((e) => e.function)).toEqual(["key:A", "mod:LCTL"]);
  });

  test("transparent and none have no function to lose", () => {
    expect(whereElse(layout, at(base, 0), { kind: "transparent" })).toEqual([]);
  });

  test("a long list is cut to three and counted", () => {
    const many = { ...layout, layers: layout.layers.map((layer) => ({ ...layer, bindings: layer.bindings.map(() => ({ kind: "key", code: "F23" }) as never) })) };
    const [entry] = whereElse(many, at(base, 0), { kind: "key", code: "F23" });
    expect(whereElseSentence(entry as never, many)).toMatch(/and \d+ more/);
  });
});
