// Drafts kept when a key's card closes (D-317): kept by key, dropped once the key changes under them, and sent to the chat.
import { describe, expect, test } from "bun:test";
import type { Binding, Layout } from "../../src/layout/schema.ts";
import { draftFromBinding } from "../../src/web/editor/draft.ts";
import { draftsForChat, draftsOn, park, slotKey, stillApplying, unpark, type Parked } from "../../src/web/editor/parked-drafts.ts";

const layout = (b30: Binding): Layout => ({
  schemaVersion: 1, boardId: "zsa/moonlander", firmware: "qmk",
  layers: [{ id: "base", name: "Base", bindings: Array.from({ length: 72 }, (_, i) => (i === 30 ? b30 : { kind: "none" as const })) }],
  macros: [], tapDances: [], combos: [], conditionalLayers: [], holdTapProfiles: [], settings: [], passthrough: [],
});
const S: Binding = { kind: "key", code: "S" };
const entry = (position: number, binding: Binding | null): Parked => ({
  slot: { layerId: "base", position }, panel: draftFromBinding(S, layout(S), "base"), binding, original: S,
});

describe("kept drafts", () => {
  test("are kept by key, one per key, and taken off when the key opens", () => {
    let drafts = park(new Map(), entry(30, { kind: "key", code: "Q" }));
    drafts = park(drafts, entry(30, { kind: "key", code: "W" }));
    expect(drafts.size).toBe(1);
    expect(drafts.get(slotKey({ layerId: "base", position: 30 }))?.binding).toEqual({ kind: "key", code: "W" });
    expect(draftsOn(drafts, "base")).toEqual([30]);
    expect(unpark(drafts, { layerId: "base", position: 30 }).size).toBe(0);
  });

  test("a draft whose key changed under it is dropped; one whose key is as it was stays", () => {
    const drafts = park(new Map(), entry(30, { kind: "key", code: "Q" }));
    expect(stillApplying(drafts, layout(S)).dropped).toEqual([]);
    const after = stillApplying(drafts, layout({ kind: "key", code: "X" }));
    expect(after.dropped.length).toBe(1);
    expect(after.kept.size).toBe(0);
  });

  test("only complete drafts go to the chat", () => {
    const drafts = park(park(new Map(), entry(30, { kind: "key", code: "Q" })), entry(31, null));
    expect(draftsForChat(drafts)).toEqual([{ layerId: "base", position: 30, binding: { kind: "key", code: "Q" } }]);
  });
});
