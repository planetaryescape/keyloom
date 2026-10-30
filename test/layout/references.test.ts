import { describe, expect, test } from "bun:test";
import { markerAt, markerText, readReference, referenceParts, type ReferenceWorld } from "../../src/layout/references.ts";

const refs = (text: string) => referenceParts(text).flatMap((part) => (part.kind === "reference" ? [part.reference] : []));

describe("the reference markers", () => {
  test("the four kinds carry ids only", () => {
    expect(refs("{config:lay_01M5JRZN8MRTY4G6PPVVVYPQ8Q}")).toEqual([{ kind: "config", id: "lay_01M5JRZN8MRTY4G6PPVVVYPQ8Q" }]);
    expect(refs("{proposal:cs_01M5JRZN8MRTY4G6PPVVVYPQ8Q}")).toEqual([{ kind: "proposal", id: "cs_01M5JRZN8MRTY4G6PPVVVYPQ8Q" }]);
    expect(refs("{layer:layer-0}")).toEqual([{ kind: "layer", layerId: "layer-0" }]);
    expect(refs("{key:layer-0:60}")).toEqual([{ kind: "key", layerId: "layer-0", position: 60 }]);
  });

  test("the words around them are kept in order, and two markers in one line both read", () => {
    expect(referenceParts("On {layer:base} at {key:base:60} now")).toEqual([
      { kind: "words", text: "On " },
      { kind: "reference", reference: { kind: "layer", layerId: "base" } },
      { kind: "words", text: " at " },
      { kind: "reference", reference: { kind: "key", layerId: "base", position: 60 } },
      { kind: "words", text: " now" },
    ]);
    // A marker at the very start and at the very end leaves no empty words around it.
    expect(referenceParts("{layer:base}").length).toBe(1);
    expect(referenceParts("{layer:base} and {layer:nav}").map((p) => p.kind)).toEqual(["reference", "words", "reference"]);
  });

  test("what is not a marker stays exactly as the model wrote it", () => {
    for (const text of [
      "{screen:history}", // a kind nobody defines
      "{layer: Base}", // a name, not an id
      "{config:}", // no id
      "{layer:layer-0:3}", // a position on something that is not a key
      "{config:lay_a:3}", // and on a config or a proposal either
      "{proposal:cs_b:2}",
      "{key:layer-0}", // a key with no position
      "{key:layer-0:12:extra}",
      "{layer:layer-0", // no closing brace
      '{"config":"lay_x"}', // JSON, as a code block would hold it
      "{config:lay_" + "x".repeat(200) + "}",
    ]) {
      expect(refs(text)).toEqual([]);
      expect(referenceParts(text)).toEqual([{ kind: "words", text }]);
    }
  });

  test("a marker inside a code span is code, so it names nothing and prints no route", () => {
    const code = "run `keyloom config use {config:lay_a}` to open it";
    expect(refs(code)).toEqual([]);
    expect(referenceParts(code)).toEqual([{ kind: "words", text: code }]);
    // Outside the span it still reads, and the span itself stays whole.
    expect(referenceParts("on {layer:base}, not `{layer:base}`")).toEqual([
      { kind: "words", text: "on " },
      { kind: "reference", reference: { kind: "layer", layerId: "base" } },
      { kind: "words", text: ", not `{layer:base}`" },
    ]);
    // A lone backtick is a character, as the page reads it, so a marker after it is a marker.
    expect(refs("half `code {layer:base}")).toEqual([{ kind: "layer", layerId: "base" }]);
  });

  test("a marker is found where it starts, and says how long it is", () => {
    expect(markerAt("a {layer:base} b", 2)).toEqual({ reference: { kind: "layer", layerId: "base" }, length: 12 });
    expect(markerAt("a {layer:base} b", 1)).toBeNull();
    expect(markerText({ kind: "key", layerId: "base", position: 7 })).toBe("{key:base:7}");
  });
});

const world = (over: Partial<ReferenceWorld> = {}): ReferenceWorld => ({
  layer: (id) => (id === "base" ? { name: "Base", keyCount: 72 } : undefined),
  keyTap: (id, position) => (id === "base" && position === 60 ? "⌫" : id === "base" && position === 61 ? "" : undefined),
  config: (id) => (id === "lay_live" ? "Glove80" : undefined),
  proposal: (id) => (id === "cs_open" ? { title: "Move Backspace", status: "proposed" } : id === "cs_done" ? { title: "Move Backspace", status: "applied" } : undefined),
  ...over,
});

describe("reading one marker against what a client has", () => {
  test("a live thing reads as its own name", () => {
    expect(readReference({ kind: "config", id: "lay_live" }, world())).toEqual({ kind: "target", target: { kind: "config", id: "lay_live", label: "Glove80" } });
    expect(readReference({ kind: "proposal", id: "cs_open" }, world())).toEqual({ kind: "target", target: { kind: "proposal", id: "cs_open", label: "Move Backspace" } });
    expect(readReference({ kind: "layer", layerId: "base" }, world())).toEqual({ kind: "target", target: { kind: "layer", layerId: "base", label: "Base" } });
    expect(readReference({ kind: "key", layerId: "base", position: 60 }, world())).toEqual({
      kind: "target", target: { kind: "key", layerId: "base", position: 60, label: "⌫", layerName: "Base" },
    });
    // A key that does nothing still names its place, with words that say so.
    expect(readReference({ kind: "key", layerId: "base", position: 61 }, world())).toMatchObject({ kind: "target", target: { label: "empty key" } });
  });

  test("an id that belongs to nothing reads as the words it carries, never a dead target", () => {
    expect(readReference({ kind: "config", id: "lay_gone" }, world())).toEqual({ kind: "words", text: "lay_gone" });
    expect(readReference({ kind: "proposal", id: "cs_gone" }, world())).toEqual({ kind: "words", text: "cs_gone" });
    expect(readReference({ kind: "layer", layerId: "gone" }, world())).toEqual({ kind: "words", text: "gone" });
    expect(readReference({ kind: "key", layerId: "gone", position: 60 }, world())).toEqual({ kind: "words", text: "gone" });
    // The layer is gone after a head change: the position means nothing on its own.
    expect(readReference({ kind: "key", layerId: "base", position: 200 }, world())).toEqual({ kind: "words", text: "key 201 on Base" });
  });

  test("a proposal that is no longer waiting reads as its title and where it stands", () => {
    expect(readReference({ kind: "proposal", id: "cs_done" }, world())).toEqual({ kind: "words", text: "Move Backspace (applied)" });
    expect(readReference({ kind: "proposal", id: "cs_open" }, world({ proposal: () => ({ title: "T", status: "superseded" }) }))).toEqual({ kind: "words", text: "T (superseded)" });
  });
});
