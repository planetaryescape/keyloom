// Deleting a layer something still switches to (R4-09): Delete waits with its reason, and each reference opens where it is changed.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeleteLayerDialog, openReference, referenceAction } from "../../src/web/layers/DeleteLayerDialog.tsx";
import { LayerRefusal, deleteWaits } from "../../src/web/layers/LayerRefusal.tsx";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, type PageFailure, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";

const dialog = (references: Parameters<typeof DeleteLayerDialog>[0]["references"]) =>
  renderToStaticMarkup(
    <DeleteLayerDialog layerName="Nav" references={references} goesWith={[]} onDelete={async () => ({ ok: true as const, warnings: [], shown: true })} nameFunction={(fn) => fn}
      onOpenKey={() => {}} onOpenCombo={() => null} onRemoveTapDance={async () => ({ ok: true as const, warnings: [], shown: true })} onClose={() => {}} />,
  );

test("each reference gets the button for the place it is changed", () => {
  expect(referenceAction({ text: "The A key on Base holds Nav", slot: { layerId: "base", position: 0 } })?.label).toBe("Open key");
  expect(referenceAction({ text: "The A key on Base is the tap dance Twice", slot: { layerId: "base", position: 0 }, tapDance: true })?.label).toBe("Open tap dance");
  expect(referenceAction({ text: "The combo Go nav toggles Nav", comboId: "c1" })).toEqual({ label: "Open combo", open: { comboId: "c1" } });
  expect(referenceAction({ text: "The tap dance Twice goes to Nav, and nothing uses it", tapDanceId: "td" })).toEqual({ label: "Remove tap dance", open: { tapDanceId: "td" } });
  expect(referenceAction({ text: "The tap dance Twice goes to Nav, and keys on Nav carry it", slot: { layerId: "nav", position: 1 }, tapDance: true })?.label).toBe("Open tap dance");
});

test("Delete is disabled with its reason while something switches to the layer, and enabled when nothing does", () => {
  const stuck = dialog([{ text: "The combo Go nav toggles Nav", comboId: "c1" }]);
  expect(stuck).toContain("Change what switches to Nav first.");
  expect(stuck).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="delete-layer-why"[^>]*>Delete Nav<\/button>/);
  expect(stuck).toContain("Open combo");
  const free = dialog([]);
  expect(free).not.toContain("first.");
  expect(free).not.toMatch(/disabled=""[^>]*>Delete Nav/);
});

test("every reference layerReferences can give has a button, so a disabled Delete always has a way forward (#290 review)", () => {
  const stuck = dialog([{ text: "The tap dance Twice goes to Nav, and nothing uses it", tapDanceId: "td" }]);
  expect(stuck).toMatch(/<button[^>]*>Remove tap dance<\/button>/);
});

// R5-13: a combo that can't open yet keeps the dialog open with why and a button, instead of closing into a toast with no button.
test("Open combo decides before the dialog closes: it closes only when the combo opened", () => {
  const calls: string[] = [];
  const on = (refuse: boolean) => ({
    openKey: () => calls.push("key"),
    openCombo: (id: string) => {
      calls.push(`combo ${id}`);
      return refuse ? { text: "Your changes to the combo “Go” aren't applied yet.", action: { label: "Show the combo you're editing", run: () => calls.push("show") } } : null;
    },
    close: () => calls.push("close"),
  });
  const refused = openReference({ comboId: "c1" }, on(true));
  expect(calls).toEqual(["combo c1"]);
  expect(refused?.action.label).toBe("Show the combo you're editing");
  calls.length = 0;
  expect(openReference({ comboId: "c1" }, on(false))).toBeNull();
  expect(calls).toEqual(["combo c1", "close"]);
  calls.length = 0;
  expect(openReference({ slot: { layerId: "base", position: 0 } }, on(true))).toBeNull();
  expect(calls).toEqual(["close", "key"]);
});

// R11-06: a Delete or a conditions change that failed no way a screen planned for showed only its sentence: "The details are in keyloom's
// log." had no log button, and a Delete whose answer fails the same way stayed on.
describe("a layer change that fails no way a screen planned for (R11-06)", () => {
  const refused = (failure: PageFailure) => ({ ok: false as const, message: failure.message, problems: [], lost: [], stale: false, failure });
  const internal = refused({ message: INTERNAL_WORDS, code: "internal" });
  const unreadable = refused({ message: UNREADABLE_WORDS, code: "unreadable" });

  test("a server exception shows Restart keyloom and the log beside its sentence, and Delete stays on as its Try again", () => {
    const html = renderToStaticMarkup(<LayerRefusal token="t" refused={internal} problems={6} />);
    expect(html).toContain("The details are in keyloom&#x27;s log.");
    // Show keyloom's log renders once it has asked whether there is a log, which a static render never sees.
    expect(html).toContain("Restart keyloom");
    expect(deleteWaits(internal)).toBeNull();
  });

  test("an answer that fails the same way turns Delete off with its reason, and Restart keyloom leads", () => {
    expect(deleteWaits(unreadable)).toBe("Deleting it again would fail the same way. Restart keyloom first.");
    expect(deleteWaits(refused({ message: NOT_FOUND_WORDS, code: "not_found", generic: true }))).not.toBeNull();
    const html = renderToStaticMarkup(<LayerRefusal token="t" refused={unreadable} problems={6} primary />);
    expect(html).toMatch(/button-primary[^>]*>.*Restart keyloom/);
  });

  test("a refusal the validator made keeps its reasons and adds no restart", () => {
    const validation = { ok: false as const, message: "keyloom refused this change. Nothing was saved.", problems: ["Nav would be unreachable"], lost: [], stale: false };
    const html = renderToStaticMarkup(<LayerRefusal token="t" refused={validation} problems={6} />);
    expect(html).toContain("Nav would be unreachable");
    expect(html).not.toContain("Restart keyloom");
    expect(deleteWaits(validation)).toBeNull();
    expect(deleteWaits(null)).toBeNull();
  });
});
